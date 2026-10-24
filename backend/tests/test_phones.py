import os
import unittest
from pathlib import Path
from unittest import mock

from app import calling, phones, seed, store
from app.models import Status
from tests.fakes import FakeConnect, team_roster

TEAMMATE = "+15550001234"


class FakeSSM:
    """Parameter Store with the given {name: value} under one path."""

    def __init__(self, params: dict[str, str]):
        self.params = params
        self.calls = []

    def get_paginator(self, name):
        assert name == "get_parameters_by_path"
        return self

    def paginate(self, Path, WithDecryption):
        self.calls.append((Path, WithDecryption))
        yield {"Parameters": [{"Name": n, "Value": v} for n, v in self.params.items()]}


def use_ssm(test, params: dict[str, str]):
    """PHONES_SSM_PATH=/carecall/phones backed by a fake Parameter Store for one test."""
    fake = FakeSSM(params)
    patches = [
        mock.patch.dict(os.environ, {"PHONES_SSM_PATH": "/carecall/phones"}),
        mock.patch.object(phones.boto3, "client", return_value=fake),
    ]
    for p in patches:
        p.start()
        test.addCleanup(p.stop)
    phones.load.cache_clear()
    test.addCleanup(phones.load.cache_clear)
    return fake


class ParameterStoreTest(unittest.TestCase):
    def test_reads_decrypted_numbers_by_persona(self):
        fake = use_ssm(self, {"/carecall/phones/daniel-kim": f" {TEAMMATE} "})
        self.assertEqual(phones.load(), {"daniel-kim": TEAMMATE})
        self.assertEqual(fake.calls, [("/carecall/phones", True)])

    def test_bad_number_error_never_shows_the_value(self):
        use_ssm(self, {"/carecall/phones/daniel-kim": "831-555-0000"})
        with self.assertRaises(ValueError) as caught:
            phones.load()
        self.assertIn("/carecall/phones/daniel-kim", str(caught.exception))
        self.assertNotIn("831", str(caught.exception))

    def test_seed_gives_the_persona_the_number(self):
        use_ssm(self, {"/carecall/phones/daniel-kim": TEAMMATE})
        daniel = seed.seed_residents(path=Path("/nonexistent.json"))[0]
        self.assertEqual((daniel.name, daniel.phone, daniel.allow_call), ("Daniel Kim", TEAMMATE, True))

    def test_unknown_persona_is_rejected(self):
        use_ssm(self, {"/carecall/phones/kabir": TEAMMATE})
        with self.assertRaises(ValueError):
            seed.seed_residents(path=Path("/nonexistent.json"))

    def test_parameter_store_number_may_be_called_without_allow_list(self):
        use_ssm(self, {"/carecall/phones/daniel-kim": TEAMMATE})
        residents = team_roster()
        residents[0] = residents[0].model_copy(update={"phone": TEAMMATE})
        store.use_memory(residents)
        fake = FakeConnect()
        with mock.patch.multiple(calling, DRY_RUN=False, INSTANCE_ID="i", FLOW_ID="f",
                                 SOURCE_NUMBER="+15559990000", QUEUE_ID="", ALLOW_LIST=set(),
                                 _client=fake):
            called = calling.start_call(store.get_resident("r-001"))
            self.assertEqual(called.status, Status.CALLING)
            self.assertEqual(fake.started[0]["DestinationPhoneNumber"], TEAMMATE)
            with self.assertRaises(calling.NotAllowedToCall):
                calling.start_call(store.get_resident("r-002"))  # allow_call, but not in SSM or list


if __name__ == "__main__":
    unittest.main()
