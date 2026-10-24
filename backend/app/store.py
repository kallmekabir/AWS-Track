"""Where residents and call results are kept.

Two backends, same functions:
- DynamoDB when RESIDENTS_TABLE is set, for persistent data on EC2.
- An in-memory dict otherwise, seeded with the demo roster, for building and
  testing without AWS.
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Attr, Key

from app import ranking, seed
from app.models import (QUEUE_ORDER, CheckInIn, Resident, ResidentIn,
                        ResidentPatch, Status)

RESIDENTS_TABLE = os.getenv("RESIDENTS_TABLE", "")
CHECKINS_TABLE = os.getenv("CHECKINS_TABLE", "")

# Fields that describe the current outage. A new outage resets them; registry fields stay.
_LIVE_FIELDS = ("status", "rule_id", "reason", "hours_left", "time_to_spare", "runs_out_at",
                "recheck_at", "emergency", "facts", "ai",
                "transcript", "contact_id", "call_started_at", "last_activity_at",
                "current_question", "missed_calls", "last_error", "cl_segments")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_item(data: dict) -> dict:
    """Python/JSON values -> DynamoDB values (floats become Decimal, datetimes ISO strings)."""
    return json.loads(json.dumps(data, default=str), parse_float=Decimal)


def _version(resident: Resident) -> Optional[str]:
    """updated_at exactly as stored, used to spot a change made since we read the resident."""
    return resident.model_dump(mode="json", include={"updated_at"})["updated_at"]


def _from_item(item: dict) -> dict:
    """DynamoDB values -> plain Python (Decimal becomes int or float)."""
    def plain(value):
        return int(value) if value == value.to_integral_value() else float(value)
    return json.loads(json.dumps(item, default=plain))


class _MemoryBackend:
    def __init__(self, residents: list[Resident]):
        self._lock = threading.Lock()  # dial_wave starts calls from several threads
        self.residents = {r.id: r for r in residents}
        self.checkins: dict[str, list[dict]] = {}

    def get(self, resident_id: str) -> Optional[Resident]:
        return self.residents.get(resident_id)

    def all(self) -> list[Resident]:
        return list(self.residents.values())

    def put(self, resident: Resident) -> None:
        self.residents[resident.id] = resident

    def put_if_unchanged(self, resident: Resident, read_version: Optional[str]) -> bool:
        with self._lock:
            current = self.residents.get(resident.id)
            if current is None or _version(current) != read_version:
                return False
            self.residents[resident.id] = resident
            return True

    def add_checkin(self, resident_id: str, row: dict) -> None:
        self.checkins.setdefault(resident_id, []).append(row)

    def list_checkins(self, resident_id: str) -> list[dict]:
        return self.checkins.get(resident_id, [])

    def clear_checkins(self, resident_ids: list[str]) -> None:
        for resident_id in resident_ids:
            self.checkins.pop(resident_id, None)


class _DynamoBackend:
    def __init__(self, residents_table: str, checkins_table: str):
        dynamodb = boto3.resource("dynamodb")
        self.residents = dynamodb.Table(residents_table)
        self.checkins = dynamodb.Table(checkins_table)

    def get(self, resident_id: str) -> Optional[Resident]:
        item = self.residents.get_item(Key={"id": resident_id}).get("Item")
        return Resident.model_validate(_from_item(item)) if item else None

    def all(self) -> list[Resident]:
        paginator = self.residents.meta.client.get_paginator("scan")
        return [Resident.model_validate(_from_item(item))
                for page in paginator.paginate(TableName=self.residents.name)
                for item in page["Items"]]

    def put(self, resident: Resident) -> None:
        self.residents.put_item(Item=_to_item(resident.model_dump(mode="json")))

    def put_if_unchanged(self, resident: Resident, read_version: Optional[str]) -> bool:
        if read_version is None:
            condition = Attr("id").exists()
        else:
            condition = Attr("updated_at").eq(read_version)
        try:
            self.residents.put_item(Item=_to_item(resident.model_dump(mode="json")),
                                    ConditionExpression=condition)
            return True
        except self.residents.meta.client.exceptions.ConditionalCheckFailedException:
            return False  # someone else changed this resident since we read it

    def add_checkin(self, resident_id: str, row: dict) -> None:
        self.checkins.put_item(Item=_to_item({"resident_id": resident_id, **row}))

    def list_checkins(self, resident_id: str) -> list[dict]:
        response = self.checkins.query(KeyConditionExpression=Key("resident_id").eq(resident_id))
        return [_from_item(item) for item in response["Items"]]

    def clear_checkins(self, resident_ids: list[str]) -> None:
        with self.checkins.batch_writer() as batch:
            for resident_id in resident_ids:
                for row in self.list_checkins(resident_id):
                    batch.delete_item(Key={"resident_id": resident_id, "at": row["at"]})


def _make_backend():
    if RESIDENTS_TABLE:
        return _DynamoBackend(RESIDENTS_TABLE, CHECKINS_TABLE)
    return _MemoryBackend(seed.seed_residents())


_backend = _make_backend()


def use_memory(residents: list[Resident]) -> None:
    """Swap in a fresh in-memory store holding these residents (used by tests)."""
    global _backend
    _backend = _MemoryBackend(residents)


# ---- Registry ----

def _next_id() -> str:
    numbers = [int(r.id.split("-")[1]) for r in _backend.all() if r.id.startswith("r-")]
    return f"r-{max(numbers, default=0) + 1:03d}"


def create_resident(data: ResidentIn, location_fields: Optional[dict] = None) -> Resident:
    resident = Resident(id=_next_id(), updated_at=_now(), **data.model_dump(),
                        **(location_fields or {}))
    _backend.put(resident)
    return resident


def save_resident(resident: Resident) -> None:
    """Write a whole resident, replacing what was there (used by the seed script)."""
    _backend.put(resident.model_copy(update={"updated_at": _now()}))


def list_residents(zone: Optional[str] = None) -> list[Resident]:
    rows = _backend.all()
    if zone:
        rows = [r for r in rows if r.zone == zone]
    return sorted(rows, key=lambda r: r.id)


def get_resident(resident_id: str) -> Optional[Resident]:
    return _backend.get(resident_id)


def update_resident(resident_id: str, patch: ResidentPatch, *,
                    location_fields: Optional[dict] = None,
                    expected_location: Optional[tuple] = None) -> Optional[Resident]:
    """Merge registry/location changes without overwriting concurrent call results.

    A computed route is only saved while its source address and coordinates match.
    """
    changes = patch.model_dump(exclude_unset=True)  # only the fields the caller sent
    for _ in range(3):
        current = _backend.get(resident_id)
        if current is None:
            return None
        if expected_location is not None and (current.address, current.lat, current.lng) != expected_location:
            return None
        updated = Resident.model_validate({**current.model_dump(), **changes,
                                          **(location_fields or {}), "updated_at": _now()})
        if _backend.put_if_unchanged(updated, _version(current)):
            return updated
    return None


# ---- Live outage state ----

def transition(resident_id: str, from_status: Status, changes: dict,
               contact_id: Optional[str] = None) -> Optional[Resident]:
    """Apply `changes` only if the resident is still in `from_status` (and still on
    `contact_id`, when given). Returns None if someone else got there first.

    This stops concurrent checkers from both handling the end of the same call. The
    write only lands if nobody changed the resident since we read it; if someone did,
    we read again and re-check, so no one's update is silently lost.
    """
    for _ in range(3):
        current = _backend.get(resident_id)
        if current is None or current.status != from_status:
            return None
        if contact_id is not None and current.contact_id != contact_id:
            return None
        updated = Resident.model_validate(
            {**current.model_dump(), **changes, "updated_at": _now()})
        if _backend.put_if_unchanged(updated, _version(current)):
            return updated
    return None


def reset_live_state(zone: Optional[str] = None) -> int:
    """Put everyone (in a zone) back to "not called yet" and clear their call history."""
    defaults = {name: Resident.model_fields[name].get_default(call_default_factory=True)
                for name in _LIVE_FIELDS}
    residents = list_residents(zone)
    for resident in residents:
        _backend.put(resident.model_copy(update={**defaults, "updated_at": _now()}))
    _backend.clear_checkins([r.id for r in residents])
    return len(residents)


def add_checkin(resident_id: str, row: dict) -> None:
    """Save one finished (or cut-off) call for the resident's history."""
    _backend.add_checkin(resident_id, {"at": _now().isoformat(), **row})


def record_checkin(resident_id: str, checkin: CheckInIn) -> Optional[Resident]:
    """A result posted by hand from /docs, for testing the dashboard without a call."""
    current = _backend.get(resident_id)
    if current is None:
        return None
    runs_out_at = None
    if checkin.hours_left is not None:
        runs_out_at = _now() + timedelta(hours=checkin.hours_left)
    updated = current.model_copy(update={
        "status": checkin.status,
        "rule_id": checkin.rule_id,
        "reason": checkin.reason,
        "hours_left": checkin.hours_left,
        "runs_out_at": runs_out_at,
        "updated_at": _now(),
    })
    _backend.put(updated)
    add_checkin(resident_id, {"source": "manual", **checkin.model_dump(mode="json")})
    return updated


def list_checkins(resident_id: str) -> list[dict]:
    return sorted(_backend.list_checkins(resident_id), key=lambda row: row["at"])


def queue(zone: Optional[str] = None) -> list[Resident]:
    """Dashboard order (docs/RANKING.md, "The order of the dashboard list"): level first.
    Called residents then sort by least time to spare (unknown counts as 0), device group,
    id. Not-yet-called residents sort by round 1 calling order (device group, then fewest
    backups on file, then id), reusing app/ranking.round1_key, so the list previews who
    will be called next."""
    def sort_key(r: Resident):
        if r.status == Status.NOT_CALLED:
            return (QUEUE_ORDER[r.status], ranking.round1_key(r))
        spare = r.time_to_spare if r.time_to_spare is not None else 0
        return (QUEUE_ORDER[r.status], (spare, r.device_group or 3, r.id))
    return sorted(list_residents(zone), key=sort_key)
