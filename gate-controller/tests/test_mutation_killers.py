"""Mutation-killing tests (added 15 Oct 2026 after a hand mutation run: 80 mutants, 34 survived the earlier 60-test suite).
Reuses the fixtures in test_controller.py."""
from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_controller import (CLOSED, OPEN, RELAY, SAFETY, UNLOCK, BOARD_SENSE, Clock, Rig, SimGate, board_rig, env)
from balwyn_gate_controller import journal as journal_mod
from balwyn_gate_controller.config import Config, ConfigError, relay_outputs_from_env
from balwyn_gate_controller.hardware import FakeBackend, GateIO, RELAY_RECORD, recorded_relay_outputs
from balwyn_gate_controller.journal import Journal
from balwyn_gate_controller.portal import PortalError
from balwyn_gate_controller.relay import PulseOutput, RelaySupervisor

URL = "https://magickeys-balwyn-portal.com"


def make_relay(**kw):
    clock, levels = Clock(), []
    relay = RelaySupervisor(levels.append, hold_max_s=3600, network_loss_release_s=300, loop_stall_s=10,
                            audit=lambda *_: None, clock=clock, **kw)
    return relay, clock, levels


def advance(relay, clock, seconds, step=5.0):
    """Move time on while the loop and the portal are both healthy."""
    for _ in range(int(seconds / step)):
        clock.t += step
        relay.feed(); relay.portal_ok(); relay.enforce()


class RelayKillers(unittest.TestCase):
    def test_a_pulse_request_longer_than_the_maximum_is_capped(self) -> None:          # M01
        relay, clock, levels = make_relay()
        relay.pulse(600)
        advance(relay, clock, 10.5, step=0.5)
        self.assertFalse(levels[-1])
        self.assertEqual(relay.state.released_reason, "pulse complete")

    def test_an_emergency_hold_is_not_downgraded_by_a_later_schedule_hold(self) -> None:  # M04
        relay, clock, levels = make_relay()
        relay.hold("emergency"); relay.hold("schedule")
        self.assertEqual(relay.state.hold_kind, "emergency")
        advance(relay, clock, 3700)                                  # past HOLD_MAX with a healthy loop and portal
        self.assertTrue(levels[-1])

    def test_a_schedule_hold_ends_at_the_maximum_duration_even_when_everything_is_healthy(self) -> None:  # M06
        relay, clock, levels = make_relay()
        relay.hold("schedule")
        advance(relay, clock, 3700)
        self.assertFalse(levels[-1])
        self.assertEqual(relay.state.released_reason, "hold exceeded maximum duration")

    def test_a_failing_unlock_output_is_retried_off_when_enforcement_raises(self) -> None:  # M13
        clock, calls = Clock(), []

        def flaky(on: bool) -> None:
            calls.append(on)
            if on is False and len(calls) == 3:        # 1: init OFF, 2: pulse ON, 3: the OFF at the deadline fails once
                raise OSError("gpio write failed")

        press = PulseOutput(flaky, audit=lambda *_: None, clock=clock)
        press.pulse(0.5)
        clock.t += 1
        with self.assertRaises(OSError):
            press.enforce()
        self.assertEqual(calls[-1], False)
        self.assertGreaterEqual(calls.count(False), 3)             # an OFF was attempted again
        self.assertFalse(press.active)

    def test_a_crashing_companion_never_stops_the_gate_relay_being_enforced(self) -> None:  # M14
        relay, clock, levels = make_relay()
        relay.add_companion(lambda now: (_ for _ in ()).throw(RuntimeError("boom")))
        relay.pulse(1)
        clock.t += 1.1; relay.feed()
        relay.enforce()                                            # must not raise
        self.assertFalse(levels[-1])


class ControllerKillers(unittest.TestCase):
    def test_unhealthy_safety_drops_a_schedule_hold(self) -> None:                      # M18
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 60, "command": "open", "source": "schedule"})
        rig.run(20)
        self.assertTrue(rig.gate.relay_on())
        rig.gate.safety = False
        rig.run(1)
        self.assertFalse(rig.gate.relay_on())
        self.assertIn("safety input not healthy", [e for e in [rig.ctl.relay.state.released_reason]])

    def test_unhealthy_safety_drops_a_manual_pulse(self) -> None:                       # M18
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 61, "command": "open", "source": "manual"})
        rig.run(1.5)
        self.assertTrue(rig.gate.relay_on())
        rig.gate.safety = False
        rig.run(0.5)
        self.assertFalse(rig.gate.relay_on())

    def test_unhealthy_safety_does_not_drop_a_fire_hold(self) -> None:                  # M17
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 62, "command": "open", "source": "emergency"})
        rig.run(15)
        self.assertTrue(rig.gate.relay_on())
        rig.gate.safety = False
        rig.run(3)
        self.assertTrue(rig.gate.relay_on())

    def test_a_redispatched_command_is_reported_against_the_real_position(self) -> None:  # M22
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 63, "command": "open", "source": "manual"})
        rig.run(60)                                                # opened, then the operator closed it again
        self.assertEqual(rig.ctl.position, "closed")
        rig.portal.queue.append({"id": 63, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.acks_for(63)[-1]["state"], "failed")  # NOT "acknowledged": the gate is shut
        self.assertEqual(rig.relay_writes_on(), 1)

    def test_a_fire_open_supersedes_an_open_waiting_for_the_board(self) -> None:         # M25
        rig = board_rig(self, board_responds=False)
        rig.run(1)
        rig.portal.queue.append({"id": 64, "command": "open", "source": "manual"})
        for _ in range(100):
            if rig.ctl.pending is not None:
                break
            rig.run(0.05)
        self.assertIsNotNone(rig.ctl.pending)
        rig.portal.queue.append({"id": 65, "command": "open", "source": "emergency"})
        rig.run(4)
        self.assertEqual(rig.acks_for(64)[0]["state"], "failed")
        self.assertIn("Superseded", rig.acks_for(64)[0]["detail"])
        self.assertEqual(rig.backend.levels[RELAY], 0)             # the fire hold is on

    def test_dry_run_never_operates_the_relay(self) -> None:                             # M27
        rig = Rig(self, DRY_RUN="true")
        rig.run(1)
        rig.portal.queue.append({"id": 66, "command": "open", "source": "emergency"})
        rig.run(3)
        self.assertEqual(rig.acks_for(66)[0]["state"], "failed")
        self.assertIn("Dry run", rig.acks_for(66)[0]["detail"])
        self.assertEqual(rig.relay_writes_on(), 0)

    def test_a_second_restart_does_not_report_the_interrupted_command_again(self) -> None:  # M30
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 67, "command": "open", "source": "manual"})
        rig.run(1.2)
        for _ in range(2):
            rig.backend = type(rig.backend)(); rig.gate.b = rig.backend; rig.gate.publish()
            rig.build(); rig.run(3)
        restarted = [b for cid, b in rig.portal.acks if cid == 67 and "restarted" in b["detail"]]
        self.assertEqual(len(restarted), 1)

    def test_a_finished_command_is_not_reported_as_interrupted_after_a_restart(self) -> None:  # M74
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 68, "command": "open", "source": "manual"})
        rig.run(15)
        self.assertEqual(rig.acks_for(68)[-1]["state"], "acknowledged")
        before = len(rig.acks_for(68))
        rig.build(); rig.run(3)
        self.assertEqual(len(rig.acks_for(68)), before)

    def test_a_finished_command_stays_finished_across_a_restart(self) -> None:           # M82
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 69, "command": "open", "source": "manual"})
        rig.run(15)
        rig.build(); rig.run(1)
        rig.portal.queue.append({"id": 69, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertEqual(rig.relay_writes_on(), 1)

    def test_the_same_command_arriving_again_mid_flight_is_ignored(self) -> None:        # M72
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 70, "command": "open", "source": "manual"})
        rig.portal.queue.append({"id": 70, "command": "open", "source": "emergency"})  # same id, re-dispatched
        rig.run(15)
        self.assertEqual([b["state"] for b in rig.acks_for(70)], ["acknowledged"])
        self.assertEqual(rig.relay_writes_on(), 1)

    def test_an_open_that_never_reaches_the_open_reed_fails_at_the_travel_timeout(self) -> None:  # M31, M39
        rig = Rig(self, gate_factory=lambda b, open_reed: SimGate(b, travel=1000.0, open_reed=open_reed))
        rig.run(1)
        rig.portal.queue.append({"id": 71, "command": "open", "source": "manual"})
        rig.run(40)                                               # TRAVEL_TIMEOUT_S = 30
        ack = rig.acks_for(71)[0]
        self.assertEqual(ack["state"], "failed")
        self.assertIn("NOT confirmed", ack["detail"])

    def test_the_portal_cannot_stretch_or_collapse_the_poll_interval(self) -> None:      # M36
        rig = Rig(self)
        rig.run(1)
        for ms, lo, hi in [(10 ** 9, 0.5, 5.0), (0, 0.5, 5.0)]:
            rig.ctl.portal.poll = lambda *a, _ms=ms: {"command": None, "pollAfterMs": _ms}
            rig.ctl.next_poll = 0.0
            rig.run(0.05)
            gap = rig.ctl.next_poll - rig.clock.t
            self.assertTrue(lo - 0.06 <= gap <= hi, (ms, gap))

    def test_a_schedule_hold_survives_past_the_network_loss_limit_while_the_portal_answers(self) -> None:  # M37
        rig = Rig(self, NETWORK_LOSS_RELEASE_S="60")
        rig.run(1)
        rig.portal.queue.append({"id": 72, "command": "open", "source": "schedule"})
        rig.run(120)
        self.assertTrue(rig.gate.relay_on())

    def test_an_ack_the_portal_no_longer_knows_is_dropped_not_retried_forever(self) -> None:  # M38
        rig = Rig(self)
        rig.run(1)
        calls = []

        def gone(command_id, *a):
            calls.append(command_id)
            raise PortalError("not found", status=404)

        rig.ctl.portal.ack = gone
        rig.portal.queue.append({"id": 73, "command": "open", "source": "manual"})
        rig.run(30)
        self.assertEqual(calls, [73])
        self.assertEqual(rig.ctl.pending_acks, [])

    def test_a_manual_open_during_a_hold_says_so_and_sends_no_pulse(self) -> None:       # M43 (message only)
        rig = Rig(self)
        rig.run(1)
        rig.portal.queue.append({"id": 74, "command": "open", "source": "schedule"})
        rig.run(20)
        rig.portal.queue.append({"id": 75, "command": "open", "source": "manual"})
        rig.run(3)
        self.assertIn("already held", rig.acks_for(75)[0]["detail"])

    def test_a_fire_open_is_not_refused_because_a_long_unlock_press_is_still_running(self) -> None:  # F1 (fixed 15 Oct 2026)
        rig = board_rig(self, sense=False)
        rig.extra["UNLOCK_PULSE_S"] = "2"; rig.build()
        rig.run(1)
        rig.portal.queue.append({"id": 76, "command": "open", "source": "manual"})
        rig.run(0.8)                                     # the manual command's 2 s press is now running
        self.assertTrue(rig.ctl.unlock.active)
        rig.portal.queue.append({"id": 77, "command": "open", "source": "emergency"})
        rig.run(30)
        ack = rig.acks_for(77)[0]
        self.assertEqual(ack["state"], "acknowledged", ack["detail"])
        self.assertNotIn("Unlock relay busy", ack["detail"])
        self.assertTrue(rig.gate.relay_on())             # the fire hold is on
        self.assertFalse(rig.gate.pushed_against_lock)


class ConfigKillers(unittest.TestCase):
    good = env(URL, "/tmp/x")

    def bad(self, message, **override):
        cfg = {**self.good, **override}
        cfg.pop("ALLOW_INSECURE_HTTP_FOR_TESTS", None)
        with self.assertRaisesRegex(ConfigError, message):
            Config.from_env(cfg)

    def test_gpio_0_1_and_28_are_rejected_for_every_pin_setting(self) -> None:           # M46
        for name in ("RELAY_PIN", "CLOSED_REED_PIN", "OPEN_REED_PIN", "SAFETY_INPUT", "UNLOCK_RELAY_PIN", "UNLOCK_SENSE_PIN"):
            for pin in ("0", "1", "28"):
                with self.subTest(name=name, pin=pin):
                    self.bad("between 2 and 27", **{name: pin})

    def test_travel_timeout_must_exceed_the_pulse(self) -> None:                         # M50
        self.bad("longer than CYCLE_PULSE_S", CYCLE_PULSE_S="6", TRAVEL_TIMEOUT_S="6")
        self.bad("longer than CYCLE_PULSE_S", CYCLE_PULSE_S="8", TRAVEL_TIMEOUT_S="5")

    def test_relays_off_refuses_the_same_pin_for_both_relays(self) -> None:              # M56
        with self.assertRaisesRegex(ConfigError, "different pins"):
            relay_outputs_from_env({"RELAY_PIN": "17", "UNLOCK_RELAY_PIN": "17", "RELAY_ACTIVE_LOW": "true"})

    def test_unknown_input_pull_is_rejected(self) -> None:                               # M58
        self.bad("INPUT_PULL", INPUT_PULL="sideways")


class HardwareKillers(unittest.TestCase):
    def test_recorded_pins_outside_2_to_27_are_ignored(self) -> None:                    # M66
        with tempfile.TemporaryDirectory() as d:
            Path(d, RELAY_RECORD).write_text(json.dumps({"pins": [0, 1, 17, 28, 40], "active_low": True}))
            self.assertEqual(recorded_relay_outputs(Path(d)), ([17], True))

    def test_inputs_are_claimed_with_the_configured_pull(self) -> None:                  # M67
        class Rec(FakeBackend):
            def __init__(self): super().__init__(); self.pulls = {}
            def claim_input(self, pin, pull): self.pulls[pin] = pull; super().claim_input(pin, pull)
        b = Rec()
        GateIO(b, RELAY, True, CLOSED, OPEN, SAFETY, True, "down", unlock_relay_pin=UNLOCK, unlock_sense_pin=BOARD_SENSE)
        self.assertEqual(b.pulls, {CLOSED: "down", OPEN: "down", SAFETY: "down", BOARD_SENSE: "down"})

    def test_relay_energised_follows_the_last_command(self) -> None:                     # M70 (property is unused by the controller)
        io = GateIO(FakeBackend(), RELAY, True, CLOSED, None, SAFETY, True, "up")
        io.relay(True); self.assertTrue(io.relay_energised)
        io.relay(False); self.assertFalse(io.relay_energised)

    def test_shutdown_switches_the_unlock_relay_off_in_each_layer(self) -> None:         # M35 / M65 (each is redundant with the other)
        b = FakeBackend()
        io = GateIO(b, RELAY, True, CLOSED, OPEN, SAFETY, True, "up", unlock_relay_pin=UNLOCK)
        io.unlock_relay(True)
        io.shutdown()                                             # GateIO alone, without PulseOutput.off
        self.assertEqual(b.levels[UNLOCK], 1)


class JournalKillers(unittest.TestCase):
    def test_only_the_newest_200_ids_are_kept(self) -> None:                             # M71
        with tempfile.TemporaryDirectory() as d:
            j = Journal(Path(d))
            for i in range(250):
                j.begin({"id": i, "command": "open", "source": "manual"}); j.finish(i, "acknowledged", "ok")
            j2 = Journal(Path(d))
            self.assertEqual(len(j2.done), 200)
            self.assertTrue(j2.seen(249))
            self.assertFalse(j2.seen(0))

    def test_state_is_fsynced_before_the_rename(self) -> None:                           # M75
        with tempfile.TemporaryDirectory() as d, mock.patch.object(journal_mod.os, "fsync") as fsync:
            Journal(Path(d)).begin({"id": 1, "command": "open", "source": "manual"})
            self.assertTrue(fsync.called)

    def test_state_and_audit_files_are_private(self) -> None:                            # M79
        with tempfile.TemporaryDirectory() as d:
            j = Journal(Path(d) / "s")
            j.begin({"id": 1, "command": "open", "source": "manual"}); j.audit("x")
            for name in ("state.json", "audit.jsonl"):
                self.assertEqual(stat.S_IMODE(os.stat(Path(d) / "s" / name).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(Path(d) / "s").st_mode), 0o700)

    def test_audit_log_rotates_and_keeps_five_files(self) -> None:                       # M80
        with tempfile.TemporaryDirectory() as d, mock.patch.object(journal_mod, "AUDIT_MAX_BYTES", 300):
            j = Journal(Path(d))
            for i in range(200):
                j.audit("event", {"n": i, "pad": "x" * 40})
            names = sorted(p.name for p in Path(d).iterdir() if p.name.startswith("audit"))
            self.assertIn("audit.jsonl.1", names)
            self.assertLessEqual(len(names), 5)


if __name__ == "__main__":
    unittest.main()
