import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest import mock

from botocore.exceptions import ClientError

from app import call_results, calling, script, store
from app.models import Status
from tests.fakes import use_fake_connect
from tests.test_understand import GOOD, FakeBedrock, use_fake_bedrock


FULL_CALL = {"answered": "yes", "intent": "CheckIn", "a1": "yes I'm okay",
             "a2": "it's on the tank", "a3": "one left", "a4": "maybe two hours",
             "a5": "I can't drive to get more"}


class CallResultsTest(unittest.TestCase):
    def setUp(self):
        self.fake = use_fake_connect(self, max_lines=1)
        calling.start_outage("A")
        self.resident = store.get_resident("r-001")
        self.contact_id = self.resident.contact_id

    def finish(self, attrs):
        self.fake.attributes[self.contact_id] = attrs
        self.fake.hung_up.add(self.contact_id)
        calling.check_calls(force=True)
        return store.get_resident("r-001")

    def test_emergency_intent_without_answers(self):
        done = self.finish({"answered": "yes", "intent": "Emergency"})
        self.assertEqual((done.status, done.rule_id, done.emergency),
                         (Status.HELP_NOW, "R0", True))
        self.assertEqual(len(store.list_checkins(done.id)), 1)
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])

    def test_emergency_phrase_in_a5(self):
        done = self.finish({**FULL_CALL, "a5": "Actually I can’t breathe"})
        self.assertEqual((done.status, done.rule_id, done.emergency),
                         (Status.HELP_NOW, "R0", True))
        self.assertEqual(done.transcript[-1].answer, "Actually I can’t breathe")
        self.assertEqual(len(done.transcript), 5)

    def test_five_answers_saved_then_next_person_called(self):
        use_fake_bedrock(self, FakeBedrock(GOOD))   # safe/device yes, 1 tank, 2 h
        done = self.finish(FULL_CALL)
        # Full answers now go through Bedrock + rules (not the old "Waiting for ranking").
        self.assertEqual(done.status, Status.HELP_SOON)
        self.assertEqual(done.rule_id, "R3")        # Daniel group 1, 1 backup left
        self.assertIsNotNone(done.facts)
        self.assertTrue(done.ai["ok"])
        expected = [{"q": q, "question": script.QUESTIONS[q], "answer": FULL_CALL[f"a{q}"]}
                    for q in range(1, 6)]
        self.assertEqual([a.model_dump() for a in done.transcript], expected)
        self.assertEqual(store.list_checkins(done.id)[0]["transcript"], expected)
        self.assertEqual(store.list_checkins(done.id)[0]["facts"], done.facts)
        self.assertEqual(self.fake.attribute_requests,
                         [{"InstanceId": "instance-1", "InitialContactId": self.contact_id}])
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])

    def test_partial_call(self):
        # Partial answers are ranked too; an unclear extraction -> R4.
        use_fake_bedrock(self, FakeBedrock({
            "safe": "yes", "device_working": "yes", "backup_left": None,
            "hours_left": None, "needs": [], "emergency": False, "confidence": 0.3}))
        done = self.finish({"answered": "yes", "intent": "CheckIn", "a1": "yes", "a2": "working"})
        self.assertEqual((done.status, done.rule_id), (Status.PERSON_CHECK, "R4"))
        self.assertEqual(len(done.transcript), 2)
        self.assertIsNotNone(done.facts)
        self.assertEqual(len(store.list_checkins(done.id)), 1)

    def test_empty_answers_are_missed(self):
        done = self.finish({"answered": "yes", "outcome": "no_input", "a1": "  "})
        self.assertEqual((done.status, done.missed_calls), (Status.NOT_CALLED, 1))
        self.assertEqual(done.transcript, [])

    def test_not_answered_is_missed_even_with_slots(self):
        done = self.finish({**FULL_CALL, "answered": "no"})
        self.assertEqual((done.status, done.missed_calls), (Status.NOT_CALLED, 1))

    def test_double_processing_saves_once(self):
        self.finish(FULL_CALL)
        self.assertFalse(call_results.finish_call(self.resident))
        self.assertEqual(len(store.list_checkins(self.resident.id)), 1)
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])

    def test_old_result_cannot_overwrite_a_new_call(self):
        self.finish(FULL_CALL)
        new_call = calling.start_call(store.get_resident(self.resident.id))
        self.assertFalse(call_results.finish_call(self.resident))
        current = store.get_resident(self.resident.id)
        self.assertEqual(current.contact_id, new_call.contact_id)
        self.assertEqual(current.status, Status.CALLING)
        self.assertEqual(len(store.list_checkins(current.id)), 1)

    def test_attribute_failure_retried_without_losing_call(self):
        self.fake.hung_up.add(self.contact_id)
        error = ClientError({"Error": {"Code": "ThrottlingException", "Message": "retry"}},
                            "GetContactAttributes")
        with mock.patch.object(self.fake, "get_contact_attributes", side_effect=error):
            with self.assertLogs(calling.__name__, level="ERROR"):
                calling.check_calls(force=True)
        self.assertEqual(store.get_resident(self.resident.id).status, Status.CALLING)
        self.assertEqual(store.list_checkins(self.resident.id), [])
        self.finish(FULL_CALL)
        self.assertEqual(len(store.list_checkins(self.resident.id)), 1)

    def test_concurrent_checks_save_once_and_obey_line_limit(self):
        self.fake.attributes[self.contact_id] = FULL_CALL
        self.fake.hung_up.add(self.contact_id)
        entered, release = threading.Event(), threading.Event()
        fetch = call_results.fetch

        def slow_fetch(contact_id):
            entered.set()
            self.assertTrue(release.wait(5))
            return fetch(contact_id)

        with mock.patch.object(call_results, "fetch", side_effect=slow_fetch):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(calling.check_calls, force=True)
                try:
                    self.assertTrue(entered.wait(5))
                    pool.submit(calling.check_calls, force=True).result(timeout=5)
                finally:
                    release.set()
                first.result(timeout=5)
        self.assertEqual(len(store.list_checkins(self.resident.id)), 1)
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])
        self.assertEqual(calling._lines_in_use(), 1)

    def test_dry_run_completes_five_answers_without_connect(self):
        store.reset_live_state()
        with mock.patch.object(calling, "DRY_RUN", True):
            calling.start_outage("A")
            resident = store.get_resident(self.resident.id)
            self.assertTrue(resident.contact_id.startswith("dry-run-"))
            store.transition(resident.id, Status.CALLING, {
                "call_started_at": calling._now() - timedelta(seconds=calling.CHECK_EVERY_SECONDS + 1)})
            with mock.patch.object(calling, "_connect", side_effect=AssertionError("must stay offline")):
                calling.check_calls(force=True)
        done = store.get_resident(self.resident.id)
        self.assertEqual(done.status, Status.PERSON_CHECK)
        self.assertEqual(len(done.transcript), 5)
        self.assertEqual(len(store.list_checkins(done.id)), 1)


class TranscriptTest(unittest.TestCase):
    def test_sparse_answers_keep_question_numbers_and_wording(self):
        self.assertEqual(call_results.to_transcript({"a1": "", "a2": " ", "a5": "  Food please  "}),
                         [{"q": 5, "question": script.QUESTIONS[5], "answer": "  Food please  "}])

    def test_phase_two_hook_is_placeholder(self):
        # The stub is gone; rank_call now returns a real decision with facts + ai.
        use_fake_bedrock(self, FakeBedrock(GOOD))
        resident = store.get_resident("r-002")  # Ruth, drive 70
        transcript = call_results.to_transcript(FULL_CALL)
        changes = call_results.rank_call(resident, transcript, emergency=False)
        self.assertEqual(changes["status"], Status.HELP_NOW)   # Ruth 70 min -> R2
        self.assertEqual(changes["rule_id"], "R2")
        self.assertIn("facts", changes)
        self.assertTrue(changes["ai"]["ok"])


ONE_TANK_TWO_HOURS = {"safe": "yes", "device_working": "yes", "backup_left": 1,
                      "hours_left": 2, "needs": [], "emergency": False, "confidence": 0.9}


class RankingWiringTest(unittest.TestCase):
    """Ported from finish/no-lambda: Bedrock + round-2 rules wired into the call path."""

    def _finish(self, fake, attrs, resident_id="r-001"):
        contact = store.get_resident(resident_id).contact_id
        fake.attributes[contact] = attrs
        fake.hung_up.add(contact)
        calling.check_calls(force=True)
        return store.get_resident(resident_id)

    def test_full_answers_ranked_with_facts(self):
        fake = use_fake_connect(self, max_lines=1)
        use_fake_bedrock(self, FakeBedrock(GOOD))
        calling.start_outage("A")
        done = self._finish(fake, FULL_CALL)
        self.assertIn(done.rule_id, ("R1", "R2", "R3"))
        self.assertIsNotNone(done.facts)
        self.assertTrue(done.ai["ok"])

    def test_emergency_intent_is_r0_with_facts(self):
        fake = use_fake_connect(self, max_lines=1)
        use_fake_bedrock(self, FakeBedrock(GOOD))   # Bedrock says emergency False
        calling.start_outage("A")
        done = self._finish(fake, {**FULL_CALL, "intent": "Emergency"})
        self.assertEqual((done.status, done.rule_id, done.emergency),
                         (Status.HELP_NOW, "R0", True))
        self.assertIsNotNone(done.facts)   # facts still saved

    def test_bedrock_failure_ranks_r4(self):
        fake = use_fake_connect(self, max_lines=1)
        throttled = ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow"}},
                                "Converse")
        use_fake_bedrock(self, FakeBedrock(error=throttled))
        calling.start_outage("A")
        done = self._finish(fake, FULL_CALL)
        self.assertEqual((done.status, done.rule_id), (Status.PERSON_CHECK, "R4"))
        self.assertFalse(done.ai["ok"])

    def test_queue_ruth_r2_above_maria_r3(self):
        use_fake_connect(self)
        use_fake_bedrock(self, FakeBedrock(ONE_TANK_TWO_HOURS))
        from app import main
        from app.main import TranscriptIn
        answers = ["yes", "yes on the tank", "one tank", "about two hours", "no"]
        ruth = main.typed_transcript("r-002", TranscriptIn(answers=answers))
        maria = main.typed_transcript("r-003", TranscriptIn(answers=answers))
        self.assertEqual((ruth.status, ruth.rule_id), (Status.HELP_NOW, "R2"))
        self.assertEqual((maria.status, maria.rule_id), (Status.HELP_SOON, "R3"))
        order = [r.id for r in store.queue("A")]
        self.assertLess(order.index("r-002"), order.index("r-003"))

    def test_typed_endpoint_masks_phone(self):
        use_fake_connect(self)
        use_fake_bedrock(self, FakeBedrock(ONE_TANK_TWO_HOURS))
        from app import main
        from app.main import TranscriptIn
        out = main.typed_transcript("r-002", TranscriptIn(answers=[
            "yes", "yes it's on the tank", "one tank left", "about two hours", "no"]))
        self.assertRegex(out.phone, r"^\+1-XXX-XXX-\d{4}$")
        self.assertNotIn("5550000", out.phone)
        self.assertTrue(out.ai["ok"])
