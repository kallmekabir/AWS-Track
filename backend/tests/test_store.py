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
        """Another worker saves an answer between our read and our write: both changes survive."""
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


class QueueOrderTest(unittest.TestCase):
    def test_not_called_sort_by_round1_a_group1_zero_backup_follows_daniel(self):
        from app.models import Resident
        # Fresh roster, nobody called yet: queue order must follow round 1
        # (device group, then fewest backups on file, then id), reusing ranking.round1_key.
        residents = [
            Resident(id="r-001", name="Daniel Kim", phone="+14085550102", address="a",
                     lat=0, lng=0, device="Home ventilator", backups_on_file=0),   # group 1, 0 backups
            Resident(id="r-002", name="Ruth", phone="+14085550103", address="a",
                     lat=0, lng=0, device="Oxygen concentrator", backups_on_file=1),  # group 1, 1 backup
            Resident(id="r-050", name="Rosa", phone="+14085550199", address="a",
                     lat=0, lng=0, device="Oxygen concentrator", backups_on_file=0),  # group 1, 0 backups
            Resident(id="r-007", name="George", phone="+14085550127", address="a",
                     lat=0, lng=0, device="CPAP machine", backups_on_file=1),         # group 3
        ]
        store.use_memory(residents)
        order = [r.id for r in store.queue()]
        # Daniel and Rosa both group 1 with 0 backups -> tie broken by id: r-001 then r-050,
        # both before Ruth (1 backup) and George (group 3).
        self.assertEqual(order, ["r-001", "r-050", "r-002", "r-007"])


if __name__ == "__main__":
    unittest.main()
