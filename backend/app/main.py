"""CareCall HTTP API.

Run locally:   uvicorn app.main:app --reload --env-file .env    (from the backend/ folder)
Try it:        http://localhost:8000/docs
On EC2:        uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import call_results, calling, script, store
from app.models import (CheckInIn, OutageIn, Resident, ResidentIn, ResidentOut,
                        ResidentPatch)

_log = logging.getLogger(__name__)


class TranscriptIn(BaseModel):
    """Typed answers for the demo safety net (POST /residents/{id}/transcript)."""
    answers: list[str] = Field(default_factory=list, max_length=5,
                               examples=[["yes", "yes it's on the tank", "one tank left",
                                          "about two hours", "no"]])


async def _check_calls_forever():
    while True:
        try:
            # boto3 and the store are synchronous; keep them off the event loop.
            await asyncio.to_thread(calling.check_calls, force=True)
        except Exception:
            _log.exception("Background call check failed; will retry next interval")
        await asyncio.sleep(calling.CHECK_EVERY_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    checker = asyncio.create_task(_check_calls_forever())
    try:
        yield
    finally:
        checker.cancel()
        try:
            await checker
        except asyncio.CancelledError:
            pass


app = FastAPI(title="CareCall API", version="0.2.0", lifespan=lifespan)

# Lets the Vite dashboard (another port/domain) call this API from the browser.
# Add the CloudFront URL to ALLOWED_ORIGINS when the dashboard is deployed.
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
    """Rank a resident from typed answers (Bedrock + round 2 rules). Demo safety net if a
    phone call can't be placed; same ranking path as a real call (call_results.rank_call)."""
    resident = _found(store.get_resident(resident_id))
    transcript = [{"q": q, "question": question, "answer": body.answers[q - 1]}
                  for q, question in script.QUESTIONS.items()
                  if q - 1 < len(body.answers) and body.answers[q - 1].strip()]
    emergency = any(script.is_emergency(a["answer"]) for a in transcript)
    changes = call_results.rank_call(resident, transcript, emergency)
    changes.update(transcript=transcript, current_question=0, last_activity_at=calling._now())
    done = store.transition(resident_id, resident.status, changes)
    if done is None:
        raise HTTPException(status_code=409, detail="Could not save; resident changed or missing")
    store.add_checkin(resident_id, {
        "source": "typed", "status": done.status.value, "rule_id": done.rule_id,
        "reason": done.reason, "facts": done.facts, "ai": done.ai, "transcript": transcript})
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
