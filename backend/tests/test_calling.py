import unittest
from datetime import timedelta

from app import calling, store
from app.models import Status
from tests.fakes import TEAM_PHONES, FakeConnect, use_fake_connect
from tests.test_understand import GOOD, FakeBedrock, use_fake_bedrock


class StartOutageTest(unittest.TestCase):
    def test_rings_four_phones_together(self):
        fake = use_fake_connect(self)
        result = calling.start_outage("A")

        self.assertEqual(sorted(result["calling"]), ["r-001", "r-002", "r-003", "r-004"])
        self.assertEqual(sorted(fake.called_ids()), ["r-001", "r-002", "r-003", "r-004"])
        self.assertEqual(result["not_on_allow_list"], ["r-005", "r-006", "r-007", "r-008"])
        for params in fake.started:
            self.assertEqual(params["SourcePhoneNumber"], "+15559990000")
            self.assertIn(params["DestinationPhoneNumber"], TEAM_PHONES)
        for resident_id in result["calling"]:
            resident = store.get_resident(resident_id)
            self.assertEqual(resident.status, Status.CALLING)
            self.assertTrue(resident.contact_id.startswith("contact-"))
            self.assertIsNotNone(resident.call_started_at)

    def test_refuses_while_calls_are_going(self):
        use_fake_connect(self)
        calling.start_outage("A")
        with self.assertRaises(calling.OutageInProgress):
            calling.start_outage("A")

    def test_never_more_than_max_lines(self):
        fake = use_fake_connect(self, max_lines=2)
        result = calling.start_outage("A")
        self.assertEqual(result["calling"], ["r-001", "r-002"])
        self.assertEqual(result["waiting"], ["r-003", "r-004"])
        self.assertEqual(len(fake.started), 2)

    def test_needs_config(self):
        use_fake_connect(self)
        calling.FLOW_ID = ""  # restored by the patcher after the test
        with self.assertRaises(calling.CallingNotConfigured):
            calling.start_outage("A")


class SafetyTest(unittest.TestCase):
    def test_refuses_without_consent(self):
        use_fake_connect(self)
        with self.assertRaises(calling.NotAllowedToCall):
            calling.start_call(store.get_resident("r-005"))  # made up, allow_call false

    def test_refuses_number_not_on_allow_list(self):
        fake = use_fake_connect(self)
        stranger = store.get_resident("r-005").model_copy(update={"allow_call": True})
        store.save_resident(stranger)
        with self.assertRaises(calling.NotAllowedToCall):
            calling.start_call(stranger)
        calling.start_outage("A")
        self.assertNotIn("r-005", fake.called_ids())

    def test_failed_start_puts_them_back_in_line(self):
        use_fake_connect(self, fake=FakeConnect(fail_for=(TEAM_PHONES[0],)))
        result = calling.start_outage("A")
        self.assertEqual([e["id"] for e in result["errors"]], ["r-001"])
        daniel = store.get_resident("r-001")
        self.assertEqual(daniel.status, Status.NOT_CALLED)
        self.assertIn("DestinationNotAllowedException", daniel.last_error)


class EndedCallsTest(unittest.TestCase):
    def test_no_answer_retries_after_others_then_na(self):
        fake = use_fake_connect(self, max_lines=1)
        calling.start_outage("A")                       # Daniel rings
        fake.hung_up.add(store.get_resident("r-001").contact_id)  # no attributes set
        calling.check_calls(force=True)                 # missed once -> Ruth rings next

        daniel = store.get_resident("r-001")
        self.assertEqual(daniel.status, Status.NOT_CALLED)
        self.assertEqual(daniel.missed_calls, 1)
        self.assertEqual(store.get_resident("r-002").status, Status.CALLING)

        # Second miss for Daniel -> rule NA
        calling.start_call(daniel)
        fake.hung_up.add(store.get_resident("r-001").contact_id)
        calling.check_calls(force=True)
        daniel = store.get_resident("r-001")
        self.assertEqual((daniel.status, daniel.rule_id), (Status.HELP_SOON, "NA"))
        self.assertIn("No answer (2 tries)", daniel.reason)

    def test_hang_up_with_answers_is_ranked(self):
        fake = use_fake_connect(self, max_lines=1)
        use_fake_bedrock(self, FakeBedrock(GOOD))       # safe/device yes, 1 tank, 2 h
        calling.start_outage("A")
        contact = store.get_resident("r-001").contact_id
        fake.set_answers(contact, ["yes", "yes on the tank", "one tank", "about two hours", "no"])
        fake.hung_up.add(contact)
        calling.check_calls(force=True)

        daniel = store.get_resident("r-001")
        self.assertIn(daniel.rule_id, ("R1", "R2", "R3"))   # ranked, not PERSON_CHECK by cutoff
        self.assertIsNotNone(daniel.facts)
        self.assertTrue(daniel.ai["ok"])
        self.assertEqual(len(store.list_checkins("r-001")), 1)
        self.assertEqual(fake.called_ids(), ["r-001", "r-002"])  # line freed -> Ruth

    def test_emergency_attribute_forces_r0_even_if_bedrock_says_no(self):
        fake = use_fake_connect(self, max_lines=1)
        use_fake_bedrock(self, FakeBedrock(GOOD))       # Bedrock says emergency False
        calling.start_outage("A")
        contact = store.get_resident("r-001").contact_id
        fake.set_answers(contact, ["yes", "yes", "one", "two hours", "no"], emergency=True)
        fake.hung_up.add(contact)
        calling.check_calls(force=True)
        daniel = store.get_resident("r-001")
        self.assertEqual((daniel.status, daniel.rule_id), (Status.HELP_NOW, "R0"))
        self.assertTrue(daniel.emergency)

    def test_emergency_phrase_in_a1_forces_r0(self):
        fake = use_fake_connect(self, max_lines=1)
        use_fake_bedrock(self, FakeBedrock(GOOD))
        calling.start_outage("A")
        contact = store.get_resident("r-001").contact_id
        fake.set_answers(contact, ["I can't breathe", "", "", "", ""])
        fake.hung_up.add(contact)
        calling.check_calls(force=True)
        daniel = store.get_resident("r-001")
        self.assertEqual((daniel.status, daniel.rule_id), (Status.HELP_NOW, "R0"))

    def test_empty_attributes_is_a_missed_call(self):
        fake = use_fake_connect(self, max_lines=1)
        calling.start_outage("A")
        contact = store.get_resident("r-001").contact_id
        fake.set_answers(contact, ["", "", "", "", ""])   # all blank
        fake.hung_up.add(contact)
        calling.check_calls(force=True)
        self.assertEqual(store.get_resident("r-001").missed_calls, 1)

    def test_attributes_not_ready_leaves_resident_calling(self):
        fake = use_fake_connect(self, fake=FakeConnect(attrs_error=True), max_lines=1)
        calling.start_outage("A")
        fake.hung_up.add(store.get_resident("r-001").contact_id)
        calling.check_calls(force=True)                   # GetContactAttributes errors
        self.assertEqual(store.get_resident("r-001").status, Status.CALLING)  # read again next poll

    def test_bedrock_failure_ranks_r4(self):
        from botocore.exceptions import ClientError
        fake = use_fake_connect(self, max_lines=1)
        throttled = ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow"}},
                                "Converse")
        use_fake_bedrock(self, FakeBedrock(error=throttled))
        calling.start_outage("A")
        contact = store.get_resident("r-001").contact_id
        fake.set_answers(contact, ["yes", "yes", "one", "two hours", "no"])
        fake.hung_up.add(contact)
        calling.check_calls(force=True)
        daniel = store.get_resident("r-001")
        self.assertEqual((daniel.status, daniel.rule_id), (Status.PERSON_CHECK, "R4"))
        self.assertFalse(daniel.ai["ok"])

    def test_timer_catches_silent_calls(self):
        use_fake_connect(self, max_lines=1)
        calling.start_outage("A")
        daniel = store.get_resident("r-001")
        store.transition("r-001", Status.CALLING, {
            "call_started_at": daniel.call_started_at - timedelta(seconds=calling.NO_ANSWER_SECONDS * 2 + 1)})
        calling.check_calls(force=True)
        self.assertEqual(store.get_resident("r-001").missed_calls, 1)

    def test_call_in_progress_is_left_alone(self):
        use_fake_connect(self)
        calling.start_outage("A")
        calling.check_calls(force=True)
        self.assertEqual(store.get_resident("r-001").status, Status.CALLING)


if __name__ == "__main__":
    unittest.main()
