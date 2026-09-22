import importlib.util
import sys
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("gpio_adapter", Path(__file__).parents[1] / "gpio_adapter.py")
adapter_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = adapter_module
spec.loader.exec_module(adapter_module)


def make_adapter(**kwargs):
    config = adapter_module.AdapterConfig(
        hardware_enabled=kwargs.get("hardware_enabled", False),
        pulse_seconds=kwargs.get("pulse_seconds", 0.15),
        cooldown_seconds=kwargs.get("cooldown_seconds", 0.25),
        webhook_secret=kwargs.get("webhook_secret", "secret-123"),
    )
    gates = {
        "gate-1": adapter_module.GateRecord(commissioned=True, healthy=True),
        "gate-2": adapter_module.GateRecord(commissioned=True, healthy=False),
        "gate-3": adapter_module.GateRecord(commissioned=False, healthy=True),
    }
    tokens = {
        "viewer-token": "viewer",
        "operator-token": "operator",
        "admin-token": "administrator",
    }
    return adapter_module.GateHardwareAdapter(gates, tokens, config=config)


class GpioAdapterSafetyTests(unittest.TestCase):
    def tearDown(self):
        if hasattr(self, "adapter"):
            self.adapter.shutdown()

    def test_default_runtime_starts_in_demo_simulation_mode(self):
        self.adapter = make_adapter(hardware_enabled=False)
        health = self.adapter.health_status()
        self.assertEqual(health["runtimeMode"], "demo")
        self.assertEqual(self.adapter.mode, "DEMO")
        self.assertTrue(health["ready"])

    def test_websocket_authentication_and_telemetry_only_behavior(self):
        self.adapter = make_adapter()
        self.assertFalse(self.adapter.connect_websocket(None, telemetry_only=False)["ok"])
        anon = self.adapter.connect_websocket(None, telemetry_only=True)
        self.assertTrue(anon["ok"])
        self.assertTrue(anon["telemetryOnly"])
        self.assertFalse(self.adapter.handle_ws_message("viewer", {"command": "TOGGLE_GATE", "gateId": "gate-1"})["ok"])

    def test_emergency_mode_change_requires_admin_and_confirmation(self):
        self.adapter = make_adapter()
        denied = self.adapter.handle_ws_message("administrator", {"command": "SET_MODE", "mode": "LOCKDOWN"})
        self.assertFalse(denied["ok"])
        self.assertEqual(denied["reason"], "explicit_confirmation_required")
        accepted = self.adapter.handle_ws_message("administrator", {"command": "SET_MODE", "mode": "LOCKDOWN", "confirmEmergency": True})
        self.assertTrue(accepted["ok"])
        self.assertEqual(self.adapter.mode, "LOCKDOWN")

    def test_invalid_mode_and_bulk_conflicts_are_rejected(self):
        self.adapter = make_adapter()
        invalid = self.adapter.handle_ws_message("administrator", {"command": "SET_MODE", "mode": "PANIC"})
        self.assertFalse(invalid["ok"])
        unauthorized = self.adapter.handle_ws_message("viewer", {"command": "BULK", "openAll": True})
        self.assertFalse(unauthorized["ok"])
        self.assertEqual(unauthorized["reason"], "insufficient_role")
        missing = self.adapter.handle_ws_message("operator", {"command": "BULK"})
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["reason"], "bulk_operation_required")
        allowed = self.adapter.handle_ws_message("operator", {"command": "BULK", "openAll": True})
        self.assertTrue(allowed["ok"])
        conflict = self.adapter.handle_ws_message("administrator", {"command": "BULK", "openAll": True, "closeAll": True})
        self.assertFalse(conflict["ok"])
        self.assertEqual(conflict["reason"], "conflicting_bulk_command")

    def test_invalid_uncommissioned_and_unhealthy_gates_are_rejected(self):
        self.adapter = make_adapter()
        invalid = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "??"})
        self.assertFalse(invalid["ok"])
        uncommissioned = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-3"})
        self.assertFalse(uncommissioned["ok"])
        unhealthy = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-2"})
        self.assertFalse(unhealthy["ok"])

    def test_lockdown_blocks_gate_pulses_and_webhook_automation(self):
        self.adapter = make_adapter()
        self.adapter.handle_ws_message("administrator", {"command": "SET_MODE", "mode": "LOCKDOWN", "confirmEmergency": True})
        blocked_ws = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.assertFalse(blocked_ws["ok"])
        status, body = self.adapter.handle_webhook(
            {"X-Webhook-Secret": "secret-123"},
            {"authorized": True, "zoneId": "gate-1", "eventType": "AUTHORIZED_ENTRY", "source": "compass"},
        )
        self.assertEqual(status, 423)
        self.assertEqual(body["reason"], "lockdown_blocks_pulse")

    def test_maintenance_mode_blocks_automation_without_maintenance_path(self):
        self.adapter = make_adapter()
        self.adapter.handle_ws_message("administrator", {"command": "SET_MODE", "mode": "MAINTENANCE"})
        status, denied = self.adapter.handle_webhook(
            {"X-Webhook-Secret": "secret-123"},
            {"authorized": True, "zoneId": "gate-1", "eventType": "AUTHORIZED_ENTRY", "source": "compass"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(denied["reason"], "maintenance_blocks_automation")
        status, accepted = self.adapter.handle_webhook(
            {"X-Webhook-Secret": "secret-123"},
            {
                "authorized": True,
                "zoneId": "gate-1",
                "eventType": "AUTHORIZED_ENTRY",
                "source": "compass",
                "maintenancePath": True,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(accepted["status"], "PROCESSED")

    def test_webhook_secret_and_payload_validation(self):
        self.adapter = make_adapter()
        bad_secret = self.adapter.handle_webhook({}, {"authorized": True, "zoneId": "gate-1", "eventType": "AUTHORIZED_ENTRY"})
        self.assertEqual(bad_secret[0], 401)
        bad_type = self.adapter.handle_webhook(
            {"X-Webhook-Secret": "secret-123"},
            {"authorized": True, "zoneId": "gate-1", "eventType": "UNKNOWN"},
        )
        self.assertEqual(bad_type[0], 400)
        bad_source = self.adapter.handle_webhook(
            {"X-Webhook-Secret": "secret-123"},
            {"authorized": True, "zoneId": "gate-1", "eventType": "AUTHORIZED_ENTRY", "source": "third-party"},
        )
        self.assertEqual(bad_source[0], 400)

    def test_cooldown_and_overlap_prevent_duplicate_pulses(self):
        self.adapter = make_adapter()
        first = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.assertTrue(first["ok"])
        overlap = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.assertFalse(overlap["ok"])
        self.assertIn(overlap["reason"], {"overlapping_pulse", "cooldown"})
        time.sleep(0.2)
        cooldown = self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.assertFalse(cooldown["ok"])
        self.assertEqual(cooldown["reason"], "cooldown")

    def test_health_status_reports_heartbeat_pending_and_readiness(self):
        self.adapter = make_adapter(hardware_enabled=True)
        before = self.adapter.health_status()
        self.assertEqual(before["runtimeMode"], "live")
        self.assertIsNone(before["lastHeartbeat"])
        self.adapter.mark_heartbeat()
        after = self.adapter.health_status()
        self.assertIsNotNone(after["lastHeartbeat"])
        self.assertIsNotNone(after["heartbeatAgeSeconds"])

    def test_audit_log_tracks_allowed_and_denied_events(self):
        self.adapter = make_adapter()
        self.adapter.handle_ws_message("viewer", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.adapter.handle_ws_message("operator", {"command": "TOGGLE_GATE", "gateId": "gate-1"})
        self.assertTrue(any(item["allowed"] for item in self.adapter.audit_log))
        self.assertTrue(any(not item["allowed"] for item in self.adapter.audit_log))


if __name__ == "__main__":
    unittest.main()
