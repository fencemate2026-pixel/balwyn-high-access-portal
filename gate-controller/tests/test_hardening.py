"""Tests for the faults found by the 15 Oct 2026 review (correctness, security, mutation).

Every test here was run against the code BEFORE the fix and failed there (see FAULT-REGISTER.md).
No GPIO: FakeBackend only. Fixtures come from test_controller.py.
"""

from __future__ import annotations

import http.client
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path

from test_controller import RELAY, SAFETY, TOKEN, FakePortal, Rig, SimGate, board_rig, env

from balwyn_gate_controller import __main__ as entry
from balwyn_gate_controller.config import Config, ConfigError
from balwyn_gate_controller.controller import EXCHANGE_ABANDON_S, Exchange, PortalLink
from balwyn_gate_controller.hardware import FakeBackend, RELAY_RECORD, recorded_relay_outputs
from balwyn_gate_controller.journal import Journal
from balwyn_gate_controller.portal import PortalClient, PortalError

URL = "https://magickeys-balwyn-portal.com"


def poll_returning(command: object, after_ms: object = 750):
    """Replace the portal poll with one fixed reply (in-process: nothing leaves the test)."""
    sent = []

    def poll(*_args: object) -> dict:
        sent.append(1)
        return {"command": command, "commissioned": True, "pollAfterMs": after_ms}

    poll.sent = sent  # type: ignore[attr-defined]
    return poll


class MalformedPortalReplyTests(unittest.TestCase):
    def test_a_non_finite_command_id_is_ignored_and_does_not_end_the_process(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.ctl.portal.poll = poll_returning({"id": float("inf"), "command": "open", "source": "emergency"})
        rig.run(3)  # used to raise OverflowError out of tick()
        self.assertFalse(rig.gate.relay_on())
        self.assertIn("command_malformed", rig.audit_events())

    def test_other_malformed_ids_are_ignored(self) -> None:
        rig = Rig(self)
        rig.run(1)
        for bad in (True, 12.0, "12", None, -4, 0, 2 ** 60, [1]):
            rig.ctl.portal.poll = poll_returning({"id": bad, "command": "open", "source": "manual"})
            rig.run(1)
        self.assertFalse(rig.gate.relay_on())
        self.assertEqual(rig.relay_writes_on(), 0)

    def test_a_nan_poll_interval_does_not_stop_polling_for_ever(self) -> None:
        rig = Rig(self)
        rig.run(1)
        poll = poll_returning(None, after_ms=float("nan"))
        rig.ctl.portal.poll = poll
        rig.run(30)
        self.assertGreater(len(poll.sent), 5)  # used to be exactly 1

    def test_a_handler_error_never_ends_the_process_and_leaves_the_relay_off(self) -> None:
        rig = Rig(self)
        rig.run(1)

        def boom(*_a: object, **_k: object) -> None:
            raise RuntimeError("simulated bug")

        rig.ctl.relay.pulse = boom  # type: ignore[assignment]
        rig.ctl.portal.poll = poll_returning({"id": 5, "command": "open", "source": "manual"})
        rig.run(2)  # must not raise
        self.assertIn("command_handler_error", rig.audit_events())
        self.assertFalse(rig.gate.relay_on())
        self.assertEqual(rig.acks_for(5)[0]["state"], "failed")

    def test_an_unknown_source_is_refused_without_touching_the_relay(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 6, "command": "open", "source": "x" * 5000})
        rig.run(3)
        self.assertEqual(rig.relay_writes_on(), 0)
        self.assertEqual(rig.acks_for(6)[0]["state"], "failed")
        self.assertLess(len(rig.acks_for(6)[0]["detail"]), 200)
        self.assertLess(Path(rig.tmp.name, "audit.jsonl").stat().st_size, 5000)


class FireHoldTests(unittest.TestCase):
    def fire(self, rig: Rig, command_id: int = 10) -> None:
        rig.run(1)
        rig.portal.queue.append({"id": command_id, "command": "open", "source": "emergency"})
        rig.run(20)
        self.assertTrue(rig.gate.relay_on(), "fire hold is on")

    def test_a_close_can_end_a_fire_hold_while_a_safety_device_is_tripped(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.gate.safety = False
        rig.run(1)
        self.assertTrue(rig.gate.relay_on(), "a fire hold survives a safety trip (existing, intended behaviour)")
        rig.portal.queue.append({"id": 11, "command": "closed", "source": "emergency"})
        rig.run(5)
        self.assertFalse(rig.gate.relay_on(), "the close was refused as 'blocked' before the fix")
        rig.run(60)  # the ack is sent once the gate has physically closed
        self.assertNotEqual(rig.acks_for(11)[0]["state"], "blocked")

    def test_a_safety_trip_still_blocks_an_open(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.gate.safety = False
        rig.run(1)
        rig.portal.queue.append({"id": 12, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.relay_writes_on(), 0)
        self.assertEqual(rig.acks_for(12)[0]["state"], "blocked")

    def test_a_schedule_close_cannot_end_a_fire_hold(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.portal.queue.append({"id": 13, "command": "closed", "source": "schedule"})
        rig.run(5)
        self.assertTrue(rig.gate.relay_on())
        self.assertEqual(rig.acks_for(13)[0]["state"], "blocked")

    def test_a_manual_close_still_ends_a_fire_hold(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.portal.queue.append({"id": 14, "command": "closed", "source": "manual"})
        rig.run(5)
        self.assertFalse(rig.gate.relay_on())

    def test_a_fire_open_works_while_the_previous_unlock_press_is_still_running(self) -> None:
        rig = board_rig(self, sense=False)
        rig.extra["UNLOCK_PULSE_S"] = "2"
        rig.build()
        rig.run(1)
        rig.portal.queue.append({"id": 20, "command": "open", "source": "manual"})
        rig.run(0.8)
        rig.portal.queue.append({"id": 21, "command": "open", "source": "emergency"})
        rig.run(30)
        self.assertEqual(rig.acks_for(21)[0]["state"], "acknowledged")


class TruthfulAcknowledgementTests(unittest.TestCase):
    def test_a_refused_command_is_never_reported_as_done_when_the_portal_re_sends_it(self) -> None:
        rig = Rig(self)
        rig.run(1)
        rig.gate.safety = False
        rig.run(1)
        rig.portal.queue.append({"id": 9, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.acks_for(9)[0]["state"], "blocked")
        rig.gate.safety = True
        rig.gate.angle = 1.0  # somebody opened the gate by hand: the position now matches the command
        rig.gate.publish()
        rig.run(2)
        rig.portal.queue.append({"id": 9, "command": "open", "source": "manual"})
        rig.run(3)
        states = [a["state"] for a in rig.acks_for(9)]
        self.assertNotIn("acknowledged", states)

    def test_schedule_control_off_refuses_a_schedule_open(self) -> None:
        rig = Rig(self, SCHEDULE_CONTROL="false")
        rig.run(1)
        rig.portal.queue.append({"id": 30, "command": "open", "source": "schedule"})
        rig.run(5)
        self.assertEqual(rig.relay_writes_on(), 0)
        self.assertEqual(rig.acks_for(30)[0]["state"], "blocked")

    def test_schedule_control_off_still_allows_manual_and_fire(self) -> None:
        rig = Rig(self, SCHEDULE_CONTROL="false")
        rig.run(1)
        rig.portal.queue.append({"id": 31, "command": "open", "source": "manual"})
        rig.run(20)
        self.assertEqual(rig.acks_for(31)[0]["state"], "acknowledged")

    def test_an_open_that_cannot_be_confirmed_does_not_leave_a_schedule_hold_on(self) -> None:
        rig = Rig(self, gate_factory=lambda b, open_reed: SimGate(b, travel=1000.0, open_reed=open_reed))
        rig.run(1)
        rig.portal.queue.append({"id": 40, "command": "open", "source": "schedule"})
        rig.run(40)  # TRAVEL_TIMEOUT_S is 30
        self.assertEqual(rig.acks_for(40)[0]["state"], "failed")
        self.assertFalse(rig.gate.relay_on(), "the relay stayed on behind a 'failed' report for up to 14 hours")

    def test_an_unconfirmed_fire_hold_is_kept(self) -> None:
        rig = Rig(self, gate_factory=lambda b, open_reed: SimGate(b, travel=1000.0, open_reed=open_reed))
        rig.run(1)
        rig.portal.queue.append({"id": 41, "command": "open", "source": "emergency"})
        rig.run(40)
        self.assertEqual(rig.acks_for(41)[0]["state"], "failed")
        self.assertTrue(rig.gate.relay_on(), "life safety: the evacuation hold is never dropped by a timeout")

    def test_one_answer_per_command_in_the_queue(self) -> None:
        rig = Rig(self)
        rig.ctl._queue_ack(7, "failed", "a")
        rig.ctl._queue_ack(7, "failed", "b")
        self.assertEqual(len(rig.ctl.pending_acks), 1)

    def test_an_ack_the_portal_permanently_rejects_is_dropped(self) -> None:
        rig = Rig(self)
        rig.run(1)
        calls = []

        def conflict(command_id: int, *_a: object) -> None:
            calls.append(command_id)
            raise PortalError("already acknowledged", status=409)

        rig.ctl.portal.ack = conflict
        rig.portal.queue.append({"id": 50, "command": "open", "source": "manual"})
        rig.run(30)
        self.assertEqual(calls, [50])
        self.assertEqual(rig.ctl.pending_acks, [])

    def test_an_ack_refused_for_a_bad_credential_is_kept_and_retried(self) -> None:
        rig = Rig(self)
        rig.run(1)
        calls = []

        def unauthorised(command_id: int, *_a: object) -> None:
            calls.append(command_id)
            raise PortalError("Controller authentication failed.", status=401)

        rig.ctl.portal.ack = unauthorised
        rig.portal.queue.append({"id": 51, "command": "open", "source": "manual"})
        rig.run(30)
        self.assertGreater(len(calls), 1)
        self.assertEqual(len(rig.ctl.pending_acks), 1)


class PortalLinkTests(unittest.TestCase):
    def test_a_finished_result_is_never_lost_to_a_new_exchange(self) -> None:
        link = PortalLink(threaded=True)
        link.start(lambda: Exchange(polled=True, response={"command": {"id": 99}}), 0.0)
        for _ in range(200):
            if not link.busy():
                break
            threading.Event().wait(0.01)
        result, busy, abandoned = link.check(1.0, EXCHANGE_ABANDON_S)
        self.assertIsNotNone(result)
        self.assertEqual(result.response["command"]["id"], 99)
        self.assertFalse(busy)
        self.assertFalse(abandoned)

    def test_a_hung_exchange_is_abandoned_and_its_late_result_discarded(self) -> None:
        link = PortalLink(threaded=True)
        release = threading.Event()
        link.start(lambda: (release.wait(10), Exchange(polled=True, response={"command": {"id": 1}}))[1], 100.0)
        result, busy, abandoned = link.check(100.0 + EXCHANGE_ABANDON_S - 1, EXCHANGE_ABANDON_S)
        self.assertEqual((result, busy, abandoned), (None, True, False))
        result, busy, abandoned = link.check(100.0 + EXCHANGE_ABANDON_S + 1, EXCHANGE_ABANDON_S)
        self.assertEqual((result, busy, abandoned), (None, False, True))
        link.start(lambda: Exchange(polled=True, response={"command": {"id": 2}}), 200.0)
        release.set()  # the stuck worker finally returns
        for _ in range(200):
            if not link.busy():
                break
            threading.Event().wait(0.01)
        result, _busy, _ab = link.check(201.0, EXCHANGE_ABANDON_S)
        self.assertEqual(result.response["command"]["id"], 2, "the abandoned worker's old reply must not replace the new one")


class JournalFaultTests(unittest.TestCase):
    def test_a_disk_error_when_finishing_a_command_does_not_raise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))
            journal.begin({"id": 1, "command": "open", "source": "manual"})
            original = journal._save

            def broken() -> None:
                raise OSError(28, "No space left on device")

            journal._save = broken  # type: ignore[assignment]
            journal.finish(1, "acknowledged", "ok")  # used to raise out of tick()
            self.assertTrue(any("could not be written" in f for f in journal.faults))
            self.assertTrue(journal.seen(1))
            journal._save = original  # type: ignore[assignment]

    def test_a_failed_begin_leaves_no_phantom_in_flight_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))
            journal._save = lambda: (_ for _ in ()).throw(OSError(30, "Read-only file system"))  # type: ignore[assignment]
            with self.assertRaises(OSError):
                journal.begin({"id": 2, "command": "open", "source": "manual"})
            self.assertIsNone(journal.in_flight)

    def test_a_state_file_with_a_broken_in_flight_record_is_set_aside_not_a_crash_loop(self) -> None:
        for bad in ({"done": {}, "in_flight": {"command": "open"}}, {"done": {}, "in_flight": {"id": "x"}},
                    {"done": {"1": "oops"}, "in_flight": None}, {"done": {}, "in_flight": [1]}):
            with tempfile.TemporaryDirectory() as tmp:
                Path(tmp, "state.json").write_text(json.dumps(bad), encoding="utf-8")
                journal = Journal(Path(tmp))
                self.assertIsNone(journal.interrupted())
                self.assertTrue(journal.faults)
                self.assertTrue(list(Path(tmp).glob("state.json.corrupt-*")))

    def test_audit_text_from_the_portal_is_clipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))
            journal.audit("command_start", {"source": "A" * 60000})
            self.assertLess(Path(tmp, "audit.jsonl").stat().st_size, 1000)

    def test_the_directory_is_synced_after_the_state_file_is_renamed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))
            synced = []
            journal._sync_directory = lambda: synced.append(1)  # type: ignore[assignment]
            journal.begin({"id": 3, "command": "open", "source": "manual"})
            self.assertEqual(synced, [1])

    def test_two_threads_writing_the_audit_log_lose_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))

            def work(tag: str) -> None:
                for i in range(300):
                    journal.audit("e", {"tag": tag, "i": i})

            threads = [threading.Thread(target=work, args=(t,)) for t in "ab"]
            [t.start() for t in threads]
            [t.join() for t in threads]
            lines = Path(tmp, "audit.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 600)
            [json.loads(line) for line in lines]


class ConfigHardeningTests(unittest.TestCase):
    def test_plain_http_is_only_ever_allowed_to_this_machine(self) -> None:
        base = env("http://portal.example.com", "/tmp/x")
        with self.assertRaises(ConfigError):
            Config.from_env(base)  # ALLOW_INSECURE_HTTP_FOR_TESTS=1 is in env(), and the host is not loopback
        Config.from_env(env("http://127.0.0.1:8080", "/tmp/x"))

    def test_a_missing_ca_file_is_caught_by_check_config_not_by_a_crash_loop(self) -> None:
        with self.assertRaisesRegex(ConfigError, "CA_FILE"):
            Config.from_env({**env(URL, "/tmp/x"), "CA_FILE": "/nonexistent/ca.pem"})

    def test_a_present_ca_file_is_accepted(self) -> None:
        with tempfile.NamedTemporaryFile() as handle:
            handle.write(b"x")
            handle.flush()
            self.assertEqual(Config.from_env({**env(URL, "/tmp/x"), "CA_FILE": handle.name}).ca_file, handle.name)

    def test_read_inputs_does_not_need_the_credential(self) -> None:
        values = env(URL, "/tmp/x")
        del values["CONTROLLER_TOKEN"]
        with self.assertRaises(ConfigError):
            Config.from_env(values)
        self.assertEqual(Config.from_env(values, need_token=False).token, "")

    def test_non_ascii_digits_are_a_config_error_not_a_crash(self) -> None:
        for digit in ("²", "١٧"):
            with self.assertRaises(ConfigError):
                Config.from_env({**env(URL, "/tmp/x"), "RELAY_PIN": digit})

    def test_the_recorded_relay_pins_never_include_a_pin_that_idles_high(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, RELAY_RECORD).write_text(json.dumps({"pins": [2, 3, 14, 15, 17], "active_low": False}), encoding="utf-8")
            self.assertEqual(recorded_relay_outputs(Path(tmp)), ([17], False))


class PortalClientHardeningTests(unittest.TestCase):
    def client(self) -> PortalClient:
        return PortalClient("https://magickeys-balwyn-portal.com", "TF-ENTRY", TOKEN)

    def test_a_json_list_error_body_is_a_portal_error_with_its_status(self) -> None:
        client = self.client()

        def opener(*_a: object, **_k: object) -> None:
            raise urllib.error.HTTPError("u", 409, "x", {}, io.BytesIO(b"[1,2]"))  # type: ignore[arg-type]

        client._opener.open = opener  # type: ignore[assignment]
        with self.assertRaises(PortalError) as caught:
            client.ack(1, "acknowledged", "open", True, "ok")
        self.assertEqual(caught.exception.status, 409)

    def test_an_error_message_cannot_carry_log_lines(self) -> None:
        client = self.client()
        body = json.dumps({"error": "bad\nCRITICAL forged line\r\n" + "x" * 1000}).encode()

        def opener(*_a: object, **_k: object) -> None:
            raise urllib.error.HTTPError("u", 500, "x", {}, io.BytesIO(body))  # type: ignore[arg-type]

        client._opener.open = opener  # type: ignore[assignment]
        with self.assertRaises(PortalError) as caught:
            client.poll("closed", True, [], False)
        self.assertNotIn("\n", str(caught.exception))
        self.assertLessEqual(len(str(caught.exception)), 200)

    def test_a_truncated_reply_is_a_portal_error(self) -> None:
        client = self.client()

        def opener(*_a: object, **_k: object) -> None:
            raise http.client.IncompleteRead(b"par")

        client._opener.open = opener  # type: ignore[assignment]
        with self.assertRaises(PortalError):
            client.poll("closed", True, [], False)

    def test_an_oversized_reply_is_refused(self) -> None:
        client = self.client()

        class Big:
            def __enter__(self) -> "Big":
                return self

            def __exit__(self, *_a: object) -> None:
                return None

            def read(self, _n: int) -> bytes:
                return b"x" * 4096

        client._opener.open = lambda *_a, **_k: Big()  # type: ignore[assignment]
        with self.assertRaises(PortalError):
            client.poll("closed", True, [], False)

    def test_a_reply_that_dribbles_in_too_slowly_is_refused(self) -> None:
        client = PortalClient("https://magickeys-balwyn-portal.com", "TF-ENTRY", TOKEN, total_s=0.0)

        class Slow:
            def __enter__(self) -> "Slow":
                return self

            def __exit__(self, *_a: object) -> None:
                return None

            def read(self, _n: int) -> bytes:
                return b" "

        client._opener.open = lambda *_a, **_k: Slow()  # type: ignore[assignment]
        with self.assertRaises(PortalError):
            client.poll("closed", True, [], False)


class TickLoopTests(unittest.TestCase):
    class Ctl:
        def __init__(self, fail_first: int) -> None:
            self.calls = 0
            self.fail_first = fail_first

        def tick(self) -> None:
            self.calls += 1
            if self.calls <= self.fail_first:
                raise OSError("transient GPIO read error")

    class Jnl:
        def __init__(self) -> None:
            self.events: list[str] = []

        def audit(self, event: str, _data: dict | None = None) -> None:
            self.events.append(event)

    def run_loop(self, ctl: "TickLoopTests.Ctl", ticks: int) -> list[str]:
        beats: list[str] = []
        count = [0]

        def stop() -> bool:
            count[0] += 1
            return count[0] > ticks

        entry.tick_loop(ctl, self.Jnl(), stop, sleep=lambda _s: None, heartbeat=beats.append)  # type: ignore[arg-type]
        return beats

    def test_a_single_bad_tick_is_survived_and_does_not_feed_the_watchdog(self) -> None:
        ctl = self.Ctl(fail_first=1)
        beats = self.run_loop(ctl, 5)
        self.assertEqual(ctl.calls, 5)
        self.assertEqual(len(beats), 4)

    def test_a_persistent_fault_is_raised_after_the_limit(self) -> None:
        ctl = self.Ctl(fail_first=10 ** 6)
        with self.assertRaises(OSError):
            self.run_loop(ctl, 10 ** 6)
        self.assertEqual(ctl.calls, entry.MAX_CONSECUTIVE_TICK_FAILURES)


class DeploymentHardeningTests(unittest.TestCase):
    unit = Path(__file__).resolve().parents[1] / "deploy" / "balwyn-gate@.service"

    def test_the_stop_timeout_leaves_relays_off_time_to_finish(self) -> None:
        text = self.unit.read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if l.startswith("TimeoutStopSec="))
        self.assertGreaterEqual(int(line.split("=")[1]), 20)

    def test_the_unit_does_not_wait_for_the_network_before_claiming_the_relay_pin(self) -> None:
        text = self.unit.read_text(encoding="utf-8")
        self.assertNotIn("network-online.target", "\n".join(l for l in text.splitlines() if not l.startswith("#")))

    def test_the_unit_has_the_extra_sandboxing_lines(self) -> None:
        text = self.unit.read_text(encoding="utf-8")
        for needed in ("RestrictNamespaces=true", "RestrictSUIDSGID=true", "RestrictRealtime=true", "ProtectKernelLogs=true",
                       "ProtectClock=true", "ProtectHostname=true", "UMask=0077", "SystemCallArchitectures=native"):
            self.assertIn(needed, text)


class FireHoldSurvivesRestartTests(unittest.TestCase):
    def fire(self, rig: Rig) -> None:
        rig.run(1)
        rig.portal.queue.append({"id": 10, "command": "open", "source": "emergency"})
        rig.run(20)
        self.assertTrue(rig.gate.relay_on())

    def test_a_restart_switches_a_fire_hold_back_on(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.ctl.shutdown()          # a service restart: the controller releases its relay on the way out
        rig.build()                 # the new process
        self.assertTrue(rig.gate.relay_on(), "the evacuation hold was silently ended by the restart")
        self.assertIn("emergency_hold_restored", rig.audit_events())

    def test_an_explicit_close_ends_it_for_good(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.portal.queue.append({"id": 11, "command": "closed", "source": "emergency"})
        rig.run(5)
        self.assertFalse(rig.gate.relay_on())
        rig.ctl.shutdown()
        rig.build()
        self.assertFalse(rig.gate.relay_on(), "the all-clear was forgotten by the restart")

    def test_a_stale_record_is_not_restored(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.ctl.shutdown()
        state = Path(rig.tmp.name, "state.json")
        data = json.loads(state.read_text(encoding="utf-8"))
        data["emergency_since"] = data["emergency_since"] - 13 * 3600
        state.write_text(json.dumps(data), encoding="utf-8")
        rig.build()
        self.assertFalse(rig.gate.relay_on())
        self.assertIn("emergency_hold_not_restored", rig.audit_events())

    def test_dry_run_never_restores_a_hold(self) -> None:
        rig = Rig(self)
        self.fire(rig)
        rig.ctl.shutdown()
        rig.extra["DRY_RUN"] = "true"
        rig.build()
        self.assertFalse(rig.gate.relay_on())

    def test_a_long_fire_hold_raises_a_visible_alarm_but_is_not_ended(self) -> None:
        rig = Rig(self, EMERGENCY_ALARM_S="60")
        self.fire(rig)
        self.assertFalse(any("Fire / evacuation hold has been on" in f for f in rig.ctl.faults))
        rig.run(70)
        self.assertTrue(any("Fire / evacuation hold has been on" in f for f in rig.ctl.faults))
        self.assertTrue(rig.gate.relay_on())

    def test_journal_remembers_and_forgets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            journal = Journal(Path(tmp))
            journal.set_emergency_hold(True)
            self.assertIsNotNone(Journal(Path(tmp)).emergency_since)
            journal.set_emergency_hold(False)
            self.assertIsNone(Journal(Path(tmp)).emergency_since)
            Path(tmp, "state.json").write_text(json.dumps({"done": {}, "in_flight": None, "emergency_since": "soon"}), encoding="utf-8")
            self.assertIsNone(Journal(Path(tmp)).emergency_since)


class OpenRateLimitTests(unittest.TestCase):
    def test_too_many_opens_are_blocked_but_a_fire_open_never_is(self) -> None:
        rig = Rig(self, OPEN_RATE_MAX="2", CYCLE_PULSE_S="2", TRAVEL_TIMEOUT_S="15", AUTO_CLOSE_TIMEOUT_S="40")
        rig.run(1)
        for command_id in (1, 2, 3):
            rig.portal.queue.append({"id": command_id, "command": "open", "source": "manual"})
            rig.run(60)
        self.assertEqual(rig.acks_for(1)[0]["state"], "acknowledged")
        self.assertEqual(rig.acks_for(2)[0]["state"], "acknowledged")
        self.assertEqual(rig.acks_for(3)[0]["state"], "blocked")
        self.assertIn("open commands in", rig.acks_for(3)[0]["detail"])
        rig.portal.queue.append({"id": 4, "command": "open", "source": "emergency"})
        rig.run(30)
        self.assertEqual(rig.acks_for(4)[0]["state"], "acknowledged")


class AckRouteTests(unittest.TestCase):
    def test_a_404_that_is_not_the_portals_command_not_found_is_retried(self) -> None:
        rig = Rig(self)
        rig.run(1)
        calls = []

        def route_missing(command_id: int, *_a: object) -> None:
            calls.append(command_id)
            raise PortalError("HTTP 404", status=404)

        rig.ctl.portal.ack = route_missing
        rig.portal.queue.append({"id": 60, "command": "open", "source": "manual"})
        rig.run(30)
        self.assertGreater(len(calls), 1)
        self.assertEqual(len(rig.ctl.pending_acks), 1)


class TokenFileTests(unittest.TestCase):
    def values(self, path: str, **extra: str) -> dict:
        base = env(URL, "/tmp/x")
        del base["CONTROLLER_TOKEN"]
        return {**base, "CONTROLLER_TOKEN_FILE": path, **extra}

    def make(self, directory: str, mode: int) -> str:
        path = os.path.join(directory, "token")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(TOKEN)
        os.chmod(path, mode)
        return path

    def test_a_token_file_other_users_can_read_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for mode in (0o644, 0o640, 0o604):
                with self.assertRaisesRegex(ConfigError, "readable by other users"):
                    Config.from_env(self.values(self.make(tmp, mode)))

    def test_a_private_token_file_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(Config.from_env(self.values(self.make(tmp, 0o600))).token, TOKEN)

    def test_systemds_private_copy_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.make(tmp, 0o644)
            self.assertEqual(Config.from_env(self.values(path, CREDENTIALS_DIRECTORY=tmp)).token, TOKEN)


class NewSettingsTests(unittest.TestCase):
    def test_defaults_and_ranges(self) -> None:
        config = Config.from_env(env(URL, "/tmp/x"))
        self.assertEqual((config.open_rate_max, config.open_rate_window_s), (30, 600.0))
        self.assertEqual((config.emergency_alarm_s, config.emergency_restore_max_s), (4 * 3600.0, 12 * 3600.0))
        for bad in ({"OPEN_RATE_MAX": "0"}, {"OPEN_RATE_WINDOW_S": "5"}, {"EMERGENCY_ALARM_S": "1"},
                    {"EMERGENCY_RESTORE_MAX_S": "-1"}, {"OPEN_RATE_MAX": "x"}):
            with self.assertRaises(ConfigError):
                Config.from_env({**env(URL, "/tmp/x"), **bad})


class Audit20261024Tests(unittest.TestCase):
    """24 Oct 2026 full audit. Each test failed on the code before its fix."""

    def test_clock_behind_the_record_still_restores_the_fire_hold(self) -> None:
        # Controller F1: a Pi boots after a power cut with an old clock (no RTC). The hold record then looks like it
        # is from the future; it must be restored, not erased.
        rig = Rig(self)
        FireHoldSurvivesRestartTests.fire(self, rig)
        rig.ctl.shutdown()
        state = Path(rig.tmp.name, "state.json")
        data = json.loads(state.read_text(encoding="utf-8"))
        data["emergency_since"] = data["emergency_since"] + 2 * 3600
        state.write_text(json.dumps(data), encoding="utf-8")
        rig.build()
        self.assertTrue(rig.gate.relay_on(), "a slow boot clock ended the evacuation hold")
        self.assertIn("emergency_hold_restored", rig.audit_events())
        self.assertIsNotNone(Journal(Path(rig.tmp.name)).emergency_since, "the hold record was erased")

    def test_a_failed_relay_write_is_not_recorded_as_a_hold(self) -> None:
        # Controller F2: state was set to "holding" before the GPIO write, so a failed write left a phantom hold and
        # the next fire OPEN returned early without retrying the write.
        from balwyn_gate_controller.relay import RelaySupervisor
        levels: list = []
        fail = {"on": True}

        def write(on: bool) -> None:
            if on and fail["on"]:
                raise OSError("gpio write failed")
            levels.append(on)

        relay = RelaySupervisor(write, hold_max_s=3600, network_loss_release_s=300, loop_stall_s=10,
                                audit=lambda *_a: None)
        with self.assertRaises(OSError):
            relay.hold("emergency")
        self.assertEqual(relay.state.mode, "idle", "a hold was recorded although the relay never switched on")
        with self.assertRaises(OSError):
            relay.pulse(1.0)
        self.assertEqual(relay.state.mode, "idle")
        fail["on"] = False
        relay.hold("emergency")
        self.assertEqual(relay.state.mode, "holding")
        self.assertEqual(levels[-1], True, "the retried fire hold actually energised the relay")


if __name__ == "__main__":
    unittest.main()
