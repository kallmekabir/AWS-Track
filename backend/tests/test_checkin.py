"""Tests for the no-Lambda check-in path: finish_checkin, the /transcript endpoint,
and queue ordering by time to spare (docs/RANKING.md)."""
import unittest

from app import checkin, main, store
from app.main import TranscriptIn
from app.models import Status
from tests.fakes import team_roster
from tests.test_understand import FakeBedrock, use_fake_bedrock

# Ruth and Maria both: safe/device yes, 1 tank, 2 hours left, no needs.
ONE_TANK_TWO_HOURS = {"safe": "yes", "device_working": "yes", "backup_left": 1,
                      "hours_left": 2, "needs": [], "emergency": False, "confidence": 0.9}


class TranscriptEndpointTest(unittest.TestCase):
    def setUp(self):
        store.use_memory(team_roster())
        use_fake_bedrock(self, FakeBedrock(ONE_TANK_TWO_HOURS))

    def test_typed_transcript_ranks_and_masks_phone(self):
        # Call the route function directly (httpx/TestClient isn't installed).
        body = main.typed_transcript("r-002", TranscriptIn(answers=[
            "yes", "yes it's on the tank", "one tank left", "about two hours", "no"]))
        # Ruth, drive 70 min, 2 h left -> ~50 min to spare -> R2 HELP_NOW
        self.assertEqual((body.status, body.rule_id), (Status.HELP_NOW, "R2"))
        self.assertIsNotNone(body.facts)
        self.assertTrue(body.ai["ok"])
        # phone is masked in the API response
        self.assertRegex(body.phone, r"^\+1-XXX-XXX-\d{4}$")
        self.assertNotIn("5550000", body.phone)


class QueueOrderTest(unittest.TestCase):
    def test_ruth_r2_above_maria_r3(self):
        store.use_memory(team_roster())
        use_fake_bedrock(self, FakeBedrock(ONE_TANK_TWO_HOURS))
        answers = ["yes", "yes on the tank", "one tank", "about two hours", "no"]
        # Ruth (r-002, drive 70) -> R2 HELP_NOW; Maria (r-003, drive 15) -> R3 HELP_SOON
        ruth = checkin.finish_checkin("r-002", answers, source="typed")
        maria = checkin.finish_checkin("r-003", answers, source="typed")
        self.assertEqual((ruth.status, ruth.rule_id), (Status.HELP_NOW, "R2"))
        self.assertEqual((maria.status, maria.rule_id), (Status.HELP_SOON, "R3"))

        order = [r.id for r in store.queue("A")]
        self.assertLess(order.index("r-002"), order.index("r-003"))  # Ruth above Maria


if __name__ == "__main__":
    unittest.main()
