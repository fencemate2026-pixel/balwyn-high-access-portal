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

from balwyn_gate_controller.config import Config, ConfigError  # noqa: E402
from balwyn_gate_controller.controller import GateController  # noqa: E402
from balwyn_gate_controller.hardware import FakeBackend, GateIO, lgpio_work_dir  # noqa: E402
from balwyn_gate_controller.journal import Journal  # noqa: E402
from balwyn_gate_controller.portal import PortalClient, PortalError  # noqa: E402
from balwyn_gate_controller.relay import RelaySupervisor  # noqa: E402

RELAY, CLOSED, OPEN, SAFETY = 17, 22, 23, 24
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
    def __init__(self, test: unittest.TestCase, **extra: str) -> None:
        self.portal = FakePortal()
        test.addCleanup(self.portal.close)
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.extra = extra
        self.backend = FakeBackend()
        self.gate = SimGate(self.backend, open_reed="OPEN_REED_PIN" not in extra)
        self.clock = Clock()
        self.build()

    def build(self) -> None:
        self.config = Config.from_env(env(self.portal.url, self.tmp.name, **self.extra))
        io = GateIO(self.backend, self.config.relay_pin, self.config.relay_active_low, self.config.closed_reed_pin,
                    self.config.open_reed_pin, self.config.safety_pin, self.config.input_active_low, self.config.input_pull)
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
        rig.portal.queue.append({"id": 9, "command": "closed", "source": "manual"})
        rig.gate.angle = 0.5; rig.gate.direction = 0; rig.gate.publish()  # stuck half-open: close job pending
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


if __name__ == "__main__":
    unittest.main()
