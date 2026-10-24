"""Finish one check-in: answers -> Bedrock facts -> round 2 rules -> saved result.

This is the no-Lambda call path. calling.py calls finish_checkin() when a phone call
ends with answers; the typed-transcript endpoint (main.py) calls it for the demo safety
net. Bedrock only extracts facts; app/rules.py decides the level.
"""
from datetime import datetime, timezone
from typing import Optional

from app import calling, rules, store, understand
from app.models import Answer, Resident, Status
from app.script import QUESTIONS, is_emergency


def _now() -> datetime:
    return datetime.now(timezone.utc)


def finish_checkin(resident_id: str, answers: list[str], *,
                   emergency: bool = False, source: str = "call") -> Optional[Resident]:
    """Rank a resident from their 5 answers and save the result.

    `answers` are the spoken/typed replies to QUESTIONS 1-5, in order. Missing ones are
    padded with "(no answer)". Returns the updated resident, or None if it was not saved
    (e.g. the resident is gone, or someone else changed them first).
    """
    resident = store.get_resident(resident_id)
    if resident is None:
        return None
    from_status = resident.status

    # Pad to 5 answers and build the transcript (question + answer per turn).
    padded = [(answers[i] if i < len(answers) and answers[i] else "(no answer)")
              for i in range(len(QUESTIONS))]
    transcript = [Answer(q=i + 1, question=QUESTIONS[i + 1], answer=padded[i])
                  for i in range(len(QUESTIONS))]

    said_emergency = emergency or any(is_emergency(a) for a in answers)
    extraction = understand.extract_facts(transcript, said_emergency=said_emergency)
    decision = rules.rank_after_call(extraction.facts, resident, resident.drive_minutes)

    changes = {
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
        "transcript": transcript,
        "current_question": 0,
        "last_activity_at": _now(),
    }
    done = store.transition(resident_id, from_status, changes, contact_id=resident.contact_id
                            if from_status == Status.CALLING else None)
    if done is None:
        return None

    store.add_checkin(resident_id, {
        "source": source, "status": done.status.value, "rule_id": done.rule_id,
        "reason": done.reason, "facts": done.facts, "ai": done.ai,
        "transcript": [a.model_dump() for a in done.transcript]})

    if from_status == Status.CALLING:
        try:
            calling.dial_next(done.zone)
        except Exception as e:  # never let a dialing problem break the result
            import json
            print(json.dumps({"residentId": resident_id, "dial_next_error": str(e)}))
    return done
