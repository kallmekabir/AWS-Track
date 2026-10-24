import unittest
from datetime import timedelta
from unittest import mock

from app import calling, store
from app.models import Answer, Status
from tests.fakes import use_fake_connect


class TransitionTest(unittest.TestCase):
    def setUp(self):
        use_fake_connect(self)
        calling.start_outage("A")

    def test_concurrent_update_is_not_lost(self):
        """Another Lambda saves an answer between our read and our write: both changes survive."""
        backend = store._backend
        real_get = backend.get
        raced = []

        def get_then_someone_else_writes(resident_id):
            current = real_get(resident_id)
            if not raced:
                raced.append(True)
                backend.put(current.model_copy(update={
                    "transcript": [Answer(q=1, question="Are you safe?", answer="yes")],
                    "updated_at": current.updated_at + timedelta(seconds=1)}))
            return current

        with mock.patch.object(backend, "get", side_effect=get_then_someone_else_writes):
            done = store.transition("r-001", Status.CALLING, {"reason": "checked"})

        self.assertEqual(done.reason, "checked")
        self.assertEqual(len(done.transcript), 1)
        self.assertEqual(store.get_resident("r-001").transcript[0].answer, "yes")

    def test_wrong_status_or_contact_is_refused(self):
        self.assertIsNone(store.transition("r-001", Status.NOT_CALLED, {"reason": "x"}))
        self.assertIsNone(store.transition("r-001", Status.CALLING, {"reason": "x"}, contact_id="other"))

    def test_reset_clears_the_outage_but_keeps_the_registry(self):
        daniel = store.get_resident("r-001")
        self.assertEqual(store.reset_live_state("A"), 8)
        after = store.get_resident("r-001")
        self.assertEqual((after.status, after.contact_id, after.missed_calls), (Status.NOT_CALLED, None, 0))
        self.assertEqual((after.phone, after.allow_call), (daniel.phone, True))


if __name__ == "__main__":
    unittest.main()
