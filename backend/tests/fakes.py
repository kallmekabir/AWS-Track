"""Test helpers: a fake Amazon Connect and a demo roster with 4 callable teammates."""
from pathlib import Path
from unittest import mock

from botocore.exceptions import ClientError

from app import calling, seed, store

TEAM_PHONES = ["+15550000001", "+15550000002", "+15550000003", "+15550000004"]


class FakeConnect:
    """Records StartOutboundVoiceContact calls; DescribeContact reports the calls we 'hang up'."""

    def __init__(self, fail_for: tuple = ()):
        self.started: list[dict] = []
        self.hung_up: set[str] = set()
        self.attributes: dict[str, dict] = {}
        self.attribute_requests: list[dict] = []
        self.fail_for = fail_for  # destination numbers that Connect rejects

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

    def called_ids(self) -> list[str]:
        return [p["Attributes"]["residentId"] for p in self.started]

    def get_contact_attributes(self, **params):
        self.attribute_requests.append(params)
        return {"Attributes": self.attributes.get(params["InitialContactId"], {})}


class FakeContactLens:
    """Returns canned Contact Lens real-time CUSTOMER turns per contact."""

    def __init__(self):
        self.turns: dict[str, list[str]] = {}  # contact_id -> customer sentences, in order

    def set_turns(self, contact_id: str, sentences: list[str]):
        self.turns[contact_id] = sentences

    def list_realtime_contact_analysis_segments(self, **params):
        cid = params["ContactId"]
        segs = []
        for i, content in enumerate(self.turns.get(cid, [])):
            segs.append({"Transcript": {"Id": f"t{i}", "ParticipantRole": "CUSTOMER",
                                        "Content": content, "BeginOffsetMillis": i * 1000}})
        # add an AGENT turn to prove we filter it out
        segs.insert(0, {"Transcript": {"Id": "agent", "ParticipantRole": "AGENT",
                                       "Content": "Are you safe right now?", "BeginOffsetMillis": 0}})
        return {"Segments": segs}


def team_roster():
    """The demo roster; Daniel, Ruth, Maria and Linh carry the 4 teammates' phones."""
    residents = seed.seed_residents(path=Path("/nonexistent/seed.local.json"))
    for resident, phone in zip(residents[:4], TEAM_PHONES):
        resident.phone = phone
        resident.allow_call = True
    return residents


def use_fake_connect(test, max_lines: int = 4, fake: FakeConnect = None,
                     contact_lens: "FakeContactLens" = None) -> FakeConnect:
    """Point calling.py at a fake Connect and a fresh in-memory store for one test."""
    from app import call_results
    fake = fake or FakeConnect()
    store.use_memory(team_roster())
    patcher = mock.patch.multiple(
        calling, DRY_RUN=False, INSTANCE_ID="instance-1", FLOW_ID="flow-1",
        SOURCE_NUMBER="+15559990000", QUEUE_ID="", ALLOW_LIST=set(TEAM_PHONES),
        MAX_LINES=max_lines, _client=fake)
    patcher.start()
    test.addCleanup(patcher.stop)
    cl = contact_lens or FakeContactLens()
    cl_patcher = mock.patch.multiple(call_results, INSTANCE_ID="instance-1", _cl_client=cl)
    cl_patcher.start()
    test.addCleanup(cl_patcher.stop)
    fake.contact_lens = cl
    return fake
