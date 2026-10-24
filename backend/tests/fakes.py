"""Test helpers: a fake Amazon Connect and a demo roster with 4 callable teammates."""
from pathlib import Path
from unittest import mock

from botocore.exceptions import ClientError

from app import call_results, calling, seed, store

TEAM_PHONES = ["+15550000001", "+15550000002", "+15550000003", "+15550000004"]


class FakeConnect:
    """Records StartOutboundVoiceContact calls; DescribeContact reports the calls we 'hang
    up'; GetContactAttributes returns per-contact attributes (A1..A5, emergency)."""

    def __init__(self, fail_for: tuple = (), attrs_error: bool = False):
        self.started: list[dict] = []
        self.hung_up: set[str] = set()
        self.fail_for = fail_for          # destination numbers that Connect rejects
        self.attributes: dict[str, dict] = {}  # contact_id -> {"A1":..., "emergency":...}
        self.attrs_error = attrs_error    # GetContactAttributes raises (not written yet)

    def start_outbound_voice_contact(self, **params):
        if params["DestinationPhoneNumber"] in self.fail_for:
            raise ClientError({"Error": {"Code": "DestinationNotAllowedException",
                                         "Message": "not allowed"}}, "StartOutboundVoiceContact")
        self.started.append(params)
        return {"ContactId": f"contact-{len(self.started)}"}

    def describe_contact(self, InstanceId, ContactId):
        contact = {"Id": ContactId}
        if ContactId in self.hung_up:
            contact["DisconnectTimestamp"] = "2026-10-23T20:00:00Z"
        return {"Contact": contact}

    def get_contact_attributes(self, InstanceId, InitialContactId):
        if self.attrs_error:
            raise ClientError({"Error": {"Code": "ResourceNotFoundException",
                                         "Message": "not ready"}}, "GetContactAttributes")
        return {"Attributes": self.attributes.get(InitialContactId, {})}

    def set_answers(self, contact_id: str, answers: list[str], emergency: bool = False):
        """Test setup: what the Lex bot wrote on the call as contact attributes."""
        attrs = {f"A{i + 1}": a for i, a in enumerate(answers)}
        if emergency:
            attrs["emergency"] = "true"
        self.attributes[contact_id] = attrs

    def called_ids(self) -> list[str]:
        return [p["Attributes"]["residentId"] for p in self.started]


def team_roster():
    """The demo roster; Daniel, Ruth, Maria and Linh carry the 4 teammates' phones."""
    residents = seed.seed_residents(path=Path("/nonexistent/seed.local.json"))
    for resident, phone in zip(residents[:4], TEAM_PHONES):
        resident.phone = phone
        resident.allow_call = True
    return residents


def use_fake_connect(test, max_lines: int = 4, fake: FakeConnect = None) -> FakeConnect:
    """Point calling.py at a fake Connect and a fresh in-memory store for one test."""
    fake = fake or FakeConnect()
    store.use_memory(team_roster())
    patcher = mock.patch.multiple(
        calling, DRY_RUN=False, INSTANCE_ID="instance-1", FLOW_ID="flow-1",
        SOURCE_NUMBER="+15559990000", QUEUE_ID="", ALLOW_LIST=set(TEAM_PHONES),
        MAX_LINES=max_lines, _client=fake)
    patcher.start()
    test.addCleanup(patcher.stop)
    # call_results has its own Connect client and INSTANCE_ID; point them at the fake too.
    cr_patcher = mock.patch.multiple(call_results, INSTANCE_ID="instance-1", _client=fake)
    cr_patcher.start()
    test.addCleanup(cr_patcher.stop)
    return fake
