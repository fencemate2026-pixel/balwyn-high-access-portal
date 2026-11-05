"""Exercise the real service loop with a virtual clock; no networking or gate access."""
import contextlib
import os
import sys
import unittest
import urllib.error
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import mildura_mirror as m


class StopLoop(Exception):
    pass


class ReconnectTests(unittest.TestCase):
    def run_loop(self, sync_outcomes, command_outcomes, sleeps=20, control=True):
        clock, waits, pushes, polls, logs = [0.0], [], [], [], []
        config = {"MIRROR_URL": "https://example.invalid", "MIRROR_DEVICE_ID": "test",
                  "MIRROR_SECRET": "x" * 40, "MIRROR_DB": "/fake/gate.db",
                  "MIRROR_CONTROL": "1" if control else "0"}

        def call(outcomes, calls):
            calls.append(clock[0])
            value = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
            if isinstance(value, Exception):
                raise value
            return value

        def sleep(seconds):
            waits.append(seconds)
            if len(waits) >= sleeps:
                raise StopLoop()
            clock[0] += seconds

        with contextlib.ExitStack() as stack:
            for target, replacement in [
                ("read_creds", lambda p: config), ("load_state", lambda p: {}),
                ("cycle", lambda *a: call(sync_outcomes, pushes)),
                ("command_cycle", lambda *a: call(command_outcomes, polls)),
                ("log", logs.append),
            ]:
                stack.enter_context(patch.object(m, target, replacement))
            stack.enter_context(patch.object(m.os.path, "exists", return_value=True))
            stack.enter_context(patch.object(m.time, "monotonic", lambda: clock[0]))
            stack.enter_context(patch.object(m.time, "sleep", sleep))
            with self.assertRaises(StopLoop):
                m.main()
        return waits, pushes, polls, logs

    def test_prolonged_network_outage_keeps_retrying_every_five_seconds(self):
        error = urllib.error.URLError("offline")
        waits, pushes, polls, logs = self.run_loop([error], [error], sleeps=80)
        self.assertEqual(polls, [5.0 * i for i in range(80)])
        self.assertEqual(pushes, polls)
        self.assertTrue(all(t == 5 for t in waits))
        self.assertNotIn("x" * 40, " ".join(logs))

    def test_recovered_empty_poll_refreshes_snapshot_immediately(self):
        error = urllib.error.URLError("offline")
        waits, pushes, polls, logs = self.run_loop([error, False], [error, error, 0], sleeps=7)
        self.assertEqual(pushes[:3], [0.0, 5.0, 10.5])
        self.assertIn("sync connection restored", logs)
        self.assertIn("command connection restored", logs)
        self.assertTrue(all(t <= 5 for t in waits))

    def test_sync_failure_does_not_stop_command_polling(self):
        _, pushes, polls, _ = self.run_loop([OSError("offline")], [0], sleeps=12)
        self.assertEqual(polls, [5.0 * i for i in range(12)])
        self.assertEqual(pushes, polls)

    def test_command_failure_does_not_back_off_to_minutes(self):
        _, pushes, polls, _ = self.run_loop([False], [ConnectionResetError()], sleeps=30)
        self.assertEqual(polls, [5.0 * i for i in range(30)])
        self.assertEqual(pushes, [0, 60, 120])

    def test_read_only_mode_also_recovers_without_minutes_of_backoff(self):
        error = urllib.error.URLError("offline")
        waits, pushes, polls, _ = self.run_loop([error], [0], sleeps=10, control=False)
        self.assertEqual(polls, [])
        self.assertEqual(pushes, [5.0 * i for i in range(10)])
        self.assertEqual(waits, [5] * 10)


if __name__ == "__main__":
    unittest.main()
