import unittest

from app.ranking import device_group_for, round1_order
from tests.fakes import team_roster


class DeviceGroupTest(unittest.TestCase):
    def test_groups_from_device(self):
        self.assertEqual(device_group_for("Oxygen concentrator"), 1)
        self.assertEqual(device_group_for("Home ventilator"), 1)
        self.assertEqual(device_group_for("Home dialysis"), 2)
        self.assertEqual(device_group_for("Infusion pump"), 2)
        self.assertEqual(device_group_for("CPAP machine"), 3)
        self.assertEqual(device_group_for("Something new"), 3)


class Round1Test(unittest.TestCase):
    def test_matches_worked_example(self):
        """docs/RANKING.md: Daniel (0), Ruth (1), Maria (2), Linh (3), then Samuel, George."""
        names = [r.name for r in round1_order(team_roster())]
        self.assertEqual(names[:4], ["Daniel Kim", "Ruth Okafor", "Maria Lopez", "Linh Tran"])
        self.assertLess(names.index("Samuel Reyes"), names.index("George Patel"))


if __name__ == "__main__":
    unittest.main()
