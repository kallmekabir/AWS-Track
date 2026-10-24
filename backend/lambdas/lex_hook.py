"""Lex code hook: runs once for every answer during a CareCall phone call.

Amazon Connect rings the phone and hands the caller to our Lex bot. Lex turns each
spoken answer into text and sends it here (the bot's FallbackIntent calls this
Lambda for every turn). We save the answer, then ask the next of the 5 questions.
The contact flow speaks question 1; this file asks questions 2 to 5.

Connect passes `residentId` into the Lex session attributes. We keep the question
number and the answers so far there too, because each turn is a separate Lambda run.

Lambda handler: lambdas.lex_hook.handler
"""
import json
from datetime import datetime, timezone
from typing import Optional

from app import calling, store
from app.models import Status

# Word for word from docs/RANKING.md, "The call script". Question 1 is also in the
# contact flow's "Get customer input" prompt (connect/SETUP.md); keep them the same.
QUESTIONS = {
    1: "Hi, this is CareCall from County Public Health, checking on you during the power "
       "outage. Are you safe right now?",
    2: "Is your medical device working right now?",
    3: "How many full backup tanks or batteries do you have?",
    4: "About how many hours can you go before you run out?",
    5: "Do you need anything else, like medicine, food, a ride, a place to charge, "
       "or an oxygen delivery?",
}
CLOSING = ("Thank you. Our team has your answers. If anything changes or you feel unsafe, "
           "hang up and call 911.")
EMERGENCY_REPLY = "Please hang up and call 911 now. I'm alerting our medical team."
NOT_HEARD = "Sorry, I didn't catch that. "

# docs/RANKING.md, "Emergency words". Phrases, not single words: a bare "help" would
# end the call when someone answers question 5 with "help with groceries".
EMERGENCY_PHRASES = (
    "can't breathe", "cannot breathe", "can not breathe", "not breathing",
    "chest pain", "heart attack", "emergency", "ambulance", "call 911",
    "nine one one", "help me", "i fell", "i've fallen",
)


def is_emergency(said: str) -> bool:
    text = said.lower().replace("’", "'")
    return any(phrase in text for phrase in EMERGENCY_PHRASES)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _elicit(attrs: dict, message: str) -> dict:
    """Say `message` and keep listening (Lex sends the next answer back here)."""
    return {
        "sessionState": {"sessionAttributes": attrs, "dialogAction": {"type": "ElicitIntent"}},
        "messages": [{"contentType": "PlainText", "content": message}],
    }


def _close(attrs: dict, intent_name: str, message: str) -> dict:
    """Say `message` and end the Lex conversation; the contact flow then hangs up."""
    return {
        "sessionState": {
            "sessionAttributes": attrs,
            "dialogAction": {"type": "Close"},
            "intent": {"name": intent_name, "state": "Fulfilled"},
        },
        "messages": [{"contentType": "PlainText", "content": message}],
    }


def _save_progress(resident_id: Optional[str], answers: list, next_q: int) -> None:
    """Show the answers on the dashboard while the call is still going."""
    if resident_id:
        store.transition(resident_id, Status.CALLING, {
            "transcript": answers, "current_question": next_q,
            "last_activity_at": _now(), "reason": f"On the call: question {next_q} of 5"})


def _finish(resident_id: Optional[str], answers: list, emergency: bool) -> None:
    """Save the call result, then free the line for the next person."""
    if not resident_id:
        return  # a test from the Lex console: nobody to save
    if emergency:
        changes = {"status": Status.HELP_NOW, "rule_id": "R0",
                   "reason": "Said it's an emergency", "emergency": True}
    else:
        # Phase 2 replaces this with Bedrock facts + round 2 rules.
        changes = {"status": Status.PERSON_CHECK, "rule_id": None,
                   "reason": "All 5 answers in. Waiting for ranking"}
    changes.update(transcript=answers, current_question=0, last_activity_at=_now())
    done = store.transition(resident_id, Status.CALLING, changes)
    if done is None:
        print(json.dumps({"residentId": resident_id, "warning": "not CALLING anymore; result not saved"}))
        return
    store.add_checkin(resident_id, {
        "source": "call", "status": done.status.value, "rule_id": done.rule_id,
        "reason": done.reason, "transcript": answers})
    try:
        calling.dial_next(done.zone)
    except Exception as e:  # never let a dialing problem break the live call
        print(json.dumps({"residentId": resident_id, "dial_next_error": str(e)}))


def handler(event: dict, context) -> dict:
    session = event.get("sessionState") or {}
    attrs = dict(session.get("sessionAttributes") or {})
    intent_name = (session.get("intent") or {}).get("name") or "FallbackIntent"
    resident_id = attrs.get("residentId")
    q = int(attrs.get("q", "1"))
    answers = json.loads(attrs.get("answers", "[]"))
    said = (event.get("inputTranscript") or "").strip()
    print(json.dumps({"residentId": resident_id, "q": q, "said": said}))  # one CloudWatch line per turn

    if is_emergency(said):
        answers.append({"q": q, "question": QUESTIONS[q], "answer": said})
        _finish(resident_id, answers, emergency=True)
        attrs.update(answers=json.dumps(answers), outcome="emergency")
        return _close(attrs, intent_name, EMERGENCY_REPLY)

    if not said and attrs.get("asked_again") != str(q):
        attrs["asked_again"] = str(q)  # ask once more, then move on
        return _elicit(attrs, NOT_HEARD + QUESTIONS[q])

    answers.append({"q": q, "question": QUESTIONS[q], "answer": said or "(no answer)"})
    attrs["answers"] = json.dumps(answers)

    if q >= len(QUESTIONS):
        _finish(resident_id, answers, emergency=False)
        attrs["outcome"] = "done"
        return _close(attrs, intent_name, CLOSING)

    _save_progress(resident_id, answers, next_q=q + 1)
    attrs["q"] = str(q + 1)
    return _elicit(attrs, QUESTIONS[q + 1])
