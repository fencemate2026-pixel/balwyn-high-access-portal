"""Controller tests. No real GPIO: FakeBackend only. No relay can be actuated.

A simulated swing gate reacts to the relay exactly as the agreed hardware
does (contact closed briefly = open then auto-close; contact held = stay open),
and a local HTTP server stands in for the portal's controller routes.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from balwyn_gate_controller.config import Config, ConfigError, relay_outputs_from_env  # noqa: E402
from balwyn_gate_controller.controller import GateController  # noqa: E402
from balwyn_gate_controller.hardware import FakeBackend, GateIO, GpioBusyError, force_relays_off, lgpio_work_dir  # noqa: E402
from balwyn_gate_controller.journal import Journal  # noqa: E402
from balwyn_gate_controller.portal import PortalClient, PortalError  # noqa: E402
from balwyn_gate_controller.relay import PulseOutput, RelaySupervisor  # noqa: E402

RELAY, CLOSED, OPEN, SAFETY = 17, 22, 23, 24
UNLOCK, BOARD_SENSE = 25, 27  # access-board exit-button relay, K1 spare contact
TOKEN = "t" * 43


# ------------------------------------------------------------------ fixtures
class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class SimGate:
    """Swing gate + operator. Inputs are active-low (reed made = 0 V), relay active-low."""

    def __init__(self, backend: FakeBackend, travel: float = 10.0, auto_close: float = 20.0, open_reed: bool = True) -> None:
        self.b, self.travel, self.auto_close, self.has_open_reed = backend, travel, auto_close, open_reed
        self.angle = 0.0          # 0 closed .. 1 open
        self.direction = 0        # +1 opening, -1 closing
        self.open_timer = 0.0
        self.safety = True
        self.publish()

    def relay_on(self) -> bool:
        return self.b.levels.get(RELAY, 1) == 0

    def step(self, dt: float) -> None:
        if self.relay_on() and self.angle < 1.0:
            self.direction = 1
        if self.direction == 1:
            self.angle = min(1.0, self.angle + dt / self.travel)
            if self.angle >= 1.0:
                self.direction, self.open_timer = 0, 0.0
        elif self.direction == 0 and self.angle >= 1.0:
            if self.relay_on():
                self.open_timer = 0.0
            else:
                self.open_timer += dt
                if self.open_timer >= self.auto_close:
                    self.direction = -1
        elif self.direction == -1:
            if self.relay_on():
                self.direction = 1
            else:
                self.angle = max(0.0, self.angle - dt / self.travel)
                if self.angle <= 0.0:
                    self.direction = 0
        self.publish()

    def publish(self) -> None:
        self.b.set_input(CLOSED, 0 if self.angle <= 0.0 else 1)
        if self.has_open_reed:
            self.b.set_input(OPEN, 0 if self.angle >= 1.0 else 1)
        self.b.set_input(SAFETY, 0 if self.safety else 1)


class SimBoardGate(SimGate):
    """The gate behind an ACB-004 access board with a fail-safe magnetic lock.

    * A press on the exit-button input (UNLOCK relay closing) makes the board
      unlock the door for `unlock_time` seconds (Balwyn: 5 s).
    * While unlocked, K1 pulls in: its first contact closes the operator's AP
      input in parallel with the Pi's gate relay, its second contact makes the
      Pi's sense input (active-low).
    * While locked, a closed gate cannot move: if anything drives AP then, the
      motor is pushing against the magnet. Tests assert that never happens.
    """

    def __init__(self, backend: FakeBackend, unlock_time: float = 5.0, board_responds: bool = True, **kwargs: object) -> None:
        self.unlock_time = unlock_time
        self.board_responds = board_responds
        self.unlocked_for = 0.0
        self.prev_press = False
        self.pushed_against_lock = False
        super().__init__(backend, **kwargs)  # type: ignore[arg-type]

    def press(self) -> bool:
        return self.b.levels.get(UNLOCK, 1) == 0

    def board_unlocked(self) -> bool:
        return self.unlocked_for > 0.0

    def relay_on(self) -> bool:
        return super().relay_on() or self.board_unlocked()  # K1 contact 1 in parallel on AP

    def step(self, dt: float) -> None:
        pressed = self.press()
        if pressed and not self.prev_press and self.board_responds:
            self.unlocked_for = self.unlock_time
        self.prev_press = pressed
        if not self.board_unlocked() and self.angle <= 0.0 and self.relay_on():
            self.pushed_against_lock = True  # the magnet holds a closed gate
        else:
            super().step(dt)
        self.unlocked_for = max(0.0, self.unlocked_for - dt)
        self.publish()

    def publish(self) -> None:
        super().publish()
        self.b.set_input(BOARD_SENSE, 0 if self.board_unlocked() else 1)


class FakePortal:
    """Minimal stand-in for /api/controller/commands and /ack."""

    def __init__(self) -> None:
        self.queue: list[dict] = []
        self.polls: list[dict] = []
        self.acks: list[tuple[int, dict]] = []
        self.up = True
        portal = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_POST(self) -> None:  # noqa: N802
                if not portal.up:
                    self.send_response(503); self.send_header("Content-Length", "0"); self.end_headers(); return
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    self.send_response(401); self.end_headers(); return
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path == "/api/controller/commands":
                    portal.polls.append(body)
                    command = portal.queue.pop(0) if portal.queue else None
                    self._json({"command": command, "commissioned": True, "pollAfterMs": 750})
                elif self.path.startswith("/api/controller/commands/") and self.path.endswith("/ack"):
                    portal.acks.append((int(self.path.split("/")[4]), body))
                    self._json({"ok": True})
                else:
                    self.send_response(404); self.end_headers()

            def _json(self, payload: dict) -> None:
                data = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()


def env(url: str, state: str, **extra: str) -> dict:
    base = {
        "PORTAL_URL": url, "ALLOW_INSECURE_HTTP_FOR_TESTS": "1", "GATE_ID": "TF-ENTRY", "CONTROLLER_TOKEN": TOKEN,
        "RELAY_PIN": str(RELAY), "RELAY_ACTIVE_LOW": "true", "CLOSED_REED_PIN": str(CLOSED), "OPEN_REED_PIN": str(OPEN),
        "SAFETY_INPUT": str(SAFETY), "INPUT_ACTIVE_LOW": "true", "INPUT_PULL": "up", "CYCLE_PULSE_S": "6",
        "TRAVEL_TIMEOUT_S": "30", "AUTO_CLOSE_TIMEOUT_S": "90", "STATE_DIRECTORY": state,
    }
    base.update(extra)
    return base


class Rig:
    def __init__(self, test: unittest.TestCase, gate_factory=None, **extra: str) -> None:
        self.portal = FakePortal()
        test.addCleanup(self.portal.close)
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.extra = extra
        self.backend = FakeBackend()
        factory = gate_factory or (lambda backend, open_reed: SimGate(backend, open_reed=open_reed))
        self.gate = factory(self.backend, "OPEN_REED_PIN" not in extra)
        self.clock = Clock()
        self.build()

    def build(self) -> None:
        self.config = Config.from_env(env(self.portal.url, self.tmp.name, **self.extra))
        io = GateIO(self.backend, self.config.relay_pin, self.config.relay_active_low, self.config.closed_reed_pin,
                    self.config.open_reed_pin, self.config.safety_pin, self.config.input_active_low, self.config.input_pull,
                    unlock_relay_pin=self.config.unlock_relay_pin, unlock_sense_pin=self.config.unlock_sense_pin)
        self.ctl = GateController(self.config, io, PortalClient(self.portal.url, "TF-ENTRY", TOKEN), Journal(Path(self.tmp.name)), self.clock,
                                  threaded_network=False)  # simulated clock: exchanges run inline, deterministically

    def run(self, seconds: float, dt: float = 0.05) -> None:
        for _ in range(int(seconds / dt)):
            self.clock.t += dt
            self.gate.step(dt)
            self.ctl.tick()

    def acks_for(self, command_id: int) -> list[dict]:
        return [body for cid, body in self.portal.acks if cid == command_id]

    def relay_writes_on(self) -> int:
        return sum(1 for pin, level in self.backend.writes if pin == RELAY and level == 0)

    def presses(self) -> int:
        return sum(1 for pin, level in self.backend.writes if pin == UNLOCK and level == 0)

    def first_on(self, pin: int) -> int:
        """Index of the first write that switched `pin` on (active-low), or a large number if never."""
        return next((i for i, (p, level) in enumerate(self.backend.writes) if p == pin and level == 0), 10 ** 9)

    def audit_events(self) -> list[str]:
        path = Path(self.tmp.name, "audit.jsonl")
        return [json.loads(line)["event"] for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


# ---------------------------------------------------------------------- tests
class ConfigTests(unittest.TestCase):
    def test_rejects_unsafe_or_ambiguous_settings(self) -> None:
        good = env("https://magickeys-balwyn-portal.com", "/tmp/x")
        Config.from_env(good)
        for key, value, message in [
            ("PORTAL_URL", "http://magickeys-balwyn-portal.com", "https"),
            ("PORTAL_URL", "https://user:pw@example.com", "origin"),
            ("CYCLE_PULSE_S", "11", "CYCLE_PULSE_S"),
            ("OPEN_REED_PIN", str(RELAY), "different pins"),
            ("RELAY_ACTIVE_LOW", "yes", "true or false"),
            ("CONTROLLER_TOKEN", "short", "credential"),
            ("SAFETY_INPUT", "", "SAFETY_INPUT"),
        ]:
            broken = {**good, key: value}
            broken.pop("ALLOW_INSECURE_HTTP_FOR_TESTS", None)
            with self.subTest(key=key), self.assertRaisesRegex(ConfigError, message):
                Config.from_env(broken)

    def test_state_directory_is_split_on_the_os_path_separator_only(self) -> None:
        import os
        first, second = ("C:\\Temp\\gate-a", "D:\\x") if os.name == "nt" else ("/var/lib/balwyn-gate/TF-ENTRY", "/tmp/x")
        config = Config.from_env({**env("https://magickeys-balwyn-portal.com", first + os.pathsep + second)})
        self.assertEqual(str(config.state_dir), first)

    def test_unlock_settings_are_checked(self) -> None:
        good = env("https://magickeys-balwyn-portal.com", "/tmp/x")
        config = Config.from_env({**good, "UNLOCK_RELAY_PIN": str(UNLOCK), "UNLOCK_SENSE_PIN": str(BOARD_SENSE)})
        self.assertEqual((config.unlock_relay_pin, config.unlock_sense_pin, config.unlock_pulse_s), (UNLOCK, BOARD_SENSE, 0.5))
        self.assertIsNone(Config.from_env(good).unlock_relay_pin)  # existing env files: feature off
        for key, value, message in [
            ("UNLOCK_RELAY_PIN", str(RELAY), "different pins"),
            ("UNLOCK_SENSE_PIN", str(CLOSED), "different pins"),
            ("UNLOCK_PULSE_S", "3", "UNLOCK_PULSE_S"),
            ("UNLOCK_CONFIRM_TIMEOUT_S", "0", "UNLOCK_CONFIRM_TIMEOUT_S"),
            ("UNLOCK_RELAY_PIN", "40", "UNLOCK_RELAY_PIN"),
        ]:
            with self.subTest(key=key), self.assertRaisesRegex(ConfigError, message):
                Config.from_env({**good, "UNLOCK_RELAY_PIN": str(UNLOCK), key: value})

    def test_safety_none_means_monitor_only(self) -> None:
        config = Config.from_env({**env("https://magickeys-balwyn-portal.com", "/tmp/x"), "SAFETY_INPUT": "none"})
        self.assertTrue(config.monitor_only)


class RelayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = Clock()
        self.levels: list[bool] = []
        self.relay = RelaySupervisor(self.levels.append, hold_max_s=3600, network_loss_release_s=300, loop_stall_s=10,
                                     audit=lambda *_: None, clock=self.clock)

    def test_starts_off_and_pulse_always_ends(self) -> None:
        self.assertEqual(self.levels, [False])
        self.relay.pulse(6)
        self.clock.t += 5.9; self.relay.enforce(); self.assertTrue(self.levels[-1])
        self.clock.t += 0.2; self.relay.enforce(); self.assertFalse(self.levels[-1])

    def test_pulse_cannot_drop_a_hold_and_hold_survives_a_pulse(self) -> None:
        self.relay.hold("schedule")
        self.assertFalse(self.relay.pulse(6))
        self.relay.release("x")
        self.relay.pulse(6); self.relay.hold("schedule")
        self.clock.t += 7; self.relay.feed(); self.relay.portal_ok(); self.relay.enforce()
        self.assertEqual(self.relay.state.mode, "holding")
        self.assertTrue(self.levels[-1])

    def test_stall_and_network_loss_drop_schedule_holds_but_never_fire_holds(self) -> None:
        self.relay.hold("schedule"); self.clock.t += 11; self.relay.enforce()
        self.assertEqual(self.relay.state.released_reason, "controller loop stalled")
        self.relay.feed(); self.relay.portal_ok(); self.relay.hold("schedule")
        for _ in range(31):
            self.clock.t += 10; self.relay.feed(); self.relay.enforce()
        self.assertEqual(self.relay.state.released_reason, "portal unreachable too long")
        self.relay.hold("emergency")
        for _ in range(100):
            self.clock.t += 60; self.relay.enforce()  # no feed, no portal: an hour and a half
        self.assertEqual(self.relay.state.mode, "holding")
        self.assertTrue(self.levels[-1])


class PulseOutputTests(unittest.TestCase):
    def test_a_press_is_bounded_never_doubled_and_always_ends(self) -> None:
        clock, levels = Clock(), []
        press = PulseOutput(levels.append, audit=lambda *_: None, clock=clock)
        self.assertEqual(levels, [False])
        self.assertTrue(press.pulse(30))           # asked for 30 s: capped at 2 s
        self.assertFalse(press.pulse(0.5))         # no second press while one runs
        clock.t += 1.9; press.enforce(); self.assertTrue(levels[-1])
        clock.t += 0.2; press.enforce(); self.assertFalse(levels[-1])

    def test_the_relay_watchdog_also_ends_a_press(self) -> None:
        clock, levels, gate = Clock(), [], []
        relay = RelaySupervisor(gate.append, hold_max_s=3600, network_loss_release_s=300, loop_stall_s=10,
                                audit=lambda *_: None, clock=clock)
        press = PulseOutput(levels.append, audit=lambda *_: None, clock=clock)
        relay.add_companion(press.enforce)
        relay.hold("emergency"); press.pulse(0.5)
        clock.t += 60; relay.enforce()             # main loop frozen: only the watchdog runs
        self.assertFalse(levels[-1])
        self.assertTrue(gate[-1])                   # the fire hold is untouched


class ControllerTests(unittest.TestCase):
    def test_manual_open_is_one_pulse_confirmed_by_the_open_reed_then_auto_closes(self) -> None:
        rig = Rig(self)
        rig.run(2)
        self.assertEqual(rig.portal.polls[-1]["position"], "closed")
        self.assertTrue(rig.portal.polls[-1]["safetyOk"])
        rig.portal.queue.append({"id": 1, "command": "open", "source": "manual"})
        rig.run(15)
        self.assertEqual(rig.acks_for(1)[0]["state"], "acknowledged")
        self.assertEqual(rig.acks_for(1)[0]["position"], "open")
        self.assertEqual(rig.relay_writes_on(), 1)
        rig.run(40)
        self.assertEqual(rig.gate.angle, 0.0)  # operator's own timer closed it
        self.assertEqual(rig.portal.polls[-1]["position"], "closed")

    def test_booking_window_holds_open_then_release_lets_it_close(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 2, "command": "open", "source": "schedule"})
        rig.run(60)
        self.assertEqual(rig.acks_for(2)[0]["state"], "acknowledged")
        self.assertEqual(rig.gate.angle, 1.0)  # still held open well past the auto-close time
        rig.portal.queue.append({"id": 3, "command": "closed", "source": "schedule"})
        rig.run(60)
        self.assertEqual(rig.acks_for(3)[0]["state"], "acknowledged")
        self.assertEqual(rig.acks_for(3)[0]["position"], "closed")
        self.assertFalse(rig.gate.relay_on())

    def test_unhealthy_safety_blocks_without_touching_the_relay(self) -> None:
        rig = Rig(self)
        rig.gate.safety = False
        rig.run(1)
        rig.portal.queue.append({"id": 4, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.acks_for(4)[0]["state"], "blocked")
        self.assertEqual(rig.relay_writes_on(), 0)
        self.assertFalse(rig.portal.polls[-1]["safetyOk"])

    def test_monitor_only_reports_but_never_actuates(self) -> None:
        rig = Rig(self, SAFETY_INPUT="none")
        rig.run(1)
        rig.portal.queue.append({"id": 5, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.acks_for(5)[0]["state"], "blocked")
        self.assertIn("Monitor-only", rig.acks_for(5)[0]["detail"])
        self.assertEqual(rig.relay_writes_on(), 0)

    def test_without_an_open_reed_an_open_is_never_claimed(self) -> None:
        rig = Rig(self, OPEN_REED_PIN="none")
        rig.run(1)
        rig.portal.queue.append({"id": 6, "command": "open", "source": "manual"})
        rig.run(3)
        ack = rig.acks_for(6)[0]
        self.assertEqual(ack["state"], "failed")
        self.assertIn("cannot be confirmed", ack["detail"])
        self.assertNotEqual(ack["position"], "open")

    def test_a_redispatched_command_is_never_repeated(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 7, "command": "open", "source": "manual"})
        rig.run(15)
        rig.portal.queue.append({"id": 7, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.relay_writes_on(), 1)
        self.assertIn("not repeated", rig.acks_for(7)[-1]["detail"])

    def test_restart_mid_command_does_not_repeat_and_reports_honestly(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 8, "command": "open", "source": "manual"})
        rig.run(1.2)  # command collected, pulse started, gate moving, no result yet
        self.assertIsNotNone(rig.ctl.journal.in_flight)
        rig.backend.levels[RELAY] = 1  # power loss: relay drops
        rig.backend = FakeBackend(); rig.gate.b = rig.backend; rig.gate.publish()
        rig.build()  # new process, same journal directory
        rig.run(3)
        self.assertEqual(rig.acks_for(8)[-1]["state"], "failed")
        self.assertIn("not repeated", rig.acks_for(8)[-1]["detail"])
        self.assertEqual(rig.relay_writes_on(), 0)

    def test_fire_command_pre_empts_and_holds_through_portal_loss(self) -> None:
        rig = Rig(self, NETWORK_LOSS_RELEASE_S="60")
        rig.run(1)
        rig.gate.angle = 0.5; rig.gate.direction = 0; rig.gate.publish()  # stuck half-open: close job pending
        rig.run(0.5)  # let the debounced reeds see it (the first poll now waits for stable reeds too)
        rig.portal.queue.append({"id": 9, "command": "closed", "source": "manual"})
        rig.run(1)
        rig.portal.queue.append({"id": 10, "command": "open", "source": "emergency"})
        rig.run(20)
        self.assertEqual(rig.acks_for(9)[0]["state"], "failed")
        self.assertIn("Superseded", rig.acks_for(9)[0]["detail"])
        self.assertEqual(rig.acks_for(10)[0]["state"], "acknowledged")
        rig.portal.up = False
        rig.run(180)  # three minutes with no portal
        self.assertTrue(rig.gate.relay_on())
        self.assertEqual(rig.gate.angle, 1.0)

    def test_schedule_hold_is_released_when_the_portal_is_unreachable(self) -> None:
        rig = Rig(self, NETWORK_LOSS_RELEASE_S="60")
        rig.run(1)
        rig.portal.queue.append({"id": 11, "command": "open", "source": "schedule"})
        rig.run(20)
        rig.portal.up = False
        rig.run(70)
        self.assertFalse(rig.gate.relay_on())
        rig.portal.up = True
        rig.run(60)
        self.assertTrue(any("portal unreachable" in fault for fault in rig.portal.polls[-1]["faults"]))

    def test_corrupt_journal_is_set_aside_and_reported_not_fatal(self) -> None:
        rig = Rig(self)
        Path(rig.tmp.name, "state.json").write_text("{not json", encoding="utf-8")
        rig.build()
        rig.run(2)
        self.assertTrue(any("journal" in fault for fault in rig.portal.polls[-1]["faults"]))
        self.assertTrue(any(p.name.startswith("state.json.corrupt-") for p in Path(rig.tmp.name).iterdir()))

    def test_shutdown_always_leaves_the_relay_off(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 12, "command": "open", "source": "emergency"})
        rig.run(2)
        self.assertTrue(rig.gate.relay_on())
        rig.ctl.shutdown()
        self.assertEqual(rig.backend.levels[RELAY], 1)
        self.assertTrue(rig.backend.closed)


def board_rig(test: unittest.TestCase, sense: bool = True, **gate_kwargs: object) -> Rig:
    extra = {"UNLOCK_RELAY_PIN": str(UNLOCK)}
    if sense:
        extra["UNLOCK_SENSE_PIN"] = str(BOARD_SENSE)
    return Rig(test, gate_factory=lambda backend, open_reed: SimBoardGate(backend, open_reed=open_reed, **gate_kwargs), **extra)


class AccessBoardUnlockTests(unittest.TestCase):
    """The ACB-004 path: press the exit-button input, the board releases the lock, then the Pi drives / holds the gate."""

    def test_schedule_open_presses_the_board_then_holds_for_the_whole_window(self) -> None:
        rig = board_rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 20, "command": "open", "source": "schedule"})
        rig.run(90)  # far past the 5 s unlock and the operator's 20 s auto-close
        ack = rig.acks_for(20)[0]
        self.assertEqual(ack["state"], "acknowledged")
        self.assertIn("Access board unlock requested", ack["detail"])
        self.assertEqual(rig.gate.angle, 1.0)                  # still held open
        self.assertEqual(rig.presses(), 1)
        self.assertLess(rig.first_on(UNLOCK), rig.first_on(RELAY))  # lock released before the gate relay
        self.assertFalse(rig.gate.pushed_against_lock)
        self.assertEqual(rig.backend.levels[UNLOCK], 1)        # the press ended
        self.assertFalse(rig.gate.board_unlocked())            # board re-locked long ago; gate is open anyway
        # A second schedule open while held: no new press, no new movement.
        rig.portal.queue.append({"id": 21, "command": "open", "source": "schedule"})
        rig.run(3)
        self.assertEqual(rig.presses(), 1)
        # End of window: release, the operator auto-closes, the magnet re-catches the gate.
        rig.portal.queue.append({"id": 22, "command": "closed", "source": "schedule"})
        rig.run(60)
        self.assertEqual(rig.acks_for(22)[0]["state"], "acknowledged")
        self.assertEqual(rig.gate.angle, 0.0)
        self.assertEqual(rig.presses(), 1)
        self.assertIn("unlock_confirmed", rig.audit_events())

    def test_gate_relay_is_never_driven_if_the_board_does_not_confirm_the_unlock(self) -> None:
        rig = board_rig(self, board_responds=False)
        rig.run(1)
        rig.portal.queue.append({"id": 23, "command": "open", "source": "manual"})
        rig.run(5)
        ack = rig.acks_for(23)[0]
        self.assertEqual(ack["state"], "failed")
        self.assertIn("did not confirm the unlock", ack["detail"])
        self.assertEqual(rig.relay_writes_on(), 0)
        self.assertFalse(rig.gate.pushed_against_lock)
        self.assertEqual(rig.gate.angle, 0.0)
        self.assertTrue(any("did not confirm" in fault for fault in rig.portal.polls[-1]["faults"]))

    def test_fire_open_does_not_wait_for_confirmation(self) -> None:
        rig = board_rig(self, board_responds=False)
        rig.run(1)
        rig.portal.queue.append({"id": 24, "command": "open", "source": "emergency"})
        rig.run(1.5)  # press + 0.5 s lead, then the hold
        self.assertEqual(rig.backend.levels[RELAY], 0)
        self.assertEqual(rig.ctl.relay.state.hold_kind, "emergency")

    def test_without_a_sense_input_the_gate_is_driven_after_the_lead_delay(self) -> None:
        rig = board_rig(self, sense=False)
        rig.run(1)
        rig.portal.queue.append({"id": 25, "command": "open", "source": "manual"})
        for _ in range(100):                                    # until the command is collected and the press starts
            if rig.presses():
                break
            rig.run(0.05)
        self.assertEqual(rig.presses(), 1)
        rig.run(0.3)
        self.assertEqual(rig.relay_writes_on(), 0)             # still inside the 0.5 s lead
        rig.run(15)
        self.assertEqual(rig.acks_for(25)[0]["state"], "acknowledged")
        self.assertFalse(rig.gate.pushed_against_lock)

    def test_an_unlock_made_by_the_board_itself_is_logged(self) -> None:
        rig = board_rig(self)
        rig.run(1)
        rig.gate.unlocked_for = 5.0  # a card or QR scan at the reader
        rig.run(2)
        self.assertIn("board_unlock_seen", rig.audit_events())
        self.assertEqual(rig.presses(), 0)

    def test_safety_fault_while_waiting_cancels_the_open(self) -> None:
        rig = board_rig(self, board_responds=False)
        rig.run(1)
        rig.portal.queue.append({"id": 26, "command": "open", "source": "schedule"})
        for _ in range(100):                                    # until the open is waiting for the board
            if rig.ctl.pending is not None:
                break
            rig.run(0.05)
        self.assertIsNotNone(rig.ctl.pending)
        rig.gate.safety = False
        rig.run(3)
        self.assertEqual(rig.acks_for(26)[0]["state"], "failed")
        self.assertIn("safety", rig.acks_for(26)[0]["detail"])
        self.assertEqual(rig.relay_writes_on(), 0)

    def test_shutdown_leaves_both_relays_off(self) -> None:
        rig = board_rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 27, "command": "open", "source": "manual"})
        rig.run(0.6)  # mid-press
        rig.ctl.shutdown()
        self.assertEqual(rig.backend.levels[UNLOCK], 1)
        self.assertEqual(rig.backend.levels[RELAY], 1)


class BlackHole:
    """Accepts TCP connections and never answers: a black-holed network path."""

    def __init__(self) -> None:
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(50)
        self.held: list[socket.socket] = []
        self.url = f"http://127.0.0.1:{self.sock.getsockname()[1]}"
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.held.append(conn)

    def close(self) -> None:
        for conn in self.held:
            conn.close()
        self.sock.close()


def systemd_env_file(path: Path) -> dict:
    """Read an EnvironmentFile= the way systemd does (src/basic/env-file.c): a
    comment only at the start of a line; an unquoted value is everything after
    '=' with surrounding whitespace removed, so a mid-line '#' stays in it."""
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.lstrip(" \t")
        if not line or line[0] in "#;" or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip(" \t")
    return values


DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


class DeploymentFileTests(unittest.TestCase):
    def test_example_env_file_passes_check_config_exactly_as_systemd_reads_it(self) -> None:
        values = systemd_env_file(DEPLOY / "gate.env.example")
        config = Config.from_env({**values, "CONTROLLER_TOKEN": TOKEN, "STATE_DIRECTORY": "/tmp/x"})
        self.assertTrue(config.dry_run, "the example must start in DRY_RUN")
        self.assertFalse(config.schedule_control, "first commissioning starts with schedule control off")

    def test_inline_comment_is_reported_by_name(self) -> None:
        broken = {**env("https://magickeys-balwyn-portal.com", "/tmp/x"), "RELAY_PIN": "17   # relay"}
        broken.pop("ALLOW_INSECURE_HTTP_FOR_TESTS")
        with self.assertRaisesRegex(ConfigError, "RELAY_PIN contains '#'"):
            Config.from_env(broken)

    def test_service_unit_has_no_device_dependency_that_udev_never_satisfies(self) -> None:
        # Raspberry Pi OS does not tag gpiochip devices for systemd, so a
        # dev-gpiochip0.device unit never starts and Requires= on it fails the service.
        unit = (DEPLOY / "balwyn-gate@.service").read_text(encoding="utf-8")
        directives = [line for line in unit.splitlines() if not line.lstrip().startswith("#")]
        self.assertFalse(any("gpiochip0.device" in line for line in directives))
        self.assertIn("DeviceAllow=/dev/gpiochip0 rw", unit)


class LgpioWorkDirTests(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = os.environ.pop("LG_WD", None)
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        os.environ.pop("LG_WD", None)
        if self.saved is not None:
            os.environ["LG_WD"] = self.saved

    def test_existing_lg_wd_wins(self) -> None:
        os.environ["LG_WD"] = "/somewhere/else"
        self.assertEqual(lgpio_work_dir(Path("/tmp/ignored")), "/somewhere/else")

    def test_preferred_directory_is_created_private(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            wanted = Path(tmp) / "state" / "lgpio"
            self.assertEqual(lgpio_work_dir(wanted), str(wanted))
            self.assertEqual(os.stat(wanted).st_mode & 0o777, 0o700)

    def test_unwritable_preference_falls_back_to_a_private_temporary_directory(self) -> None:
        chosen = lgpio_work_dir(Path("/proc/not-writable/lgpio"))
        self.addCleanup(lambda: os.rmdir(chosen))
        self.assertTrue(os.path.isdir(chosen) and os.access(chosen, os.W_OK))
        self.assertIn("balwyn-lgpio-", chosen)


class PortalClientTests(unittest.TestCase):
    def test_redirect_is_refused_and_the_credential_is_not_forwarded(self) -> None:
        seen: list = []

        class Elsewhere(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                seen.append(self.headers.get("Authorization")); self.send_response(200); self.end_headers()
            do_POST = do_GET

        other = ThreadingHTTPServer(("127.0.0.1", 0), Elsewhere)
        threading.Thread(target=other.serve_forever, daemon=True).start()
        self.addCleanup(other.shutdown)
        target = f"http://127.0.0.1:{other.server_address[1]}/"

        class Redirect(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_POST(self) -> None:  # noqa: N802
                self.send_response(301); self.send_header("Location", target); self.send_header("Content-Length", "0"); self.end_headers()

        portal = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        threading.Thread(target=portal.serve_forever, daemon=True).start()
        self.addCleanup(portal.shutdown)
        client = PortalClient(f"http://127.0.0.1:{portal.server_address[1]}", "TF-ENTRY", TOKEN, timeout_s=2)
        with self.assertRaises(PortalError) as caught:
            client.poll("closed", True, [], True)
        self.assertEqual(caught.exception.status, 301)
        self.assertEqual(seen, [])

    def test_a_non_object_json_reply_is_a_portal_error_not_a_crash(self) -> None:
        class ListReply(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_POST(self) -> None:  # noqa: N802
                body = b"[1, 2]"
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), ListReply)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        with self.assertRaises(PortalError):
            PortalClient(f"http://127.0.0.1:{server.server_address[1]}", "TF-ENTRY", TOKEN, timeout_s=2).poll("closed", True, [], True)


class ThreadedNetworkTests(unittest.TestCase):
    """The service configuration: portal exchanges on a worker thread, real clock."""

    def build(self, url: str, state: str, backend: FakeBackend, **extra: str) -> GateController:
        config = Config.from_env(env(url, state, CYCLE_PULSE_S="1", TRAVEL_TIMEOUT_S="10", AUTO_CLOSE_TIMEOUT_S="20", **extra))
        io = GateIO(backend, config.relay_pin, config.relay_active_low, config.closed_reed_pin, config.open_reed_pin,
                    config.safety_pin, config.input_active_low, config.input_pull)
        return GateController(config, io, PortalClient(url, "TF-ENTRY", TOKEN, timeout_s=8), Journal(Path(state)),
                              threaded_network=True)

    def test_black_holed_network_never_stalls_the_loop_and_a_fire_hold_survives(self) -> None:
        hole = BlackHole()
        self.addCleanup(hole.close)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        backend = FakeBackend(); gate = SimGate(backend)
        ctl = self.build(hole.url, tmp.name, backend)
        ctl.relay.hold("emergency")
        ctl._queue_ack(1, "acknowledged", "fire open confirmed")
        ctl._queue_ack(2, "acknowledged", "second")
        worst = 0.0
        end = time.monotonic() + 3.0
        while time.monotonic() < end:  # three seconds of the real service loop
            started = time.monotonic()
            gate.step(0.05)
            ctl.tick()
            worst = max(worst, time.monotonic() - started)
            time.sleep(0.05)
        self.assertLess(worst, 0.25, f"a tick blocked for {worst:.2f} s")
        self.assertTrue(ctl.link.busy(), "the exchange is still waiting on the black hole")
        self.assertTrue(gate.relay_on(), "the fire hold must survive a black-holed network")
        self.assertEqual(len(ctl.pending_acks), 2, "undelivered acknowledgements are kept for later")

    def test_manual_open_is_confirmed_end_to_end_with_a_threaded_link(self) -> None:
        portal = FakePortal(); self.addCleanup(portal.close)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        backend = FakeBackend(); gate = SimGate(backend, travel=1.0, auto_close=2.0)
        ctl = self.build(portal.url, tmp.name, backend)
        last = time.monotonic()
        queued = False
        end = time.monotonic() + 8.0
        while time.monotonic() < end and not any(cid == 21 for cid, _ in portal.acks):
            now = time.monotonic(); gate.step(now - last); last = now
            ctl.tick()
            if not queued and portal.polls and portal.polls[-1]["position"] == "closed" and portal.polls[-1]["safetyOk"]:
                portal.queue.append({"id": 21, "command": "open", "source": "manual"}); queued = True
            time.sleep(0.02)
        acks = [body for cid, body in portal.acks if cid == 21]
        self.assertTrue(acks, "no acknowledgement reached the portal")
        self.assertEqual(acks[0]["state"], "acknowledged")
        self.assertEqual(acks[0]["position"], "open")


# ------------------------------------------------- added 15 Oct 2026 review
KS = {"RELAY_BOARD": "keyestudio-ks0212", "RELAY_ACTIVE_LOW": "false", "RELAY_PIN": "22", "UNLOCK_RELAY_PIN": "4",
      "CLOSED_REED_PIN": "17", "OPEN_REED_PIN": "27", "SAFETY_INPUT": "5", "UNLOCK_SENSE_PIN": "13"}


def ks_env(**extra: str) -> dict:
    values = env("https://magickeys-balwyn-portal.com", "/tmp/x", **KS)
    values.pop("ALLOW_INSECURE_HTTP_FOR_TESTS")
    values.update(extra)
    return values


class RelayBoardTests(unittest.TestCase):
    def test_ks0212_accepts_its_own_pins_switched_on_high(self) -> None:
        config = Config.from_env(ks_env())
        self.assertEqual((config.relay_board, config.relay_pin, config.unlock_relay_pin, config.relay_active_low),
                         ("keyestudio-ks0212", 22, 4, False))

    def test_ks0212_refuses_the_old_example_wiring(self) -> None:
        # The generic example's relay GPIO 17 / active-low / closed reed on GPIO 22
        # would leave the gate relay dead and put a reed on the shield's relay 2.
        cases = [
            ({"RELAY_ACTIVE_LOW": "true"}, "RELAY_ACTIVE_LOW must be false"),
            ({"RELAY_PIN": "17", "CLOSED_REED_PIN": "23"}, "RELAY_PIN must be one of GPIO 4, 22, 6, 26"),
            ({"UNLOCK_RELAY_PIN": "25"}, "UNLOCK_RELAY_PIN must be one of GPIO 4, 22, 6, 26"),
            ({"RELAY_PIN": "26", "CLOSED_REED_PIN": "22"}, "CLOSED_REED_PIN must not be GPIO 22"),
            ({"SAFETY_INPUT": "6"}, "SAFETY_INPUT must not be GPIO 6"),
            ({"OPEN_REED_PIN": "26"}, "OPEN_REED_PIN must not be GPIO 26"),
            ({"UNLOCK_SENSE_PIN": "26"}, "UNLOCK_SENSE_PIN must not be GPIO 26"),
            ({"RELAY_BOARD": "keyestudio"}, "RELAY_BOARD must be"),
        ]
        for change, message in cases:
            with self.subTest(change=change), self.assertRaisesRegex(ConfigError, message):
                Config.from_env(ks_env(**change))

    def test_relay_outputs_never_on_pins_the_pi_pulls_high_itself(self) -> None:
        for pin in ("2", "3", "14", "15"):
            for name in ("RELAY_PIN", "UNLOCK_RELAY_PIN"):
                with self.subTest(pin=pin, name=name), self.assertRaisesRegex(ConfigError, f"{name} must not be GPIO {pin}"):
                    extra = {name: pin}
                    if name == "UNLOCK_RELAY_PIN":
                        extra["RELAY_PIN"] = "17"
                    Config.from_env({**env("https://magickeys-balwyn-portal.com", "/tmp/x"), **extra,
                                     "CLOSED_REED_PIN": "22", "OPEN_REED_PIN": "23", "SAFETY_INPUT": "24"})
        # An INPUT on such a pin is still allowed (a reed only reads it).
        Config.from_env({**env("https://magickeys-balwyn-portal.com", "/tmp/x"), "SAFETY_INPUT": "14"})

    def test_relays_off_settings_need_no_portal_or_credential(self) -> None:
        pins, active_low = relay_outputs_from_env({"RELAY_BOARD": "keyestudio-ks0212", "RELAY_PIN": "26",
                                                   "UNLOCK_RELAY_PIN": "6", "RELAY_ACTIVE_LOW": "false"})
        self.assertEqual((pins, active_low), ([26, 6], False))
        with self.assertRaisesRegex(ConfigError, "RELAY_ACTIVE_LOW must be false"):
            relay_outputs_from_env({"RELAY_BOARD": "keyestudio-ks0212", "RELAY_PIN": "26", "RELAY_ACTIVE_LOW": "true"})
        with self.assertRaisesRegex(ConfigError, "RELAY_PIN is required"):
            relay_outputs_from_env({"RELAY_ACTIVE_LOW": "true"})


class RelayPinSafetyTests(unittest.TestCase):
    def test_relays_are_claimed_off_with_the_pull_that_keeps_them_off(self) -> None:
        for active_low, off_level, pull in ((True, 1, "up"), (False, 0, "down")):
            with self.subTest(active_low=active_low):
                backend = FakeBackend()
                io = GateIO(backend, 22, active_low, 17, 27, 5, True, "up", unlock_relay_pin=4, unlock_sense_pin=13)
                self.assertEqual(backend.output_pulls, {22: pull, 4: pull})
                self.assertEqual((backend.levels[22], backend.levels[4]), (off_level, off_level))
                self.assertEqual(io.pull_fallback, [])

    def test_a_kernel_refusing_the_pull_still_gets_the_relay_claimed_off(self) -> None:
        backend = FakeBackend()
        backend.refuse_output_pull = True
        io = GateIO(backend, 22, False, 17, 27, 5, True, "up", unlock_relay_pin=4)
        self.assertEqual(io.pull_fallback, [22, 4])
        self.assertEqual((backend.levels[22], backend.levels[4]), (0, 0))

    def test_force_relays_off_drives_off_then_releases(self) -> None:
        for active_low, off_level in ((True, 1), (False, 0)):
            backend = FakeBackend()
            force_relays_off(backend, [26, 6], active_low, settle_s=0)
            self.assertEqual(backend.writes, [(26, off_level), (6, off_level)])
            self.assertTrue(backend.closed)

    def test_relays_off_command_works_without_portal_settings(self) -> None:
        import balwyn_gate_controller.__main__ as entry
        backend = FakeBackend()
        saved_env = dict(os.environ)
        saved_backend = entry.LgpioBackend
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved_env)))
        self.addCleanup(lambda: setattr(entry, "LgpioBackend", saved_backend))
        entry.LgpioBackend = lambda _work_dir: backend  # type: ignore[assignment]
        for name in ("PORTAL_URL", "CONTROLLER_TOKEN", "CONTROLLER_TOKEN_FILE", "GATE_ID"):
            os.environ.pop(name, None)
        os.environ.update({"RELAY_BOARD": "keyestudio-ks0212", "RELAY_PIN": "22", "UNLOCK_RELAY_PIN": "4",
                           "RELAY_ACTIVE_LOW": "false"})
        self.assertEqual(entry.main(["x", "relays-off"]), 0)
        self.assertEqual(backend.levels, {22: 0, 4: 0})
        self.assertTrue(backend.closed)

    def test_two_gates_on_one_pi_cannot_share_a_pin(self) -> None:
        backend = FakeBackend(strict_claims=True)
        GateIO(backend, 22, False, 17, 27, 5, True, "up", unlock_relay_pin=4, unlock_sense_pin=13)
        GateIO(backend, 26, False, 23, 24, 25, True, "up", unlock_relay_pin=6, unlock_sense_pin=16)  # SIDE-ENTRY: no overlap
        # A third service whose relay pin is SIDE-ENTRY's is refused with a message naming the pin.
        with self.assertRaisesRegex(GpioBusyError, "GPIO 26 is already in use"):
            GateIO(backend, 26, False, 19, None, None, True, "up")
        # And an input that overlaps the other gate's reed is refused too.
        with self.assertRaisesRegex(GpioBusyError, "GPIO 17 is already in use"):
            GateIO(backend, 21, False, 17, None, None, True, "up")


class StartupReportTests(unittest.TestCase):
    def test_first_heartbeat_waits_for_stable_reeds_and_reports_closed(self) -> None:
        rig = Rig(self)
        rig.run(0.2)
        self.assertEqual(rig.portal.polls, [], "no heartbeat before the reeds are debounced")
        rig.run(1)
        self.assertEqual(rig.portal.polls[0]["position"], "closed")


class DeploymentFileReviewTests(unittest.TestCase):
    def test_unit_forces_relays_off_after_every_stop(self) -> None:
        unit = (DEPLOY / "balwyn-gate@.service").read_text(encoding="utf-8")
        self.assertIn("ExecStopPost=-/usr/bin/python3 -m balwyn_gate_controller relays-off", unit)

    def test_ks0212_examples_pass_check_config_and_never_overlap(self) -> None:
        used: dict[int, str] = {}
        gates = []
        for name in ("ks0212-TF-ENTRY.env.example", "ks0212-SIDE-ENTRY.env.example"):
            values = systemd_env_file(DEPLOY / name)
            config = Config.from_env({**values, "CONTROLLER_TOKEN": TOKEN, "STATE_DIRECTORY": "/tmp/x"})
            self.assertTrue(config.dry_run)
            self.assertFalse(config.schedule_control)
            self.assertEqual(config.relay_board, "keyestudio-ks0212")
            gates.append(config.gate_id)
            for pin in (config.relay_pin, config.unlock_relay_pin, config.closed_reed_pin, config.open_reed_pin,
                        config.safety_pin, config.unlock_sense_pin):
                self.assertIsNotNone(pin)
                self.assertNotIn(pin, used, f"GPIO {pin} used by both {used.get(pin)} and {config.gate_id}")
                used[pin] = config.gate_id
        self.assertEqual(gates, ["TF-ENTRY", "SIDE-ENTRY"])
        self.assertEqual({p for p, g in used.items() if p in (4, 22, 6, 26)}, {4, 22, 6, 26})


class StubLgpio:
    """Stands in for the lgpio module so LgpioBackend's own code is tested (no GPIO)."""

    SET_PULL_UP, SET_PULL_DOWN, SET_PULL_NONE = 32, 64, 128

    class error(Exception):  # noqa: N801 - lgpio's name
        pass

    def __init__(self, busy: set[int] = frozenset(), refuse_pull: bool = False, broken: set[int] = frozenset()) -> None:
        self.busy, self.refuse_pull, self.broken = set(busy), refuse_pull, set(broken)
        self.claims: list[tuple] = []
        self.closed = False

    def gpiochip_open(self, _chip: int) -> int:
        return 7

    def _check(self, gpio: int, flags: int) -> None:
        if gpio in self.busy:
            raise self.error("GPIO busy")
        if gpio in self.broken or (self.refuse_pull and flags):
            raise self.error("unexpected error")

    def gpio_claim_output(self, _h: int, gpio: int, level: int, flags: int = 0) -> int:
        self._check(gpio, flags)
        self.claims.append(("out", gpio, level, flags))
        return 0

    def gpio_claim_input(self, _h: int, gpio: int, flags: int = 0) -> int:
        self._check(gpio, 0)
        self.claims.append(("in", gpio, flags))
        return 0

    def gpiochip_close(self, _h: int) -> None:
        self.closed = True


class LgpioBackendTests(unittest.TestCase):
    def backend(self, stub: StubLgpio):
        from balwyn_gate_controller.hardware import LgpioBackend
        saved = sys.modules.get("lgpio")
        sys.modules["lgpio"] = stub  # type: ignore[assignment]
        self.addCleanup(lambda: sys.modules.__setitem__("lgpio", saved) if saved else sys.modules.pop("lgpio", None))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        saved_wd = os.environ.pop("LG_WD", None)
        self.addCleanup(lambda: os.environ.__setitem__("LG_WD", saved_wd) if saved_wd else os.environ.pop("LG_WD", None))
        return LgpioBackend(Path(tmp.name))

    def test_output_is_claimed_with_the_pull_flag(self) -> None:
        stub = StubLgpio()
        self.assertTrue(self.backend(stub).claim_output(22, 0, "down"))
        self.assertEqual(stub.claims, [("out", 22, 0, StubLgpio.SET_PULL_DOWN)])

    def test_refused_pull_falls_back_to_a_plain_off_claim(self) -> None:
        stub = StubLgpio(refuse_pull=True)
        self.assertFalse(self.backend(stub).claim_output(22, 0, "down"))
        self.assertEqual(stub.claims, [("out", 22, 0, 0)])

    def test_busy_pin_gives_the_plain_english_error(self) -> None:
        stub = StubLgpio(busy={22})
        with self.assertRaisesRegex(GpioBusyError, "GPIO 22 is already in use by another program"):
            self.backend(stub).claim_output(22, 0, "down")
        with self.assertRaisesRegex(GpioBusyError, "GPIO 22"):
            self.backend(StubLgpio(busy={22})).claim_input(22, "up")

    def test_a_real_error_is_not_masked_by_the_fallback(self) -> None:
        stub = StubLgpio(broken={22})
        with self.assertRaises(StubLgpio.error):
            self.backend(stub).claim_output(22, 0, "down")
        self.assertEqual(stub.claims, [])

    def test_force_off_carries_on_past_a_busy_pin(self) -> None:
        stub = StubLgpio(busy={26})
        done, failed = force_relays_off(self.backend(stub), [26, 6], False, settle_s=0)
        self.assertEqual(done, [6])
        self.assertIn("GPIO 26", failed[26])
        self.assertEqual(stub.claims, [("out", 6, 0, StubLgpio.SET_PULL_DOWN)])
        self.assertTrue(stub.closed)


class RelaysOffCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        import balwyn_gate_controller.__main__ as entry
        self.entry = entry
        self.backend = FakeBackend()
        saved_env, saved_backend = dict(os.environ), entry.LgpioBackend
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved_env)))
        self.addCleanup(lambda: setattr(entry, "LgpioBackend", saved_backend))
        entry.LgpioBackend = lambda _work_dir: self.backend  # type: ignore[assignment]
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["STATE_DIRECTORY"] = self.tmp.name

    def test_recorded_pins_are_switched_off_even_after_the_env_file_was_edited(self) -> None:
        from balwyn_gate_controller.hardware import record_relay_outputs
        record_relay_outputs(Path(self.tmp.name), [22, 4], False)       # what the dead process drove
        os.environ.update({"RELAY_BOARD": "keyestudio-ks0212", "RELAY_PIN": "26", "RELAY_ACTIVE_LOW": "false"})
        self.assertEqual(self.entry.main(["x", "relays-off"]), 0)
        self.assertEqual(self.backend.levels, {22: 0, 4: 0, 26: 0})

    def test_a_broken_env_file_still_switches_the_recorded_pins_off(self) -> None:
        from balwyn_gate_controller.hardware import record_relay_outputs
        record_relay_outputs(Path(self.tmp.name), [22, 4], False)
        os.environ.update({"RELAY_PIN": "22  # edited", "RELAY_ACTIVE_LOW": "false"})
        self.assertEqual(self.entry.main(["x", "relays-off"]), 2)       # reported, not silent
        self.assertEqual(self.backend.levels, {22: 0, 4: 0})

    def test_recorded_polarity_wins_over_an_edited_one(self) -> None:
        from balwyn_gate_controller.hardware import record_relay_outputs
        record_relay_outputs(Path(self.tmp.name), [17], True)           # active-low board: OFF = HIGH
        os.environ.update({"RELAY_PIN": "17", "RELAY_ACTIVE_LOW": "false"})
        self.entry.main(["x", "relays-off"])
        self.assertEqual(self.backend.levels, {17: 1})

    def test_run_records_its_relay_pins_before_operating_anything(self) -> None:
        from balwyn_gate_controller.hardware import recorded_relay_outputs
        os.environ.update({**ks_env(STATE_DIRECTORY=self.tmp.name)})
        config = Config.from_env()
        self.backend.strict_claims = True
        # run() fails at the portal client only after the record is written; stop it straight away.
        import balwyn_gate_controller.__main__ as entry
        saved = entry.GateController
        self.addCleanup(lambda: setattr(entry, "GateController", saved))
        def boom(*_a, **_k):
            raise SystemExit(9)
        entry.GateController = boom  # type: ignore[assignment]
        with self.assertRaises(SystemExit):
            entry.run(config)
        self.assertEqual(recorded_relay_outputs(Path(self.tmp.name)), ([22, 4], False))


class InterruptedRestartTests(unittest.TestCase):
    def test_interrupted_command_ack_reports_the_real_position_not_unknown(self) -> None:
        rig = Rig(self)
        rig.ctl.journal.begin({"id": 41, "command": "open", "source": "manual"})  # crashed mid-command
        rig.build()                                                               # the restart
        rig.run(0.1)
        self.assertEqual((rig.portal.polls, rig.acks_for(41)), ([], []), "nothing sent before the reeds settle")
        rig.run(1)
        ack = rig.acks_for(41)[0]
        self.assertEqual((ack["state"], ack["position"], ack["safetyOk"]), ("failed", "closed", True))
        self.assertEqual(rig.portal.polls[0]["position"], "closed")


if __name__ == "__main__":
    unittest.main()
