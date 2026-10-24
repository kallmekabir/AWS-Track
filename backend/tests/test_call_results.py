import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest import mock

from botocore.exceptions import ClientError

from app import call_results, calling, script, store
from app.models import Status
from tests.fakes import use_fake_connect


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
        with mock.patch.object(call_results, "extract_facts", return_value=None) as extract:
            done = self.finish(FULL_CALL)
        self.assertEqual(done.status, Status.PERSON_CHECK)
        self.assertEqual(done.reason, "All 5 answers in. Waiting for ranking")
        expected = [{"q": q, "question": script.QUESTIONS[q], "answer": FULL_CALL[f"a{q}"]}
                    for q in range(1, 6)]
        self.assertEqual([a.model_dump() for a in done.transcript], expected)
        extract.assert_called_once_with(expected)
        self.assertEqual(store.list_checkins(done.id)[0]["transcript"], expected)
        self.assertEqual(self.fake.attribute_requests,
                         [{"InstanceId": "instance-1", "InitialContactId": self.contact_id}])
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])

    def test_partial_call(self):
        done = self.finish({"answered": "yes", "intent": "CheckIn", "a1": "yes", "a2": "working"})
        self.assertEqual(done.status, Status.PERSON_CHECK)
        self.assertEqual(done.reason, "Call ended after question 2 of 5")
        self.assertEqual(len(done.transcript), 2)
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
        self.assertIsNone(call_results.extract_facts([]))
