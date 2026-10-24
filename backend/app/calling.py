"""Amazon Connect: phone up to MAX_LINES (4) residents at a time.

Connect places a real phone call from one API call (StartOutboundVoiceContact) and
runs our contact flow, which hands the caller to the Lex bot. We pass residentId as a
contact attribute so lex_hook knows who is on the line.

Safety: a call starts only if the resident has allow_call=True AND their number is in
DIALER_ALLOW_LIST. With an empty allow-list, no real call ever goes out.

CONNECT_DRY_RUN=1 skips Connect and returns fake contact IDs, so the dashboard can be
built without ringing anyone.
"""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app import store
from app.models import Resident, Status
from app.ranking import round1_order

MAX_LINES = int(os.getenv("MAX_LINES", "4"))
NO_ANSWER_SECONDS = int(os.getenv("NO_ANSWER_SECONDS", "120"))
RING_TIMEOUT_SECONDS = int(os.getenv("RING_TIMEOUT_SECONDS", "20"))  # hang up before voicemail
MAX_MISSED_CALLS = 2               # docs/RANKING.md, rule NA
CHECK_EVERY_SECONDS = 5            # check_calls runs on dashboard polls; this keeps it cheap

DRY_RUN = os.getenv("CONNECT_DRY_RUN", "").lower() in ("1", "true", "yes")
INSTANCE_ID = os.getenv("CONNECT_INSTANCE_ID", "")
FLOW_ID = os.getenv("CONNECT_CONTACT_FLOW_ID", "")
SOURCE_NUMBER = os.getenv("CONNECT_SOURCE_NUMBER", "")   # the claimed number, shown as caller ID
QUEUE_ID = os.getenv("CONNECT_QUEUE_ID", "")             # or: a queue whose caller ID is set
ALLOW_LIST = {n.strip() for n in os.getenv("DIALER_ALLOW_LIST", "").split(",") if n.strip()}

_CALL_ERRORS = (ClientError, BotoCoreError)


class CallingNotConfigured(Exception):
    """Connect settings are missing from the environment."""


class NotAllowedToCall(Exception):
    """The resident has not agreed to be called, or their number is not on the allow-list."""


class AlreadyOnCall(Exception):
    """The resident is already being called."""


class OutageInProgress(Exception):
    """Calls are still going in this zone."""


_client = None


def _connect():
    """One Connect client, reused. Retries a throttled request once (total 2 attempts)."""
    global _client
    if _client is None:
        _client = boto3.client("connect", config=Config(
            retries={"total_max_attempts": 2, "mode": "standard"}))
    return _client


def _now() -> datetime:
    return datetime.now(timezone.utc)


def check_config() -> None:
    if DRY_RUN:
        return
    missing = [name for name, value in (("CONNECT_INSTANCE_ID", INSTANCE_ID),
                                        ("CONNECT_CONTACT_FLOW_ID", FLOW_ID)) if not value]
    if not (SOURCE_NUMBER or QUEUE_ID):
        missing.append("CONNECT_SOURCE_NUMBER (or CONNECT_QUEUE_ID)")
    if missing:
        raise CallingNotConfigured(
            f"Calling is not set up: missing {', '.join(missing)}. See connect/SETUP.md.")


def refusal(resident: Resident) -> Optional[str]:
    """Why this resident may not be called, or None if they may."""
    if not resident.allow_call:
        return "has not agreed to be called (allow_call is false)"
    if not DRY_RUN and resident.phone not in ALLOW_LIST:
        return "number is not on DIALER_ALLOW_LIST"
    return None


def _place_call(resident: Resident) -> str:
    """Ask Connect to ring one phone. Returns the ContactId."""
    if DRY_RUN:
        return f"dry-run-{uuid4()}"
    params = {
        "InstanceId": INSTANCE_ID,
        "ContactFlowId": FLOW_ID,
        "DestinationPhoneNumber": resident.phone,
        "Attributes": {"residentId": resident.id},
        "RingTimeoutInSeconds": RING_TIMEOUT_SECONDS,
        "ClientToken": str(uuid4()),  # makes the automatic retry safe: never two calls
        "Description": f"CareCall check-in for {resident.id}",
    }
    if SOURCE_NUMBER:
        params["SourcePhoneNumber"] = SOURCE_NUMBER
    else:
        params["QueueId"] = QUEUE_ID
    return _connect().start_outbound_voice_contact(**params)["ContactId"]


def start_call(resident: Resident) -> Resident:
    """Ring one resident and mark them CALLING."""
    check_config()
    why = refusal(resident)
    if why:
        raise NotAllowedToCall(f"{resident.name} {why}")
    if resident.status == Status.CALLING:
        raise AlreadyOnCall(f"{resident.name} is already being called")

    claimed = store.transition(resident.id, resident.status, {
        "status": Status.CALLING, "rule_id": None, "reason": "Ringing",
        "emergency": False, "transcript": [], "contact_id": None,
        "call_started_at": _now(), "last_activity_at": None,
        "current_question": 0, "last_error": None,
    })
    if claimed is None:
        raise AlreadyOnCall(f"{resident.name} was just picked up by another call")
    try:
        contact_id = _place_call(claimed)
    except _CALL_ERRORS as e:
        # Put them back in line and show the error on the dashboard.
        store.transition(claimed.id, Status.CALLING, {
            "status": resident.status, "reason": "Call could not start",
            "last_error": str(e), "call_started_at": None})
        raise
    return store.transition(claimed.id, Status.CALLING, {"contact_id": contact_id}) or claimed


def _lines_in_use() -> int:
    return sum(1 for r in store.list_residents() if r.status == Status.CALLING)


def _fill_lines(zone: str) -> dict:
    """Call the next people in round 1 order until MAX_LINES calls are going."""
    residents = round1_order(store.list_residents(zone))
    waiting = [r for r in residents
               if r.status == Status.NOT_CALLED and r.missed_calls < MAX_MISSED_CALLS
               and refusal(r) is None]
    # Everyone gets a first call before anyone gets a retry (sort is stable, so
    # round 1 order holds within each group).
    waiting.sort(key=lambda r: r.missed_calls)
    picked = waiting[:max(MAX_LINES - _lines_in_use(), 0)]
    calling, errors = [], []
    if picked:
        if not DRY_RUN:
            _connect()  # create the client once, before the threads share it
        # All calls start at the same moment, so the phones ring together.
        with ThreadPoolExecutor(max_workers=len(picked)) as pool:
            futures = {r.id: pool.submit(start_call, r) for r in picked}
        for resident_id, future in futures.items():
            try:
                future.result()
                calling.append(resident_id)
            except (NotAllowedToCall, AlreadyOnCall, *_CALL_ERRORS) as e:
                errors.append({"id": resident_id, "error": str(e)})
    return {
        "calling": calling,
        "errors": errors,
        "waiting": [r.id for r in waiting[len(picked):]],
        "not_on_allow_list": [r.id for r in residents if refusal(r)],
    }


def dial_wave(zone: str) -> dict:
    """First calls of an outage: the top MAX_LINES people in round 1 order."""
    check_config()
    return {"zone": zone, **_fill_lines(zone)}


def dial_next(zone: str) -> list[str]:
    """A line came free: call the next person in line. Returns who was called."""
    check_config()
    return _fill_lines(zone)["calling"]


def start_outage(zone: str) -> dict:
    """Start Outage button: a fresh wave of calls for the zone."""
    check_config()
    if any(r.status == Status.CALLING for r in store.list_residents(zone)):
        raise OutageInProgress(f"Calls are still going in zone {zone}. Wait, or reset the demo.")
    store.reset_live_state(zone)
    return dial_wave(zone)


# ---- Finding calls that ended without all 5 answers ----

_last_check = 0.0


def _call_ended(resident: Resident) -> bool:
    last = resident.last_activity_at or resident.call_started_at
    if last and _now() - last > timedelta(seconds=NO_ANSWER_SECONDS):
        return True  # backstop: nothing heard for too long
    if DRY_RUN or not resident.contact_id:
        return False
    try:
        contact = _connect().describe_contact(
            InstanceId=INSTANCE_ID, ContactId=resident.contact_id)["Contact"]
    except ClientError:
        return False  # can't tell right now; the timer above still catches it
    return "DisconnectTimestamp" in contact


def _close_unfinished_call(resident: Resident) -> bool:
    """The call ended before question 5. Record a missed call or a cut-off call."""
    answered = len(resident.transcript)
    if answered:
        changes = {"status": Status.PERSON_CHECK, "rule_id": None,
                   "reason": f"Call ended after question {answered} of 5"}
    else:
        missed = resident.missed_calls + 1
        if missed >= MAX_MISSED_CALLS:
            changes = {"status": Status.HELP_SOON, "rule_id": "NA",
                       "reason": f"No answer ({missed} tries). Send a welfare check"}
        else:
            changes = {"status": Status.NOT_CALLED, "rule_id": None,
                       "reason": f"No answer ({missed} try). Calling again"}
        changes["missed_calls"] = missed
    changes["current_question"] = 0
    done = store.transition(resident.id, Status.CALLING, changes, contact_id=resident.contact_id)
    if done and answered:
        store.add_checkin(resident.id, {
            "source": "call", "status": done.status.value, "reason": done.reason,
            "transcript": [a.model_dump() for a in done.transcript]})
    return done is not None


def check_calls(force: bool = False) -> None:
    """Close calls that ended early, then refill the free lines.

    Runs when the dashboard polls (every 3 s), at most every CHECK_EVERY_SECONDS.
    """
    global _last_check
    if not force and time.monotonic() - _last_check < CHECK_EVERY_SECONDS:
        return
    _last_check = time.monotonic()
    zones = {r.zone for r in store.list_residents()
             if r.status == Status.CALLING and _call_ended(r) and _close_unfinished_call(r)}
    for zone in zones:
        dial_next(zone)
