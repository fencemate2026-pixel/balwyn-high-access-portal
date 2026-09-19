from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


FAKE_GPIO = types.ModuleType("lgpio")
FAKE_GPIO.SET_PULL_NONE = 0
FAKE_GPIO.SET_PULL_UP = 32
FAKE_GPIO.SET_PULL_DOWN = 64
FAKE_GPIO.values = {}
FAKE_GPIO.writes = []
FAKE_GPIO.gpiochip_open = lambda _chip: 1
FAKE_GPIO.gpio_claim_output = lambda _chip, pin, value: FAKE_GPIO.values.__setitem__(pin, value)
FAKE_GPIO.gpio_claim_input = lambda _chip, _pin, _bias: None
FAKE_GPIO.gpio_write = lambda _chip, pin, value: (FAKE_GPIO.values.__setitem__(pin, value), FAKE_GPIO.writes.append((pin, value)))[0]
FAKE_GPIO.gpio_read = lambda _chip, pin: FAKE_GPIO.values.get(pin, 0)
FAKE_GPIO.gpiochip_close = lambda _chip: None
sys.modules["lgpio"] = FAKE_GPIO

MODULE_PATH = Path(__file__).parents[1] / "balwyn_relay_agent.py"
SPEC = importlib.util.spec_from_file_location("balwyn_relay_agent", MODULE_PATH)
assert SPEC and SPEC.loader
AGENT_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AGENT_MODULE
SPEC.loader.exec_module(AGENT_MODULE)


def valid_environment(state_dir: str) -> dict[str, str]:
    return {
        "PORTAL_URL": "https://gate-portal.example",
        "GATE_ID": "TF-ENTRY",
        "CONTROLLER_TOKEN": "test-token",
        "OPEN_RELAY_PIN": "1",
        "CLOSE_RELAY_PIN": "2",
        "OPEN_LIMIT_PIN": "3",
        "CLOSED_LIMIT_PIN": "4",
        "SAFETY_OK_PIN": "5",
        "ESTOP_PIN": "6",
        "RELAY_ACTIVE_LOW": "false",
        "INPUT_ACTIVE_LOW": "false",
        "INPUT_BIAS": "pull_up",
        "PULSE_SECONDS": "0.8",
        "MOVEMENT_TIMEOUT_SECONDS": "45",
        "ENABLE_SCHEDULE_CONTROL": "false",
        "STATE_DIRECTORY": state_dir,
    }


class FakePortal:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, object]]] = []

    async def request(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        self.requests.append((path, payload))
        return {}


class AgentSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        FAKE_GPIO.values.clear()
        FAKE_GPIO.writes.clear()

    def test_config_rejects_non_https_portal(self) -> None:
        with tempfile.TemporaryDirectory() as state_dir:
            environment = valid_environment(state_dir)
            environment["PORTAL_URL"] = "http://gate-portal.example"
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(RuntimeError, "HTTPS origin"):
                    AGENT_MODULE.Config.load()

    def test_config_rejects_placeholder_boolean(self) -> None:
        with tempfile.TemporaryDirectory() as state_dir:
            environment = valid_environment(state_dir)
            environment["RELAY_ACTIVE_LOW"] = "REPLACE_WITH_TRUE_OR_FALSE"
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(RuntimeError, "exactly true or false"):
                    AGENT_MODULE.Config.load()

    def test_restart_never_repeats_an_interrupted_pulse(self) -> None:
        with tempfile.TemporaryDirectory() as state_dir:
            with patch.dict(os.environ, valid_environment(state_dir), clear=True):
                config = AGENT_MODULE.Config.load()
            agent = AGENT_MODULE.Agent(config)
            portal = FakePortal()
            agent.portal = portal

            # Safe circuit, currently confirmed closed, interrupted OPEN request.
            FAKE_GPIO.values.update({3: 0, 4: 1, 5: 1, 6: 0})
            agent.write_json_atomic(agent.execution_journal_path, {"commandId": 42, "command": "open", "phase": "pulsed"})
            FAKE_GPIO.writes.clear()

            asyncio.run(agent.recover_interrupted_execution())

            self.assertFalse(agent.execution_journal_path.exists())
            self.assertTrue(portal.requests)
            self.assertEqual(portal.requests[0][1]["state"], "failed")
            self.assertTrue(all(value == 0 for _pin, value in FAKE_GPIO.writes), "recovery must never energise a relay")
            agent.io.close()


if __name__ == "__main__":
    unittest.main()
