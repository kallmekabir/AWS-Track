"""Round 2 rules against docs/RANKING.md: the worked example and the 10 eval cases."""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.models import Status
from app.rules import no_answer_decision, rank_after_call
from app.understand import Facts

NOW = datetime(2026, 10, 24, 0, 0, tzinfo=timezone.utc)   # 5:00 PM in San Jose


def person(group=1, each=None):
    return SimpleNamespace(device_group=group, backup_hours_each=each)


def facts(**kw):
    base = {"safe": "yes", "device_working": "yes", "confidence": 0.9}
    return Facts(**{**base, **kw})


def rule(f, resident=None, drive=None):
    return rank_after_call(f, resident or person(), drive, now=NOW)


class WorkedExampleTest(unittest.TestCase):
    """docs/RANKING.md, "Worked example: Zone A demo"."""

    def test_daniel_device_off_no_backups(self):
        d = rule(facts(device_working="no", backup_left=0, hours_left=0), drive=25)
        self.assertEqual((d.level, d.rule_id), (Status.HELP_NOW, "R1"))

    def test_ruth_far_supplier_is_help_now(self):
        d = rule(facts(backup_left=1, hours_left=2), drive=70)
        self.assertEqual((d.level, d.rule_id), (Status.HELP_NOW, "R2"))
        self.assertEqual(d.reason, "Supplier 70 min away, 50 min to spare")

    def test_maria_same_words_near_supplier_is_help_soon(self):
        d = rule(facts(backup_left=1, hours_left=2, needs=["transport", "oxygen_delivery"]), drive=15)
        self.assertEqual((d.level, d.rule_id, d.reason), (Status.HELP_SOON, "R3", "1 backup left"))
        self.assertAlmostEqual(d.time_to_spare, 1.75)

    def test_linh_needs_supplies(self):
        d = rule(facts(backup_left=3, hours_left=9, needs=["charging"]), drive=20)
        self.assertEqual((d.level, d.rule_id, d.reason),
                         (Status.NEEDS_SUPPLIES, "R5", "Needs a place to charge"))
        self.assertEqual(d.runs_out_at, NOW + timedelta(hours=9))


class EvalCasesTest(unittest.TestCase):
    """docs/RANKING.md, "Test cases for eval/run.py", with the facts Bedrock should return."""

    def test_cases(self):
        cases = [
            (1, facts(emergency=True, safe="unsure"), person(), None, "R0"),
            (2, facts(safe="no"), person(), None, "R0"),
            (3, facts(device_working="no", backup_left=0), person(1), None, "R1"),
            (4, facts(backup_left=1, hours_left=2), person(), 70, "R2"),
            (5, facts(backup_left=1, hours_left=2), person(), 15, "R3"),
            (6, facts(backup_left=2, hours_left=3), person(), 20, "R3"),
            (7, facts(device_working="unsure", confidence=0.3), person(1), None, "R4"),
            (8, facts(needs=["food"]), person(3), 20, "R5"),
            (9, facts(hours_left=8), person(), 20, "R6"),
        ]
        for n, f, resident, drive, expected in cases:
            with self.subTest(case=n):
                self.assertEqual(rule(f, resident, drive).rule_id, expected)

    def test_case_10_no_answer_twice(self):
        d = no_answer_decision(2)
        self.assertEqual((d.level, d.rule_id), (Status.HELP_SOON, "NA"))


class EdgeCaseTest(unittest.TestCase):
    def test_danger_rules_beat_unclear(self):
        """R0-R3 come before R4: unsure but in danger still gets help."""
        d = rule(facts(backup_left=1, hours_left=2, confidence=0.2), drive=70)
        self.assertEqual(d.rule_id, "R2")

    def test_hours_from_backups_when_not_said(self):
        d = rule(facts(backup_left=2), person(each=3), drive=20)
        self.assertEqual(d.hours_left, 6)
        self.assertEqual(d.rule_id, "R6")

    def test_unknown_drive_uses_hours_left(self):
        d = rule(facts(backup_left=2, hours_left=0.5))
        self.assertEqual((d.rule_id, d.reason), ("R2", "30 min to spare (drive time unknown)"))

    def test_exactly_4_hours_is_not_help_soon(self):
        self.assertEqual(rule(facts(backup_left=2, hours_left=4), drive=0).rule_id, "R6")

    def test_confidence_exactly_0_7_is_not_unclear(self):
        self.assertEqual(rule(facts(hours_left=8, confidence=0.7), drive=20).rule_id, "R6")

    def test_group_2_unknown_hours_is_not_unclear(self):
        self.assertEqual(rule(facts(), person(2)).rule_id, "R6")

    def test_ok_for_now_recheck_time(self):
        d = rule(facts(hours_left=8), drive=20)
        self.assertEqual(d.recheck_at, NOW + timedelta(hours=3))      # capped at 3 h
        self.assertEqual(d.reason, "Enough supply. Calling again at 8:00 PM")

    def test_recheck_capped_at_3_hours(self):
        """R5/R6 only fire with 4+ hours (or unknown), so runs_out_at - 1 h is always past the cap."""
        d = rule(facts(hours_left=4.5, needs=["food"]), drive=0)
        self.assertEqual(d.recheck_at, NOW + timedelta(hours=3))
        d = rule(facts(backup_left=3, needs=["food"]), person(3), drive=0)   # hours unknown
        self.assertEqual(d.recheck_at, NOW + timedelta(hours=3))


if __name__ == "__main__":
    unittest.main()
