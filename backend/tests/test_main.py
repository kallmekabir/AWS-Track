import asyncio
import unittest
from unittest import mock

from app import calling, store
from app.main import app, lifespan
from app.models import Status
from tests.fakes import use_fake_connect


class BackgroundCheckerTest(unittest.IsolatedAsyncioTestCase):
    async def test_disconnected_call_finishes_without_dashboard_and_task_stops(self):
        fake = use_fake_connect(self, max_lines=1)
        calling.start_outage("A")
        contact_id = store.get_resident("r-001").contact_id
        fake.hung_up.add(contact_id)
        fake.attributes[contact_id] = {"answered": "yes", "a1": "yes"}
        with mock.patch.object(calling, "CHECK_EVERY_SECONDS", 0.01):
            with mock.patch.object(calling, "check_calls", wraps=calling.check_calls) as check:
                async with lifespan(app):
                    for _ in range(100):
                        if store.get_resident("r-001").status != Status.CALLING:
                            break
                        await asyncio.sleep(0.01)
                    self.assertEqual(store.get_resident("r-001").status, Status.PERSON_CHECK)
                    self.assertEqual(len(store.list_checkins("r-001")), 1)
                    check.assert_called_with(force=True)
                count = check.call_count
                await asyncio.sleep(0.03)
                self.assertEqual(check.call_count, count)

    async def test_background_failure_does_not_stop_checker(self):
        use_fake_connect(self)
        with mock.patch.object(calling, "CHECK_EVERY_SECONDS", 0.01):
            with mock.patch.object(calling, "check_calls", side_effect=[RuntimeError("temporary"), None]) as check:
                with self.assertLogs("app.main", level="ERROR"):
                    async with lifespan(app):
                        for _ in range(100):
                            if check.call_count >= 2:
                                break
                            await asyncio.sleep(0.01)
                        self.assertGreaterEqual(check.call_count, 2)
