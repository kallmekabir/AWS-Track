"""Read a finished call's answers from Amazon Connect contact attributes.

The Lex bot stores each answer as a contact attribute (A1..A5) and sets "emergency"
when an emergency phrase was heard. After the caller hangs up, we read those attributes
with GetContactAttributes instead of running a Lex code-hook Lambda (the workshop account
can't create Lambda roles). app/checkin.py then ranks them.

Never logs answer text.
"""
import os
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

INSTANCE_ID = os.getenv("CONNECT_INSTANCE_ID", "")

_client = None


def _connect():
    global _client
    if _client is None:
        _client = boto3.client("connect", config=Config(
            retries={"total_max_attempts": 2, "mode": "standard"}))
    return _client


def read_answers(contact_id: str) -> Optional[tuple[list[str], bool]]:
    """Return (answers A1..A5, emergency) for a finished contact, or None to try again.

    Returns None on any ClientError (attributes not written yet, throttling, etc.) so the
    caller leaves the resident on the line and reads again on the next poll.
    """
    try:
        attrs = _connect().get_contact_attributes(
            InstanceId=INSTANCE_ID, InitialContactId=contact_id)["Attributes"]
    except ClientError:
        return None
    answers = [attrs.get(f"A{i}", "") for i in range(1, 6)]
    emergency = attrs.get("emergency", "").lower() == "true"
    return answers, emergency
