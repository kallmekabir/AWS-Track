import unittest
from unittest import mock

from botocore.exceptions import ClientError

from app import understand
from app.models import Answer

GOOD = {"safe": "yes", "device_working": "yes", "backup_left": 1, "hours_left": 2,
        "needs": ["transport", "oxygen_delivery"], "emergency": False, "confidence": 0.9}


class FakeBedrock:
    """Answers Converse with a canned record_checkin tool call (or a canned failure)."""

    def __init__(self, tool_input=None, error=None, text_only=False):
        self.tool_input, self.error, self.text_only = tool_input, error, text_only
        self.requests: list[dict] = []

    def converse(self, **request):
        self.requests.append(request)
        if self.error:
            raise self.error
        if self.text_only:
            content = [{"text": "I think they are fine."}]
        else:
            content = [{"toolUse": {"toolUseId": "t1", "name": "record_checkin",
                                    "input": self.tool_input}}]
        return {"output": {"message": {"role": "assistant", "content": content}}}


def use_fake_bedrock(test, fake: FakeBedrock) -> FakeBedrock:
    patcher = mock.patch.multiple(understand, MODEL_ID="us.amazon.nova-lite-v1:0", _client=fake)
    patcher.start()
    test.addCleanup(patcher.stop)
    return fake


TRANSCRIPT = [
    Answer(q=1, question="Are you safe right now?", answer="Yeah I'm okay"),
    Answer(q=4, question="About how many hours?", answer="One tank, maybe two hours. Call me at 408-555-0134"),
]


class ExtractFactsTest(unittest.TestCase):
    def test_valid_reply(self):
        use_fake_bedrock(self, FakeBedrock(GOOD))
        result = understand.extract_facts(TRANSCRIPT)
        self.assertTrue(result.ok)
        self.assertEqual(result.facts.model_dump(), GOOD)
        self.assertEqual(result.problems, [])

    def test_request_is_forced_tool_at_temperature_0(self):
        fake = use_fake_bedrock(self, FakeBedrock(GOOD))
        understand.extract_facts(TRANSCRIPT)
        request = fake.requests[0]
        self.assertEqual(request["modelId"], "us.amazon.nova-lite-v1:0")
        self.assertEqual(request["inferenceConfig"]["temperature"], 0)
        self.assertEqual(request["toolConfig"]["toolChoice"], {"tool": {"name": "record_checkin"}})

    def test_phone_numbers_never_reach_bedrock(self):
        fake = use_fake_bedrock(self, FakeBedrock(GOOD))
        result = understand.extract_facts(TRANSCRIPT)
        sent = fake.requests[0]["messages"][0]["content"][0]["text"]
        self.assertNotIn("555-0134", sent)
        self.assertIn("[PHONE]", sent)
        self.assertNotIn("555-0134", result.transcript)

    def test_bad_field_becomes_unknown_and_lowers_confidence(self):
        use_fake_bedrock(self, FakeBedrock({**GOOD, "hours_left": "a while", "safe": "maybe",
                                            "needs": ["food", "pizza"]}))
        result = understand.extract_facts(TRANSCRIPT)
        self.assertTrue(result.ok)
        self.assertIsNone(result.facts.hours_left)
        self.assertEqual(result.facts.safe, "unsure")
        self.assertEqual(result.facts.needs, ["food"])
        self.assertEqual(result.facts.backup_left, 1)          # good fields are kept
        self.assertEqual(result.facts.confidence, understand.LOW_CONFIDENCE)
        self.assertEqual(len(result.problems), 3)

    def test_words_as_numbers_are_accepted(self):
        use_fake_bedrock(self, FakeBedrock({**GOOD, "hours_left": "2.5", "emergency": "false"}))
        result = understand.extract_facts(TRANSCRIPT)
        self.assertEqual(result.facts.hours_left, 2.5)
        self.assertFalse(result.facts.emergency)
        self.assertEqual(result.problems, [])

    def test_no_tool_call_means_everything_unknown(self):
        use_fake_bedrock(self, FakeBedrock(text_only=True))
        result = understand.extract_facts(TRANSCRIPT)
        self.assertFalse(result.ok)
        self.assertEqual(result.facts, understand.Facts())
        self.assertEqual(result.facts.confidence, 0)

    def test_bedrock_error_never_raises(self):
        throttled = ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow down"}},
                                "Converse")
        use_fake_bedrock(self, FakeBedrock(error=throttled))
        result = understand.extract_facts(TRANSCRIPT)
        self.assertFalse(result.ok)
        self.assertIn("ThrottlingException", result.problems[0])

    def test_missing_model_id_never_raises(self):
        with mock.patch.object(understand, "MODEL_ID", ""):
            result = understand.extract_facts(TRANSCRIPT)
        self.assertFalse(result.ok)
        self.assertIn("BEDROCK_MODEL_ID", result.problems[0])

    def test_phrase_check_can_add_emergency_but_bedrock_cannot_remove_it(self):
        use_fake_bedrock(self, FakeBedrock(GOOD))   # Bedrock says no emergency
        self.assertTrue(understand.extract_facts(TRANSCRIPT, said_emergency=True).facts.emergency)

    def test_string_transcript(self):
        self.assertEqual(understand.transcript_text("  hi, email me at a@b.com "), "hi, email me at [EMAIL]")


if __name__ == "__main__":
    unittest.main()
