import http.client
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("door_service", Path(__file__).parents[1] / "door_service.py")
service = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = service
spec.loader.exec_module(service)

TOKEN_OPERATOR = "0123456789abcdef0123456789abcdef"
TOKEN_ADMIN = "abcdef0123456789abcdef0123456789"
TOKEN_VIEWER = "1234567890abcdef1234567890abcdef"
WEBHOOK_SECRET = "fedcba9876543210fedcba9876543210"
PINS = (17, 27, 22, 23)


class RecordingOutputs(service.MockOutputs):
    def __init__(self, config):
        super().__init__(config)
        self.writes = []
        self.fail = False
        self.pause = 0
        self.activated = threading.Event()

    def write(self, pin, active):
        self.writes.append((pin, active, time.monotonic()))
        super().write(pin, active)
        if active:
            self.activated.set()
            if self.pause:
                time.sleep(self.pause)
            if self.fail:
                raise OSError("Injected GPIO failure")


class DoorServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = service.Config(
            pins=PINS,
            pulse_ms=300,
            cooldown_ms=100,
            mode="DEMO",
            hardware_enabled=False,
            journal=str(Path(self.temp.name) / "requests.sqlite3"),
            operator_token=TOKEN_OPERATOR,
            admin_token=TOKEN_ADMIN,
            viewer_token=TOKEN_VIEWER,
            webhook_secret=WEBHOOK_SECRET,
            allow_anonymous_telemetry=True,
        )
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

    def request(self, path="/doors/1/open", token=None, method="POST", request_id=None, body=None, headers=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        merged = dict(headers or {})
        if request_id is not None:
            merged["Idempotency-Key"] = request_id
        else:
            merged["Idempotency-Key"] = str(uuid.uuid4())
        if token:
            merged["Authorization"] = "Bearer " + token
        conn.request(method, path, body=body, headers=merged)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, json.loads(raw) if raw else {}

    def webhook_headers(self, body: bytes, ts: int | None = None):
        ts = int(time.time()) if ts is None else ts
        sig = service.hmac.new(WEBHOOK_SECRET.encode(), str(ts).encode() + b"." + body, service.hashlib.sha256).hexdigest()
        return {
            "Content-Type": "application/json",
            "X-Compass-Timestamp": str(ts),
            "X-Compass-Signature": sig,
            "Content-Length": str(len(body)),
        }

    def test_simulation_is_default_and_status_reflects_mode(self):
        with patch.dict(os.environ, {"DOOR_OPERATOR_TOKEN": TOKEN_OPERATOR}, clear=True):
            cfg = service.Config.from_env()
        self.assertFalse(cfg.hardware_enabled)
        status = self.controller.service_status()
        self.assertTrue(status["simulation"])
        self.assertFalse(status["hardwareEnabled"])

    def test_unauthenticated_and_insufficient_role_commands_are_denied(self):
        status, body = self.request(token=None)
        self.assertEqual(status, 401)
        self.assertEqual(body["code"], "ERR_UNAUTHORIZED")

        status, body = self.request(token=TOKEN_VIEWER)
        self.assertEqual(status, 401)
        self.assertEqual(body["code"], "ERR_UNAUTHORIZED")

    def test_invalid_gate_and_numeric_string_gate_normalization(self):
        actor = service.Actor(service.Role.OPERATOR, "tester", "test")
        code, payload = self.controller.request_pulse("2", actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(code, 200)
        self.assertEqual(payload["door"], 2)

        code, payload = self.controller.request_pulse("2x", actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(code, 400)
        self.assertEqual(payload["code"], "ERR_INVALID_GATE_ID")

    def test_invalid_modes_are_rejected(self):
        admin = service.Actor(service.Role.ADMIN, "admin", "ws")
        status, payload = self.controller.set_mode(admin, "invalid", confirm=True, reason="x", correlation_id=str(uuid.uuid4()))
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "ERR_INVALID_MODE")

    def test_lockdown_and_maintenance_interlocks_block_automation(self):
        admin = service.Actor(service.Role.ADMIN, "admin", "ws")
        actor = service.Actor(service.Role.OPERATOR, "operator", "webhook")

        self.assertEqual(self.controller.set_mode(admin, "LOCKDOWN", True, "incident", str(uuid.uuid4()))[0], 200)
        denied = self.controller.request_pulse(1, actor, source="webhook", request_id=str(uuid.uuid4()))
        self.assertEqual(denied[0], 503)
        self.assertEqual(denied[1]["code"], "ERR_MODE_LOCKDOWN")

        self.assertEqual(self.controller.set_mode(admin, "MAINTENANCE", True, "maintenance", str(uuid.uuid4()))[0], 200)
        denied = self.controller.request_pulse(1, actor, source="webhook", request_id=str(uuid.uuid4()))
        self.assertEqual(denied[1]["code"], "ERR_MODE_MAINTENANCE")

    def test_unknown_unready_and_stale_gate_fail_closed(self):
        config = service.Config(
            pins=PINS,
            pulse_ms=300,
            cooldown_ms=100,
            mode="NORMAL",
            hardware_enabled=True,
            operator_token=TOKEN_OPERATOR,
            admin_token=TOKEN_ADMIN,
            viewer_token=TOKEN_VIEWER,
            webhook_secret=WEBHOOK_SECRET,
            journal=str(Path(self.temp.name) / "hardware.sqlite3"),
        )
        outputs = RecordingOutputs(config)
        controller = service.DoorController(config, outputs)
        actor = service.Actor(service.Role.OPERATOR, "operator", "test")
        code, payload = controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(code, 503)
        self.assertIn(payload["code"], {"ERR_GATE_UNREADY", "ERR_STALE_HEARTBEAT"})
        controller.close()

    def test_concurrent_duplicate_pulses_do_not_overlap(self):
        actor = service.Actor(service.Role.OPERATOR, "operator", "test")
        self.outputs.pause = 0.2
        results = []

        def first():
            results.append(self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4())))

        thread = threading.Thread(target=first)
        thread.start()
        self.assertTrue(self.outputs.activated.wait(1))
        second = self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        thread.join()
        self.assertEqual(second[0], 409)
        self.assertEqual(second[1]["code"], "ERR_PULSE_IN_FLIGHT")

    def test_cooldown_is_enforced(self):
        actor = service.Actor(service.Role.OPERATOR, "operator", "test")
        ok = self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(ok[0], 200)
        blocked = self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(blocked[0], 409)
        self.assertEqual(blocked[1]["code"], "ERR_COOLDOWN")

    def test_relay_output_returns_to_safe_state_after_success_and_failure(self):
        actor = service.Actor(service.Role.OPERATOR, "operator", "test")
        self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        self.assertFalse(any(self.outputs.states.values()))

        self.outputs.fail = True
        failed = self.controller.request_pulse(2, actor, source="test", request_id=str(uuid.uuid4()))
        self.assertEqual(failed[0], 503)
        self.assertFalse(any(self.outputs.states.values()))

    def test_webhook_auth_replay_validation_and_lockdown_denial(self):
        payload = {"eventType": "gate_open_request", "authorized": True, "gateId": "1"}
        body = json.dumps(payload).encode()

        bad_headers = dict(self.webhook_headers(body))
        bad_headers["X-Compass-Signature"] = "0" * 64
        self.assertEqual(self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=bad_headers)[0], 401)

        headers = self.webhook_headers(body)
        first = self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=headers)
        self.assertEqual(first[0], 202)

        replay = self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=headers)
        self.assertEqual(replay[0], 409)

        time.sleep(1)
        second_headers = self.webhook_headers(body, ts=int(time.time()))
        debounce = self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=second_headers)
        self.assertEqual(debounce[0], 429)

        admin = service.Actor(service.Role.ADMIN, "admin", "ws")
        self.controller.set_mode(admin, "LOCKDOWN", True, "incident", str(uuid.uuid4()))
        time.sleep(self.config.webhook_debounce_seconds)
        third_headers = self.webhook_headers(body, ts=int(time.time()))
        denied = self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=third_headers)
        self.assertEqual(denied[0], 503)

        invalid_len_headers = dict(self.webhook_headers(body))
        invalid_len_headers["Content-Length"] = "oops"
        invalid_len = self.request(path="/api/v1/compass-webhook", token=None, body=body, headers=invalid_len_headers)
        self.assertEqual(invalid_len[0], 400)
        self.assertEqual(invalid_len[1]["code"], "ERR_INVALID_LENGTH")

    def test_audit_records_without_secrets(self):
        actor = service.Actor(service.Role.OPERATOR, "operator", "test")
        with self.assertLogs(service.LOG, level="INFO") as logs:
            self.controller.request_pulse(1, actor, source="test", request_id=str(uuid.uuid4()))
        text = " ".join(logs.output)
        self.assertNotIn(TOKEN_OPERATOR, text)
        self.assertNotIn(WEBHOOK_SECRET, text)
        admin = service.Actor(service.Role.ADMIN, "admin", "ws")
        with self.assertLogs(service.LOG, level="INFO") as logs:
            self.controller.set_mode(admin, "LOCKDOWN", True, "incident", str(uuid.uuid4()))
        mode_text = " ".join(logs.output)
        self.assertNotIn(TOKEN_ADMIN, mode_text)
        self.assertNotIn(WEBHOOK_SECRET, mode_text)

    def test_mode_change_requests_are_idempotent_by_request_id(self):
        admin = service.Actor(service.Role.ADMIN, "admin", "ws")
        request_id = str(uuid.uuid4())
        first = self.controller.set_mode(admin, "LOCKDOWN", True, "incident", request_id)
        second = self.controller.set_mode(admin, "LOCKDOWN", True, "incident", request_id)
        self.assertEqual(first, second)
        restarted = service.DoorController(self.config, RecordingOutputs(self.config))
        replayed = restarted.set_mode(admin, "LOCKDOWN", True, "incident", request_id)
        self.assertEqual(first, replayed)
        restarted.close()

    def test_health_output_distinguishes_simulation_from_hardware_mode(self):
        status = self.request(path="/health", method="GET")[1]
        self.assertTrue(status["simulation"])
        self.assertFalse(status["hardwareEnabled"])

        config = service.Config(
            pins=PINS,
            pulse_ms=300,
            cooldown_ms=100,
            mode="NORMAL",
            hardware_enabled=True,
            operator_token=TOKEN_OPERATOR,
            admin_token=TOKEN_ADMIN,
            viewer_token=TOKEN_VIEWER,
            webhook_secret=WEBHOOK_SECRET,
            journal=str(Path(self.temp.name) / "status.sqlite3"),
        )
        controller = service.DoorController(config, RecordingOutputs(config))
        self.assertFalse(controller.service_status()["simulation"])
        controller.close()

    def test_gpi_outputs_active_low_and_high_start_inactive(self):
        for low in [True, False]:
            gpio = Mock()
            gpio.gpiochip_open.return_value = 9
            config = service.Config(
                pins=PINS,
                pulse_ms=300,
                cooldown_ms=100,
                mode="NORMAL",
                hardware_enabled=True,
                active_low=low,
                operator_token=TOKEN_OPERATOR,
                admin_token=TOKEN_ADMIN,
                viewer_token=TOKEN_VIEWER,
                webhook_secret=WEBHOOK_SECRET,
                journal=str(Path(self.temp.name) / f"gpio-{low}.sqlite3"),
            )
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
                service.Config(pins=PINS, pulse_ms=pulse, operator_token=TOKEN_OPERATOR)
        for pins in [(17, 17, 22, 23), (17, 22), (0, 27, 22, 23)]:
            with self.assertRaises(ValueError):
                service.Config(pins=pins, operator_token=TOKEN_OPERATOR)
        with self.assertRaises(ValueError):
            service.Config(pins=PINS, hardware_enabled=True, operator_token=TOKEN_OPERATOR, webhook_secret="")


if __name__ == "__main__":
    unittest.main()
