import unittest

from app import script


class EmergencyTest(unittest.TestCase):
    def test_asking_for_help_with_food_is_not_an_emergency(self):
        self.assertFalse(script.is_emergency("I could use some help with groceries"))
        self.assertTrue(script.is_emergency("Please help me"))
        self.assertTrue(script.is_emergency("I can’t breathe"))

    def test_all_phrases_and_case(self):
        for phrase in script.EMERGENCY_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertTrue(script.is_emergency(phrase.upper()))
        self.assertFalse(script.is_emergency(""))
