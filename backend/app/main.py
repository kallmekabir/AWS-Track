"""CareCall HTTP API.

Run locally:   uvicorn app.main:app --reload --env-file .env    (from the backend/ folder)
Try it:        http://localhost:8000/docs
On AWS:        Lambda handler = app.main.handler   (API Gateway HTTP API in front, see template.yaml)
"""
import os
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import calling, checkin, store
from app.models import (CheckInIn, OutageIn, Resident, ResidentIn, ResidentOut,
                        ResidentPatch)


class TranscriptIn(BaseModel):
    """Typed answers for the demo safety net (POST /residents/{id}/transcript)."""
    answers: list[str] = Field(default_factory=list, max_length=5,
                               examples=[["yes", "yes it's on the tank", "one tank left",
                                          "about two hours", "no"]])

app = FastAPI(title="CareCall API", version="0.2.0")

# Lets the Vite dashboard (another port/domain) call this API from the browser.
# Add the Amplify address to ALLOWED_ORIGINS when the dashboard is deployed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
                   if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _out(resident: Resident) -> ResidentOut:
    return ResidentOut.from_resident(resident)


def _found(resident: Optional[Resident]) -> Resident:
    if resident is None:
        raise HTTPException(status_code=404, detail="Resident not found")
    return resident


@app.get("/health")
def health():
    return {"ok": True, "calls_dry_run": calling.DRY_RUN}


# ---- Residents: the registry (name, phone, address, device group) ----

@app.get("/residents", response_model=list[ResidentOut])
def list_residents(zone: Optional[str] = None):
    calling.check_calls()
    return [_out(r) for r in store.list_residents(zone)]


@app.get("/residents/{resident_id}", response_model=ResidentOut)
def get_resident(resident_id: str):
    return _out(_found(store.get_resident(resident_id)))


@app.post("/residents", response_model=ResidentOut, status_code=201)
def create_resident(body: ResidentIn):
    return _out(store.create_resident(body))


@app.patch("/residents/{resident_id}", response_model=ResidentOut)
def update_resident(resident_id: str, body: ResidentPatch):
    return _out(_found(store.update_resident(resident_id, body)))


# ---- Calls: Start outage, Call again ----

@app.post("/outages")
def start_outage(body: OutageIn):
    """Start outage: call the zone's first 4 people (round 1 order) at the same time."""
    try:
        return calling.start_outage(body.zone)
    except calling.OutageInProgress as e:
        raise HTTPException(status_code=409, detail=str(e))
    except calling.CallingNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/residents/{resident_id}/call", response_model=ResidentOut)
def call_again(resident_id: str):
    """Call one person now. Also the quickest way to test that one phone rings."""
    resident = _found(store.get_resident(resident_id))
    try:
        return _out(calling.start_call(resident))
    except calling.NotAllowedToCall as e:
        raise HTTPException(status_code=403, detail=str(e))
    except calling.AlreadyOnCall as e:
        raise HTTPException(status_code=409, detail=str(e))
    except calling.CallingNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise HTTPException(status_code=502, detail=f"Amazon Connect refused the call: {e}")


@app.post("/demo/reset")
def reset_demo(zone: Optional[str] = None):
    """Put everyone back to "not called yet" between demo rehearsals."""
    return {"reset": store.reset_live_state(zone)}


# ---- Call results ----

@app.post("/residents/{resident_id}/checkins", response_model=ResidentOut)
def add_checkin(resident_id: str, body: CheckInIn):
    return _out(_found(store.record_checkin(resident_id, body)))


@app.post("/residents/{resident_id}/transcript", response_model=ResidentOut)
def typed_transcript(resident_id: str, body: TranscriptIn):
    """Rank a resident from typed answers (Bedrock + round 2 rules). The demo safety net
    if a phone call can't be placed. Same path a real call takes in calling.py."""
    _found(store.get_resident(resident_id))
    done = checkin.finish_checkin(resident_id, body.answers, source="typed")
    if done is None:
        raise HTTPException(status_code=409, detail="Could not save; resident changed or missing")
    return _out(done)


@app.get("/residents/{resident_id}/checkins")
def list_checkins(resident_id: str):
    _found(store.get_resident(resident_id))
    return store.list_checkins(resident_id)


@app.get("/queue", response_model=list[ResidentOut])
def get_queue(zone: Optional[str] = None):
    """The ranked list for the dashboard (it asks every 3 seconds)."""
    calling.check_calls()
    return [_out(r) for r in store.queue(zone)]


# Lambda entry point. Imported lazily so local runs don't need mangum installed.
try:
    from mangum import Mangum
    handler = Mangum(app)
except ImportError:  # pragma: no cover
    handler = None
