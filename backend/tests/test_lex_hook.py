import unittest

from app import calling, store
from app.models import Status
from lambdas import lex_hook
from tests.fakes import use_fake_connect


def lex_turn(said: str, attrs: dict) -> dict:
    """Run one answer through lex_hook the way Lex V2 sends it."""
    event = {
        "inputTranscript": said,
        "invocationSource": "FulfillmentCodeHook",
        "sessionState": {
            "sessionAttributes": attrs,
            "intent": {"name": "FallbackIntent", "state": "ReadyForFulfillment"},
        },
    }
    return lex_hook.handler(event, None)


def dialog_type(response: dict) -> str:
    return response["sessionState"]["dialogAction"]["type"]


def spoken(response: dict) -> str:
    return response["messages"][0]["content"]


class ConversationTest(unittest.TestCase):
    def setUp(self):
        self.fake = use_fake_connect(self, max_lines=1)
        calling.start_outage("A")  # Daniel (r-001) is on the line

    def test_five_answers_then_close(self):
        answers = ["yes I'm okay", "it's on the tank", "one left", "maybe two hours",
                   "I can't drive to get more"]
        attrs = {"residentId": "r-001"}
        for i, said in enumerate(answers, start=1):
            response = lex_turn(said, attrs)
            attrs = response["sessionState"]["sessionAttributes"]
            if i < 5:
                self.assertEqual(dialog_type(response), "ElicitIntent")
                self.assertEqual(spoken(response), lex_hook.QUESTIONS[i + 1])
                live = store.get_resident("r-001")
                self.assertEqual(live.current_question, i + 1)  # dashboard shows progress
                self.assertEqual(len(live.transcript), i)

        self.assertEqual(dialog_type(response), "Close")
        self.assertEqual(response["sessionState"]["intent"]["state"], "Fulfilled")
        self.assertEqual(spoken(response), lex_hook.CLOSING)

        daniel = store.get_resident("r-001")
        self.assertEqual(daniel.status, Status.PERSON_CHECK)
        self.assertEqual([a.answer for a in daniel.transcript], answers)
        self.assertEqual(len(store.list_checkins("r-001")), 1)
        # The line came free, so the next person (Ruth) was called.
        self.assertEqual(self.fake.called_ids(), ["r-001", "r-002"])

    def test_emergency_words_end_the_call(self):
        response = lex_turn("I can't breathe", {"residentId": "r-001"})
        self.assertEqual(dialog_type(response), "Close")
        self.assertEqual(spoken(response), lex_hook.EMERGENCY_REPLY)
        daniel = store.get_resident("r-001")
        self.assertEqual((daniel.status, daniel.rule_id, daniel.emergency),
                         (Status.HELP_NOW, "R0", True))

    def test_asking_for_help_with_food_is_not_an_emergency(self):
        self.assertFalse(lex_hook.is_emergency("I could use some help with groceries"))
        self.assertTrue(lex_hook.is_emergency("Please help me"))
        self.assertTrue(lex_hook.is_emergency("I can’t breathe"))

    def test_silence_is_asked_again_once(self):
        attrs = {"residentId": "r-001"}
        first = lex_turn("", attrs)
        self.assertEqual(dialog_type(first), "ElicitIntent")
        self.assertEqual(spoken(first), lex_hook.NOT_HEARD + lex_hook.QUESTIONS[1])
        second = lex_turn("", first["sessionState"]["sessionAttributes"])
        self.assertEqual(spoken(second), lex_hook.QUESTIONS[2])
        self.assertEqual(store.get_resident("r-001").transcript[0].answer, "(no answer)")

    def test_lex_console_test_without_resident(self):
        response = lex_turn("yes", {})
        self.assertEqual(dialog_type(response), "ElicitIntent")
        self.assertEqual(store.get_resident("r-001").transcript, [])


if __name__ == "__main__":
    unittest.main()
