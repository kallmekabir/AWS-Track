"""Collect Lex answers from Connect attributes after a contact disconnects."""
from app import calling, script, store
from app.models import Resident, Status


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


def extract_facts(transcript: list[dict]):
    """PHASE 2 HOOK: Bedrock fact extraction and round 2 ranking go here."""
    return None


def finish_call(resident: Resident) -> bool:
    """Save one ended call, then refill its line. The contact guard rejects stale work.

    The caller checks DescribeContact's DisconnectTimestamp (or the timer backstop)
    before invoking this. Attribute-fetch failures propagate so a later check retries.
    """
    if not resident.contact_id:
        return False  # start_call has claimed the resident but has not finished dialing
    attrs = fetch(resident.contact_id)
    transcript = to_transcript(attrs)
    if attrs.get("intent") == "Emergency" or any(
            script.is_emergency(a["answer"]) for a in transcript):
        changes = {"status": Status.HELP_NOW, "rule_id": "R0",
                   "reason": "Said it's an emergency", "emergency": True}
    elif attrs.get("answered") != "yes" or not transcript:
        missed = resident.missed_calls + 1
        if missed >= calling.MAX_MISSED_CALLS:
            changes = {"status": Status.HELP_SOON, "rule_id": "NA",
                       "reason": f"No answer ({missed} tries). Send a welfare check"}
        else:
            changes = {"status": Status.NOT_CALLED, "rule_id": None,
                       "reason": f"No answer ({missed} try). Calling again"}
        changes["missed_calls"] = missed
    elif len(transcript) == len(script.QUESTIONS):
        extract_facts(transcript)
        changes = {"status": Status.PERSON_CHECK, "rule_id": None,
                   "reason": "All 5 answers in. Waiting for ranking"}
    else:
        changes = {"status": Status.PERSON_CHECK, "rule_id": None,
                   "reason": f"Call ended after question {transcript[-1]['q']} of 5"}
    changes.update(transcript=transcript, current_question=0,
                   last_activity_at=calling._now())
    done = store.transition(resident.id, Status.CALLING, changes,
                            contact_id=resident.contact_id)
    if done is None:
        return False
    store.add_checkin(resident.id, {
        "source": "call", "status": done.status.value, "rule_id": done.rule_id,
        "reason": done.reason, "transcript": transcript})
    calling.dial_next(done.zone)
    return True
