"""Data shapes for CareCall.

Pydantic checks every request against these classes. If the dashboard sends a
phone number without +1, or a device group of 7, FastAPI rejects it with a 422
error before your code runs.
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.ranking import device_group_for


class Status(str, Enum):
    """Where a resident stands in the current outage. Order matters: see QUEUE_ORDER."""
    HELP_NOW = "HELP_NOW"
    HELP_SOON = "HELP_SOON"
    PERSON_CHECK = "PERSON_CHECK"
    NEEDS_SUPPLIES = "NEEDS_SUPPLIES"
    OK_FOR_NOW = "OK_FOR_NOW"
    CALLING = "CALLING"
    NOT_CALLED = "NOT_CALLED"


# Lower number = higher on the dashboard (docs/RANKING.md, "The order of the dashboard list").
QUEUE_ORDER = {
    Status.HELP_NOW: 0,
    Status.HELP_SOON: 1,
    Status.PERSON_CHECK: 2,
    Status.NEEDS_SUPPLIES: 3,
    Status.OK_FOR_NOW: 4,
    Status.CALLING: 5,
    Status.NOT_CALLED: 6,
}


class Answer(BaseModel):
    """One of the 5 questions and what the person said, as Lex heard it."""
    q: int = Field(ge=1, le=5)
    question: str
    answer: str


class ResidentIn(BaseModel):
    """What you send to create a resident (POST /residents)."""
    name: str = Field(min_length=1, examples=["Maria Lopez"])
    phone: str = Field(pattern=r"^\+1\d{10}$", examples=["+14085550101"],
                       description="US number in E.164 format")
    address: str = Field(examples=["412 Elm St, San Jose, CA"])
    lat: float = Field(examples=[37.335])
    lng: float = Field(examples=[-121.893])
    zone: str = Field(default="A", examples=["A"])
    device: str = Field(examples=["Oxygen concentrator"])
    device_group: Optional[int] = Field(
        default=None, ge=1, le=3,
        description="1 = oxygen/ventilator, 2 = dialysis/infusion, 3 = other. "
                    "Worked out from `device` when left empty")
    backups_on_file: Optional[int] = Field(
        default=None, ge=0, description="Backup tanks or batteries the agency has on record")
    backup_hours_each: Optional[float] = Field(
        default=None, ge=0, description="Hours one backup lasts")
    allow_call: bool = Field(default=False,
                             description="True only for consenting teammates' phones")

    @model_validator(mode="after")
    def _fill_device_group(self):
        if self.device_group is None:
            self.device_group = device_group_for(self.device)
        return self


class ResidentPatch(BaseModel):
    """What you send to change a resident (PATCH /residents/{id}). Every field is optional."""
    name: Optional[str] = None
    phone: Optional[str] = Field(default=None, pattern=r"^\+1\d{10}$")
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    zone: Optional[str] = None
    device: Optional[str] = None
    device_group: Optional[int] = Field(default=None, ge=1, le=3)
    backups_on_file: Optional[int] = Field(default=None, ge=0)
    backup_hours_each: Optional[float] = Field(default=None, ge=0)
    allow_call: Optional[bool] = None


class Resident(ResidentIn):
    """A stored resident: the registry fields plus live outage state."""
    id: str
    status: Status = Status.NOT_CALLED
    rule_id: Optional[str] = None
    reason: Optional[str] = None
    hours_left: Optional[float] = None
    time_to_spare: Optional[float] = Field(
        default=None, description="hours_left minus drive time, in hours (docs/RANKING.md)")
    runs_out_at: Optional[datetime] = Field(
        default=None, description="When their backup is expected to run out")
    recheck_at: Optional[datetime] = Field(
        default=None, description="When to call again (NEEDS_SUPPLIES / OK_FOR_NOW only)")
    drive_minutes: Optional[float] = Field(
        default=None, description="Drive time from the nearest supplier (Phase 2)")
    emergency: bool = False
    facts: Optional[dict] = Field(
        default=None, description="What Bedrock extracted (understand.Facts as a dict)")
    ai: Optional[dict] = Field(
        default=None, description="How Bedrock did: model_id, latency_ms, ok, problems")
    transcript: list[Answer] = Field(default_factory=list)
    cl_segments: list[str] = Field(
        default_factory=list,
        description="Contact Lens CUSTOMER turns collected during the call, in order")
    # The current (or last) phone call
    contact_id: Optional[str] = Field(default=None, description="Amazon Connect ContactId")
    call_started_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = Field(
        default=None, description="Last time Lex sent us an answer on this call")
    current_question: int = Field(default=0, description="1-5 while on a call, else 0")
    missed_calls: int = 0
    last_error: Optional[str] = None
    updated_at: Optional[datetime] = None


def mask_phone(phone: str) -> str:
    """+14085550101 -> +1-XXX-XXX-0101"""
    return f"{phone[:2]}-XXX-XXX-{phone[-4:]}"


class ResidentOut(Resident):
    """What the API sends back. The phone is masked so a public URL never shows teammates' numbers."""
    phone: str

    @classmethod
    def from_resident(cls, resident: Resident) -> "ResidentOut":
        return cls.model_validate({**resident.model_dump(), "phone": mask_phone(resident.phone)})


class CheckInIn(BaseModel):
    """A call result posted by hand (POST /residents/{id}/checkins), for testing the dashboard.

    Real calls save their result through call_results.finish_call instead.
    """
    status: Status = Field(examples=["HELP_SOON"])
    rule_id: str = Field(examples=["R3"])
    reason: str = Field(examples=["1 backup left"])
    hours_left: Optional[float] = Field(default=None, ge=0, examples=[2.0])
    transcript: str = ""


class OutageIn(BaseModel):
    """Start an outage for one zone (POST /outages)."""
    zone: str = Field(examples=["A"])
