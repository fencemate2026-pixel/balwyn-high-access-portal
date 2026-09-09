import http.client
import importlib.util
import json
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("door_service", Path(__file__).parents[1] / "door_service.py")
service = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = service
spec.loader.exec_module(service)
TOKEN = "test-only-token-that-is-longer-than-32-chars"
PINS = (17, 27, 22, 23)


class RecordingOutputs(service.MockOutputs):
    def __init__(self, config):
        super().__init__(config)
        self.writes = []
        self.activated = threading.Event()
        self.fail = False

    def write(self, pin, active):
        self.writes.append((pin, active, time.monotonic()))
        super().write(pin, active)
        if active:
            self.activated.set()
            if self.fail:
                raise OSError("Injected GPIO failure")


class DoorServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = service.Config(TOKEN, PINS, pulse_ms=300, mode="hardware", journal=str(Path(self.temp.name) / "requests.sqlite3"))
        self.outputs = RecordingOutputs(self.config)
        self.controller = service.DoorController(self.config, self.outputs)
        self.server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.make_handler(self.controller))
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01))
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.controller.close()
        self.temp.cleanup()

    def request(self, path="/doors/1/open", token=TOKEN, method="POST", request_id=None, body=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        headers = {"Idempotency-Key": request_id if request_id is not None else str(uuid.uuid4())}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    def test_each_route_pulses_only_its_own_channel_and_reports_unknown(self):
        for door, pin in enumerate(PINS, 1):
            with self.subTest(door=door):
                start = len(self.outputs.writes)
                status, body = self.request(f"/doors/{door}/open")
                self.assertEqual(status, 200)
                self.assertEqual(body["door"], door)
                self.assertEqual(body["status"], "pulsed")
                self.assertEqual(body["position"], "unknown")
                self.assertFalse(body["sensor_feedback"])
                writes = self.outputs.writes[start:]
                self.assertEqual([(p, on) for p, on, _ in writes], [(pin, True), (pin, False)])
                self.assertGreaterEqual(writes[1][2] - writes[0][2], 0.29)
                self.assertLess(writes[1][2] - writes[0][2], 0.8)
                self.assertFalse(any(self.outputs.states.values()))

    def test_rejected_requests_never_touch_gpio(self):
        for token in [None, "incorrect"]:
            self.assertEqual(self.request(token=token)[0], 401)
        for path in ["/doors/0/open", "/doors/5/open", "/doors/-1/open", "/doors/1/close", "/doors/1/open?pin=23", "/doors/01/open"]:
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request(method="GET")[0], 405)
        self.assertEqual(self.request(body='{"pin":23,"pulse_ms":999}')[0], 400)
        self.assertEqual(self.request(request_id="")[0], 400)
        self.assertEqual(self.outputs.writes, [])

    def test_concurrent_command_is_rejected_without_queueing(self):
        first = threading.Thread(target=self.request)
        first.start()
        self.assertTrue(self.outputs.activated.wait(1))
        self.assertEqual(self.request("/doors/2/open")[0], 409)
        first.join()
        self.assertEqual([(p, on) for p, on, _ in self.outputs.writes], [(17, True), (17, False)])

    def test_gpio_exception_deenergises_channel_and_latches_fault(self):
        self.outputs.fail = True
        self.assertEqual(self.request()[0], 503)
        self.assertFalse(any(self.outputs.states.values()))
        self.assertEqual(self.request("/doors/2/open")[0], 503)
        self.assertEqual(len(self.outputs.writes), 2)

    def test_replay_and_restart_do_not_repeat_pulse(self):
        key = str(uuid.uuid4())
        self.assertEqual(self.request(request_id=key)[0], 200)
        self.assertTrue(self.request(request_id=key)[1]["replayed"])
        self.assertEqual(self.request("/doors/2/open", request_id=key)[0], 409)
        outputs = RecordingOutputs(self.config)
        restarted = service.DoorController(self.config, outputs)
        self.assertTrue(restarted.open(1, key)[1]["replayed"])
        self.assertEqual(outputs.writes, [])
        restarted.close()
        self.assertEqual(len(self.outputs.writes), 2)

    def test_interrupted_journal_entry_never_replays(self):
        key = str(uuid.uuid4())
        with sqlite3.connect(self.config.journal) as db:
            db.execute("INSERT INTO requests VALUES (?, 1, NULL)", (key,))
        self.assertEqual(self.request(request_id=key)[0], 409)
        self.assertEqual(self.outputs.writes, [])

    def test_shutdown_interrupts_pulse_and_turns_output_off(self):
        result = []
        thread = threading.Thread(target=lambda: result.append(self.request()))
        thread.start()
        self.assertTrue(self.outputs.activated.wait(1))
        self.controller.stopping.set()
        thread.join()
        self.assertEqual(result[0][0], 503)
        self.assertFalse(any(self.outputs.states.values()))

    def test_mock_mode_never_imports_gpio_and_reports_dry_run(self):
        config = service.Config(TOKEN, PINS, 300, "dry-run", journal=str(Path(self.temp.name) / "mock.sqlite3"))
        with patch.dict(sys.modules, {"lgpio": None}):
            controller = service.DoorController(config)
            self.assertIsInstance(controller.outputs, service.MockOutputs)
            self.assertEqual(controller.open(4, str(uuid.uuid4()))[1]["status"], "dry_run")
            controller.close()

    def test_active_low_and_high_hardware_start_inactive(self):
        for low in [True, False]:
            gpio = Mock()
            gpio.gpiochip_open.return_value = 9
            config = service.Config(TOKEN, PINS, active_low=low)
            with patch.dict(sys.modules, {"lgpio": gpio}):
                outputs = service.GpioOutputs(config)
                self.assertEqual([c.args for c in gpio.gpio_claim_output.call_args_list], [(9, p, int(low)) for p in PINS])
                outputs.write(22, True)
                gpio.gpio_write.assert_called_with(9, 22, int(not low))
                outputs.close()
                self.assertEqual([c.args for c in gpio.gpio_write.call_args_list][-4:], [(9, p, int(low)) for p in PINS])

    def test_configuration_rejects_unsafe_values(self):
        for pulse in [299, 801, 500.5, True]:
            with self.assertRaises(ValueError):
                service.Config(TOKEN, PINS, pulse_ms=pulse)
        for pins in [(17, 17, 22, 23), (17, 22), (0, 27, 22, 23)]:
            with self.assertRaises(ValueError):
                service.Config(TOKEN, pins)
        with patch.dict("os.environ", {"DOOR_MODE": "hardware", "DOOR_API_TOKEN": TOKEN}, clear=True):
            with self.assertRaises(ValueError):
                service.Config.from_env()
        with self.assertRaises(ValueError):
            service.Config("REPLACE_WITH_A_UNIQUE_RANDOM_TOKEN", PINS)

    def test_auth_token_is_never_logged(self):
        with self.assertLogs(service.LOG, level="INFO") as logs:
            self.request(token="bad-token-in-log-check")
            self.request()
        self.assertNotIn(TOKEN, " ".join(logs.output))
        self.assertNotIn("bad-token-in-log-check", " ".join(logs.output))


if __name__ == "__main__":
    unittest.main()
