"""Collect Lex answers from Connect attributes after a contact disconnects, then rank.

Two input paths, same ranking:
- Keypad / Lex: answers arrive as contact attributes a1..a5 (fetch()).
- Natural speech: Contact Lens transcribes the customer; the CUSTOMER turns are read
  from the real-time analysis segments (contact_lens_segments()).

Bedrock only extracts facts (app/understand.py); app/rules.py decides the level.
"""
import os

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app import calling, rules, script, store, understand
from app.models import Resident, Status

INSTANCE_ID = os.getenv("CONNECT_INSTANCE_ID", "")

_cl_client = None


def _contact_lens():
    """One connectcontactlens client, reused. Separate from the dialer's connect client."""
    global _cl_client
    if _cl_client is None:
        _cl_client = boto3.client("connectcontactlens", config=Config(
            retries={"total_max_attempts": 2, "mode": "standard"}))
    return _cl_client


def contact_lens_segments(contact_id: str) -> list[str]:
    """CUSTOMER turns from Contact Lens real-time analysis, in spoken order.

    Available while the contact is live; may stop after disconnect, so the caller also
    collects during the call. Returns [] on any error (try again next poll)."""
    if calling.DRY_RUN or not contact_id:
        return []
    turns = []
    try:
        token = None
        while True:
            kwargs = {"InstanceId": INSTANCE_ID, "ContactId": contact_id, "MaxResults": 100}
            if token:
                kwargs["NextToken"] = token
            resp = _contact_lens().list_realtime_contact_analysis_segments(**kwargs)
            for seg in resp.get("Segments", []):
                t = seg.get("Transcript")
                if t and t.get("ParticipantRole") == "CUSTOMER" and (t.get("Content") or "").strip():
                    turns.append((t.get("BeginOffsetMillis", 0), t["Content"].strip()))
            token = resp.get("NextToken")
            if not token:
                break
    except ClientError:
        return []
    return [c for _, c in sorted(turns, key=lambda x: x[0])]


def fetch(contact_id: str) -> dict:
    """Reuse the dialer's Connect client and its standard retry configuration."""
    if calling.DRY_RUN:
        return {
            "answered": "yes", "intent": "CheckIn",
            "a1": "Yes, I'm safe", "a2": "My device is working",
            "a3": "Two full backups", "a4": "About four hours",
            "a5": "I could use help with groceries",
        }
    return calling._connect().get_contact_attributes(
        InstanceId=calling.INSTANCE_ID, InitialContactId=contact_id)["Attributes"]


def to_transcript(attrs: dict) -> list[dict]:
    """Include nonempty answers in question order, preserving their wording."""
    return [{"q": q, "question": question, "answer": attrs[f"a{q}"]}
            for q, question in script.QUESTIONS.items()
            if attrs.get(f"a{q}", "").strip()]


def rank_call(resident: Resident, transcript: list[dict], emergency: bool) -> dict:
    """Bedrock extracts facts, round 2 rules decide the level. Returns the store changes.

    Never raises: on any Bedrock trouble, facts are unknown and rule R4 sends the resident
    to a person. `emergency` is the script's own phrase/intent check; it can only add an
    emergency (Bedrock can never remove one), matching the live call path.
    """
    extraction = understand.extract_facts(transcript, said_emergency=emergency)
    decision = rules.rank_after_call(extraction.facts, resident, resident.drive_minutes)
    return {
        "status": decision.level,
        "rule_id": decision.rule_id,
        "reason": decision.reason,
        "hours_left": decision.hours_left,
        "runs_out_at": decision.runs_out_at,
        "time_to_spare": decision.time_to_spare,
        "recheck_at": decision.recheck_at,
        "emergency": extraction.facts.emergency,
        "facts": extraction.facts.model_dump(),
        "ai": {"model_id": extraction.model_id, "latency_ms": extraction.latency_ms,
               "ok": extraction.ok, "problems": extraction.problems},
    }


def finish_call(resident: Resident) -> bool:
    """Save one ended call, then refill its line. The contact guard rejects stale work.

    The caller checks DescribeContact's DisconnectTimestamp (or the timer backstop)
    before invoking this. Attribute-fetch failures propagate so a later check retries.
    """
    if not resident.contact_id:
        return False  # start_call has claimed the resident but has not finished dialing
    attrs = fetch(resident.contact_id)
    transcript = to_transcript(attrs)
    source = "call"

    # Natural-speech path: no keypad slots, but Contact Lens heard the customer.
    # Use segments collected during the call (resident.cl_segments) plus a final fetch.
    if not transcript:
        segs = list(resident.cl_segments) + contact_lens_segments(resident.contact_id)
        # de-dup while keeping order
        seen, ordered = set(), []
        for s in segs:
            if s not in seen:
                seen.add(s); ordered.append(s)
        if ordered:
            # One CUSTOMER turn per question, in spoken order (up to 5).
            qs = list(script.QUESTIONS.items())
            transcript = [{"q": qs[i][0], "question": qs[i][1], "answer": ordered[i]}
                          for i in range(min(len(ordered), len(qs)))]
            source = "speech"

    emergency = attrs.get("intent") == "Emergency" or any(
        script.is_emergency(a["answer"]) for a in transcript)

    if not emergency and (attrs.get("answered") != "yes" or not transcript):
        # Missed call / no input -> no Bedrock. Kept exactly as before.
        missed = resident.missed_calls + 1
        if missed >= calling.MAX_MISSED_CALLS:
            changes = {"status": Status.HELP_SOON, "rule_id": "NA",
                       "reason": f"No answer ({missed} tries). Send a welfare check"}
        else:
            changes = {"status": Status.NOT_CALLED, "rule_id": None,
                       "reason": f"No answer ({missed} try). Calling again"}
        changes["missed_calls"] = missed
    else:
        # Emergency, full or partial answers: Bedrock extracts, rules decide.
        # R0 still wins for emergencies (emergency=True forces it), and we still save facts.
        changes = rank_call(resident, transcript, emergency)

    changes.update(transcript=transcript, current_question=0,
                   last_activity_at=calling._now())
    done = store.transition(resident.id, Status.CALLING, changes,
                            contact_id=resident.contact_id)
    if done is None:
        return False
    store.add_checkin(resident.id, {
        "source": source, "status": done.status.value, "rule_id": done.rule_id,
        "reason": done.reason, "facts": done.facts, "ai": done.ai,
        "transcript": transcript})
    calling.dial_next(done.zone)
    return True
