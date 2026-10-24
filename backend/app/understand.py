"""Amazon Bedrock: turn what a person said on the call into facts.

One Converse call per finished call. Bedrock must answer through one forced tool,
`record_checkin`, so it can only return JSON in our exact shape (docs/RANKING.md,
"What Bedrock returns"). Temperature 0, so the same words give the same facts.

Bedrock only extracts. It never picks a level or decides who is safe: app/rules.py
does that with plain Python rules.

If Bedrock fails or returns something odd, nothing breaks: the bad fields become
"unsure" / null with low confidence, so rule R4 sends the person to a human.

Model: BEDROCK_MODEL_ID (an Amazon Nova text model, e.g. us.amazon.nova-lite-v1:0).
"""
import json
import os
import re
import time
from typing import Literal, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel, Field, ValidationError

MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "")
TOOL_NAME = "record_checkin"
NEEDS = ("medicine", "food", "transport", "charging", "oxygen_delivery")
LOW_CONFIDENCE = 0.5   # the most a reply with a bad field can claim (R4 starts below 0.7)

SYSTEM_PROMPT = """You read the transcript of a short wellness phone call with a person who \
depends on a powered medical device during a power outage. Record what they said by \
calling the record_checkin tool. Rules:
- Use only what the person said. Never guess. If they did not say it, use null or "unsure" \
and lower your confidence.
- Turn words into numbers: "a couple hours" is 2, "one tank" is 1, "half an hour" is 0.5.
- hours_left is how long they can go before they run out, as they said it.
- backup_left counts full backup tanks or batteries they still have.
- needs holds only things they asked for. A ride or not being able to drive is "transport". \
Asking for oxygen or more tanks is "oxygen_delivery".
- emergency is true only if they describe danger to their life right now, such as trouble \
breathing, chest pain, a fall, or asking for an ambulance.
- confidence is how sure you are that the facts match what they said, from 0 to 1.
- Do not give advice. Do not add any text outside the tool call."""

TOOL = {
    "toolSpec": {
        "name": TOOL_NAME,
        "description": "Record the facts from one check-in call.",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "safe": {"type": "string", "enum": ["yes", "no", "unsure"],
                         "description": "Did they say they are safe right now?"},
                "device_working": {"type": "string", "enum": ["yes", "no", "unsure"],
                                   "description": "Is their medical device working now (on power or backup)?"},
                "backup_left": {"type": ["integer", "null"],
                                "description": "Full backup tanks or batteries left, or null"},
                "hours_left": {"type": ["number", "null"],
                               "description": "Hours until they run out, as they said it, or null"},
                "needs": {"type": "array", "items": {"type": "string", "enum": list(NEEDS)},
                          "description": "Only things they asked for"},
                "emergency": {"type": "boolean"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["safe", "device_working", "backup_left", "hours_left", "needs",
                         "emergency", "confidence"],
        }},
    }
}


class Facts(BaseModel):
    """What Bedrock heard. Defaults are the "we don't know" values."""
    safe: Literal["yes", "no", "unsure"] = "unsure"
    device_working: Literal["yes", "no", "unsure"] = "unsure"
    backup_left: Optional[int] = Field(default=None, ge=0)
    hours_left: Optional[float] = Field(default=None, ge=0)
    needs: list[Literal["medicine", "food", "transport", "charging", "oxygen_delivery"]] = []
    emergency: bool = False
    confidence: float = Field(default=0.0, ge=0, le=1)


class Extraction(BaseModel):
    """Facts plus how we got them, so the dashboard can show Bedrock's work."""
    facts: Facts
    model_id: str
    latency_ms: int
    ok: bool = Field(description="False when Bedrock failed and every fact is unknown")
    problems: list[str] = []
    transcript: str = Field(description="The text Bedrock read, phone numbers and emails removed")


_PHONE = re.compile(r"\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def redact(text: str) -> str:
    """Remove phone numbers and emails before the text goes to Bedrock or into storage."""
    return _EMAIL.sub("[EMAIL]", _PHONE.sub("[PHONE]", text))


def transcript_text(transcript) -> str:
    """A call's answers as plain text. Takes a string, or a list of {question, answer}
    (dicts or Answer objects)."""
    if isinstance(transcript, str):
        return redact(transcript.strip())
    lines = []
    for item in transcript:
        get = item.get if isinstance(item, dict) else lambda k, d=None: getattr(item, k, d)
        lines.append(f"Q: {get('question', '')}\nA: {get('answer', '')}")
    return redact("\n".join(lines))


def clean(raw: dict) -> tuple[Facts, list[str]]:
    """Check Bedrock's tool input. A bad field becomes its "unknown" value and caps
    confidence at LOW_CONFIDENCE, instead of throwing away the whole answer."""
    data, problems = dict(raw), []
    if isinstance(data.get("needs"), list):
        unknown = [n for n in data["needs"] if n not in NEEDS]
        if unknown:
            problems.append(f"needs: dropped {unknown}")
            data["needs"] = [n for n in data["needs"] if n in NEEDS]
    for _ in range(len(Facts.model_fields)):
        try:
            facts = Facts.model_validate(data)
            break
        except ValidationError as e:
            for field in {err["loc"][0] for err in e.errors()}:
                problems.append(f"{field}: {data.get(field)!r} is not valid")
                data.pop(field, None)
    else:  # pragma: no cover  (every field was dropped and defaults still failed)
        facts = Facts()
    extra = sorted(set(raw) - set(Facts.model_fields))
    if extra:
        problems.append(f"ignored extra fields {extra}")
    if problems and facts.confidence > LOW_CONFIDENCE:
        facts = facts.model_copy(update={"confidence": LOW_CONFIDENCE})
    return facts, problems


_client = None


def _bedrock():
    """One Bedrock client, reused. Retries throttled requests up to 3 attempts in total."""
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", config=Config(
            retries={"total_max_attempts": 3, "mode": "standard"},
            connect_timeout=5, read_timeout=30))
    return _client


def _ask_bedrock(text: str) -> dict:
    """One Converse call. Returns the input Bedrock gave the record_checkin tool."""
    response = _bedrock().converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": f"Call transcript:\n{text}"}]}],
        inferenceConfig={"temperature": 0, "maxTokens": 400},
        toolConfig={"tools": [TOOL], "toolChoice": {"tool": {"name": TOOL_NAME}}},
    )
    for block in response["output"]["message"]["content"]:
        tool_use = block.get("toolUse")
        if tool_use and tool_use.get("name") == TOOL_NAME:
            return tool_use["input"]
    raise ValueError("Bedrock did not call record_checkin")


def extract_facts(transcript, said_emergency: bool = False) -> Extraction:
    """Transcript -> facts. Never raises: on any failure every fact is unknown (rule R4).

    `said_emergency` is the call script's own phrase check (lambdas/lex_hook.py). It can
    turn emergency on; Bedrock can add an emergency but can never remove one.
    """
    text = transcript_text(transcript)
    started = time.monotonic()
    try:
        if not MODEL_ID:
            raise ValueError("BEDROCK_MODEL_ID is not set")
        facts, problems = clean(_ask_bedrock(text))
        ok = True
    except (ClientError, BotoCoreError, ValueError, KeyError, TypeError) as e:
        facts, problems, ok = Facts(), [f"Bedrock failed: {e}"], False
    if said_emergency and not facts.emergency:
        facts = facts.model_copy(update={"emergency": True})
    result = Extraction(facts=facts, model_id=MODEL_ID, ok=ok, problems=problems,
                        latency_ms=int((time.monotonic() - started) * 1000), transcript=text)
    # One log line per call. No transcript text: the Bedrock invocation logs hold that.
    print(json.dumps({"bedrock": "extract_facts", "model": MODEL_ID, "ok": ok,
                      "latency_ms": result.latency_ms, "problems": problems}))
    return result
