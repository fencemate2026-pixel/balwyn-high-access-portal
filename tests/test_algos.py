"""Tests for the five Magic Keys algorithms. Run: python -m unittest discover -s tests -v  (from .grok/staging-preview)

All hardware is a fake. Nothing here reads or writes a real GPIO line, so a pass says the LOGIC is right,
not that any wiring works (that needs the bench; see the TRUTH_GAP list in the report)."""

import copy
import hashlib
import hmac
import json
import math
import os
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from magic_keys_algos import (ClockSkew, EventDispatcher, KeysError, LockdownMachine, NoiseMatrix, PulseController,
                              ScheduleReleaser, board_compatibility, cross_gate_clashes, load_keys, parse_keys,
                              resolve_local, sample, verify_hmac)

TEMPLATE = Path(__file__).resolve().parents[1] / "config" / "magic-keys.json"


def template():
    return json.loads(TEMPLATE.read_text(encoding="utf-8"))


class FakeGpio:
    def __init__(self):
        self.levels = {}
        self.log = []
        self.fail_write = set()      # (bcm, level) combinations that raise
        self.read_override = {}

    def write(self, bcm, level):
        if (bcm, level) in self.fail_write:
            raise OSError("simulated line fault")
        self.levels[bcm] = level
        self.log.append((bcm, level))

    def read(self, bcm):
        return self.read_override.get(bcm, self.levels.get(bcm))


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


class KeysTests(unittest.TestCase):
    def test_template_loads(self):
        keys = load_keys(TEMPLATE)
        self.assertEqual([d.bcm_gpio for d in keys.doors], [22, 23, 24, 25])
        self.assertEqual(keys.pulse_duration_ms, 1500)
        self.assertIsNone(keys.doors[0].label)

    def test_missing_file(self):
        with self.assertRaises(KeysError):
            load_keys("/nonexistent/magic-keys.json")

    def test_every_problem_reported_together(self):
        data = template()
        data["pulse"]["durationMs"] = 1000
        data["doors"][1]["bcmGpio"] = 22
        data["doors"][2]["bcmGpio"] = 14
        with self.assertRaises(KeysError) as caught:
            parse_keys(data)
        text = str(caught.exception)
        self.assertIn("durationMs", text)
        self.assertIn("used by another door", text)
        self.assertIn("forbiddenPins", text)

    def test_raw_secret_field_refused(self):
        data = template()
        data["webhooks"]["auth"]["secret"] = "x"
        with self.assertRaises(KeysError) as caught:
            parse_keys(data)
        self.assertIn("raw secret field forbidden", str(caught.exception))

    def test_env_names_and_colour_tokens_are_not_secret_fields(self):
        parse_keys(template())   # houseColourToken / compassHmacEnv must NOT trip the scan

    def test_wrong_door_count_and_unknown_colour(self):
        data = template()
        data["doors"].pop()
        with self.assertRaises(KeysError):
            parse_keys(data)
        data = template()
        data["doors"][0]["houseColourToken"] = "nope"
        with self.assertRaises(KeysError):
            parse_keys(data)

    def test_env_name_must_be_a_name(self):
        data = template()
        data["webhooks"]["auth"]["compassHmacEnv"] = "abc123-secret-value"
        with self.assertRaises(KeysError):
            parse_keys(data)

    def test_board_compatibility_flags_unwired_pins(self):
        keys = load_keys(TEMPLATE)
        # FROM SOURCE: gate-controller/config.py RELAY_BOARDS["keyestudio-ks0212"]["pins"] == (4, 22, 6, 26)
        problems = board_compatibility(keys, (4, 22, 6, 26), "keyestudio-ks0212")
        self.assertEqual([p.split(":")[0] for p in problems], ["S2", "S3", "S4"])
        self.assertEqual(board_compatibility(keys, (22, 23, 24, 25)), [])

    def test_cross_gate_clash(self):
        keys = load_keys(TEMPLATE)
        problems = cross_gate_clashes({"TF-ENTRY": [22, 5]}, keys)
        self.assertEqual(len(problems), 1)
        self.assertIn("S1", problems[0])


class PulseTests(unittest.TestCase):
    def setUp(self):
        self.keys = load_keys(TEMPLATE)
        self.gpio = FakeGpio()
        self.mono = Clock(100.0)
        self.audit = []
        self.lock_state = {"on": False}
        self.pc = PulseController(self.keys, self.gpio, audit=lambda e, f: self.audit.append((e, f)),
                                  inhibited=lambda door: self.lock_state["on"] and not door.lockdown_exempt,
                                  mono=self.mono, wall=lambda: 1_700_000_000.0)

    def test_startup_drives_all_lines_recovered(self):
        self.assertEqual({v for v in self.gpio.levels.values()}, {"HIGH"})
        self.assertEqual(sorted(self.gpio.levels), [22, 23, 24, 25])

    def test_pulse_is_1500ms_low_then_high(self):
        result = self.pc.pulse_door("S1", "bell", "compass")
        self.assertEqual(set(result), {"ok", "door_id", "bcm_gpio", "duration_ms", "inhibited", "error", "ts_unix"})
        self.assertTrue(result["ok"])
        self.assertEqual((result["bcm_gpio"], result["duration_ms"], result["error"]), (22, 1500, None))
        self.assertEqual(self.gpio.levels[22], "LOW")
        self.mono.t += 1.499
        self.pc.enforce()
        self.assertEqual(self.gpio.levels[22], "LOW")
        self.mono.t += 0.002
        self.pc.enforce()
        self.assertEqual(self.gpio.levels[22], "HIGH")

    def test_error_codes(self):
        self.assertEqual(self.pc.pulse_door("S9", "x", "t")["error"], "UNKNOWN_DOOR")
        data = template()
        data["doors"][3]["enabled"] = False
        pc = PulseController(parse_keys(data), FakeGpio(), mono=self.mono)
        self.assertEqual(pc.pulse_door("S4", "x", "t")["error"], "DISABLED_DOOR")

    def test_lockdown_hold_and_exempt(self):
        data = template()
        data["doors"][1]["lockdownExempt"] = True
        pc = PulseController(parse_keys(data), FakeGpio(), inhibited=lambda d: not d.lockdown_exempt, mono=self.mono)
        refused = pc.pulse_door("S1", "x", "t")
        self.assertEqual((refused["ok"], refused["inhibited"], refused["error"]), (False, True, "LOCKDOWN_HOLD"))
        self.assertTrue(pc.pulse_door("S2", "x", "t")["ok"])

    def test_no_second_pulse_while_running_or_inside_retrigger_window(self):
        self.assertTrue(self.pc.pulse_door("S1", "a", "t")["ok"])
        self.assertEqual(self.pc.pulse_door("S1", "b", "t")["error"], "BAD_EVENT")        # running
        self.mono.t += 1.6
        self.pc.enforce()
        self.assertEqual(self.pc.pulse_door("S1", "c", "t")["error"], "BAD_EVENT")        # 1.6 s < 2.0 s
        self.assertEqual([f["detail"] for e, f in self.audit if e == "pulse_refused" and "detail" in f],
                         ["PULSE_RUNNING", "RETRIGGER_TOO_SOON"])
        self.mono.t += 0.5
        self.assertTrue(self.pc.pulse_door("S1", "d", "t")["ok"])                          # 2.1 s

    def test_other_doors_are_independent(self):
        self.assertTrue(self.pc.pulse_door("S1", "a", "t")["ok"])
        self.assertTrue(self.pc.pulse_door("S2", "a", "t")["ok"])
        self.assertEqual(self.pc.active_doors(), ["S1", "S2"])

    def test_assert_fault_forces_recover_and_reports_gpio_fault(self):
        self.gpio.fail_write.add((23, "LOW"))
        result = self.pc.pulse_door("S2", "x", "t")
        self.assertEqual((result["ok"], result["error"]), (False, "GPIO_FAULT"))
        self.assertEqual(self.gpio.levels[23], "HIGH")
        self.assertEqual(self.pc.active_doors(), [])

    def test_readback_mismatch_is_relay_open_fail(self):
        pc = PulseController(self.keys, self.gpio, read_back=True, mono=self.mono)
        self.gpio.read_override[24] = "HIGH"      # line did not move
        result = pc.pulse_door("S3", "x", "t")
        self.assertEqual(result["error"], "RELAY_OPEN_FAIL")
        self.assertEqual(self.gpio.levels[24], "HIGH")

    def test_failed_recover_is_retried_and_blocks_new_pulses(self):
        self.assertTrue(self.pc.pulse_door("S1", "a", "t")["ok"])
        self.gpio.fail_write.add((22, "HIGH"))
        self.mono.t += 1.6
        self.pc.enforce()
        self.assertEqual(self.pc.active_doors(), ["S1"])          # NOT recorded as ended
        self.assertEqual(self.gpio.levels[22], "LOW")
        self.gpio.fail_write.clear()
        self.mono.t += 0.1
        self.pc.enforce()
        self.assertEqual(self.pc.active_doors(), [])
        self.assertEqual(self.gpio.levels[22], "HIGH")

    def test_watchdog_ceiling_is_audited(self):
        self.assertTrue(self.pc.pulse_door("S1", "a", "t")["ok"])
        self.gpio.fail_write.add((22, "HIGH"))
        self.mono.t += 9.0                                          # past watchdogMs (8 s)
        self.pc.enforce()
        self.gpio.fail_write.clear()
        self.pc.enforce()
        self.assertIn("watchdog_forced", [e for e, _ in self.audit])
        self.assertEqual(self.gpio.levels[22], "HIGH")

    def test_watchdog_thread_ends_pulse_without_the_caller(self):
        real = PulseController(self.keys, self.gpio)               # real clocks
        thread = real.start_watchdog(0.01)
        self.assertTrue(real.pulse_door("S1", "a", "t")["ok"])
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and self.gpio.levels[22] != "HIGH":
            time.sleep(0.02)
        real.shutdown()
        thread.join(1.0)
        self.assertEqual(self.gpio.levels[22], "HIGH")

    def test_shutdown_recovers_everything(self):
        self.pc.pulse_door("S1", "a", "t")
        self.pc.pulse_door("S2", "a", "t")
        self.pc.shutdown()
        self.assertEqual({self.gpio.levels[p] for p in (22, 23, 24, 25)}, {"HIGH"})

    def test_pins_come_only_from_keys(self):
        data = template()
        for door, pin in zip(data["doors"], (4, 6, 26, 5)):
            door["bcmGpio"] = pin
        data["gpio"]["allowedPins"] = [4, 6, 26, 5]
        gpio = FakeGpio()
        pc = PulseController(parse_keys(data), gpio, mono=self.mono)
        self.assertEqual(pc.pulse_door("S1", "x", "t")["bcm_gpio"], 4)
        self.assertEqual(gpio.levels[4], "LOW")


class LockdownTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "lockdown.json"
        self.now = Clock(10_000.0)
        self.keys = load_keys(TEMPLATE)
        self.door = self.keys.doors[0]

    def tearDown(self):
        self.dir.cleanup()

    def machine(self, **kw):
        kw.setdefault("enabled", True)
        return LockdownMachine(self.path, wall=self.now, **kw)

    def test_enabled_is_required(self):
        with self.assertRaises(TypeError):
            LockdownMachine(self.path, enabled=None)

    def test_disabled_ignores_everything(self):
        m = self.machine(enabled=False)
        result = m.apply("LOCKDOWN", "e1", 9_999.0)
        self.assertEqual((result["applied"], result["reason"], m.inhibited(self.door)), (False, "LOCKDOWN_DISABLED", False))

    def test_lockdown_then_clear(self):
        m = self.machine()
        self.assertTrue(m.apply("LOCKDOWN", "e1", 9_990.0)["applied"])
        self.assertTrue(m.inhibited(self.door))
        self.assertTrue(m.apply("ALL_CLEAR", "e2", 9_995.0)["applied"])
        self.assertFalse(m.inhibited(self.door))

    def test_exempt_door_never_inhibited(self):
        m = self.machine()
        m.apply("LOCKDOWN", "e1", 9_990.0)
        data = template()
        data["doors"][0]["lockdownExempt"] = True
        self.assertFalse(m.inhibited(parse_keys(data).doors[0]))

    def test_duplicate_stale_future_and_bad(self):
        m = self.machine()
        m.apply("LOCKDOWN", "e1", 9_990.0)
        self.assertEqual(m.apply("LOCKDOWN", "e1", 9_990.0)["reason"], "DUPLICATE")
        self.assertEqual(m.apply("ALL_CLEAR", "old", 9_980.0)["reason"], "STALE")      # late clear must not win
        self.assertEqual(m.state, "LOCKDOWN")
        self.assertEqual(m.apply("ALL_CLEAR", "far", 10_000.0 + 3600)["reason"], "FUTURE_TIMESTAMP")
        self.assertEqual(m.apply("EXPLODE", "x", 9_999.0)["reason"], "BAD_EVENT")
        self.assertEqual(m.apply("LOCKDOWN", "", 9_999.0)["reason"], "BAD_EVENT")

    def test_equal_timestamp_lockdown_beats_all_clear(self):
        m = self.machine()
        m.apply("ALL_CLEAR", "a", 9_990.0)
        self.assertTrue(m.apply("LOCKDOWN", "b", 9_990.0)["applied"])
        self.assertEqual(m.state, "LOCKDOWN")
        self.assertEqual(m.apply("ALL_CLEAR", "c", 9_990.0)["reason"], "STALE")

    def test_survives_restart(self):
        self.machine().apply("LOCKDOWN", "e1", 9_990.0)
        again = self.machine()
        self.assertEqual(again.state, "LOCKDOWN")
        self.assertEqual(again.apply("LOCKDOWN", "e1", 9_990.0)["reason"], "DUPLICATE")

    def test_unreadable_state_policy(self):
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.machine().state, "LOCKDOWN")                               # default: inhibit
        self.assertEqual(self.machine(on_unreadable="normal").state, "NORMAL")
        self.assertEqual(self.machine(enabled=False).state, "NORMAL")

    def test_never_self_releases_but_raises_alarm(self):
        m = self.machine(alarm_after_s=3600)
        m.apply("LOCKDOWN", "e1", 9_990.0)
        self.assertFalse(m.stale_alarm())
        self.now.t += 7200
        self.assertTrue(m.stale_alarm())
        self.assertEqual(m.state, "LOCKDOWN")

    def test_atomic_write_leaves_no_temp_file(self):
        self.machine().apply("LOCKDOWN", "e1", 9_990.0)
        self.assertEqual(sorted(p.name for p in Path(self.dir.name).iterdir()), ["lockdown.json"])


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.keys = load_keys(TEMPLATE)

    def utc(self, *args):
        return datetime(*args, tzinfo=timezone.utc).timestamp()

    def test_resolve_normal_time(self):
        # 2026-11-02 09:00 Melbourne is AEDT (+11) = 2026-11-01 22:00 UTC
        self.assertEqual(resolve_local("Australia/Melbourne", "2026-11-02T09:00:00"), self.utc(2026, 11, 1, 22, 0))

    def test_dst_gap_moves_forward(self):
        # 2026-10-04 02:30 does not exist (clocks jump 02:00 -> 03:00). Result is 03:30 AEDT = 16:30 UTC the day before.
        self.assertEqual(resolve_local("Australia/Melbourne", "2026-10-04T02:30:00"), self.utc(2026, 10, 3, 16, 30))

    def test_dst_fold_uses_first_occurrence(self):
        # 2027-04-04 02:30 happens twice; first is AEDT (+11) = 15:30 UTC the day before.
        self.assertEqual(resolve_local("Australia/Melbourne", "2027-04-04T02:30:00"), self.utc(2027, 4, 3, 15, 30))

    def test_rejections_carry_reasons(self):
        s = ScheduleReleaser(self.keys, wall=Clock(0))
        self.assertEqual(s.add("a", "LOCKDOWN", "S1", "2026-11-02T09:00"), (False, "BAD_EVENT"))
        self.assertEqual(s.add("b", "SCHEDULE_RELEASE", "S9", "2026-11-02T09:00"), (False, "UNKNOWN_DOOR"))
        self.assertEqual(s.add("c", "SCHEDULE_RELEASE", "S1", "yesterday"), (False, "BAD_TIME"))
        self.assertEqual(s.add("d", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00"), (True, "QUEUED"))
        self.assertEqual(s.add("d", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00"), (False, "DUPLICATE"))

    def test_fires_once_and_only_when_due(self):
        at = resolve_local("Australia/Melbourne", "2026-11-02T09:00:00")
        clock = Clock(at - 5)
        s = ScheduleReleaser(self.keys, wall=clock)
        s.add("a", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00:00")
        self.assertEqual(s.due()["fire"], [])
        clock.t = at + 1
        self.assertEqual([e["event_id"] for e in s.due()["fire"]], ["a"])
        self.assertEqual(s.due()["fire"], [])
        self.assertEqual(s.add("a", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00:00"), (False, "DUPLICATE"))

    def test_late_events_are_missed_not_fired(self):
        at = resolve_local("Australia/Melbourne", "2026-11-02T09:00:00")
        s = ScheduleReleaser(self.keys, wall=Clock(at + 600), late_tolerance_s=30)
        s.add("a", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00:00")
        out = s.due()
        self.assertEqual(([e["event_id"] for e in out["missed"]], out["fire"]), (["a"], []))

    def test_close_releases_for_one_door_coalesce(self):
        at = resolve_local("Australia/Melbourne", "2026-11-02T09:00:00")
        s = ScheduleReleaser(self.keys, wall=Clock(at + 2))
        s.add("a", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00:00")
        s.add("b", "VISITOR_RELEASE", "S1", "2026-11-02T09:00:01")
        s.add("c", "VISITOR_RELEASE", "S2", "2026-11-02T09:00:01")
        out = s.due()
        self.assertEqual(sorted(e["event_id"] for e in out["fire"]), ["a", "c"])
        self.assertEqual([e["event_id"] for e in out["coalesced"]], ["b"])

    def test_clock_skew_median_and_trust(self):
        skew = ClockSkew(samples=5, max_skew_s=120)
        for server in (1010, 1010, 1010, 1500, 1010):                 # one wild outlier
            skew.observe(server_ts=server, local_sent=1000, local_received=1000)
        self.assertEqual(skew.offset(), 10)
        self.assertEqual(skew.applied_offset(), 10)
        bad = ClockSkew(max_skew_s=120)
        bad.observe(5000, 1000, 1000)
        self.assertFalse(bad.trustworthy())
        self.assertEqual(bad.applied_offset(), 0.0)
        bad.observe(900, 1000, 999)                                   # clock went backwards: sample ignored
        self.assertEqual(len(bad._offsets), 1)

    def test_skew_shifts_release_clock(self):
        at = resolve_local("Australia/Melbourne", "2026-11-02T09:00:00")
        skew = ClockSkew()
        skew.observe(server_ts=at + 20, local_sent=at, local_received=at)   # local clock is 20 s slow
        s = ScheduleReleaser(self.keys, wall=Clock(at - 5), skew=skew)      # local says 5 s early; server says 15 s past
        s.add("a", "SCHEDULE_RELEASE", "S1", "2026-11-02T09:00:00")
        self.assertEqual([e["event_id"] for e in s.due()["fire"]], ["a"])


class NoiseTests(unittest.TestCase):
    def setUp(self):
        self.keys = load_keys(TEMPLATE)
        self.t = Clock(0.0)
        self.m = NoiseMatrix(self.keys, hold_s=5, decay_s=3, mono=self.t, wall=lambda: 42.0)

    def test_matrix_values_come_from_keys(self):
        self.assertTrue(self.m.report("MOTOR_BLOCKED", "S1"))
        (frame,) = self.m.frames()
        self.assertEqual((frame["bind"], frame["amplitude"], frame["frequency_hz"], frame["door_id"]),
                         ("door.obstruction", 0.08, 18.0, "S1"))

    def test_unknown_code_invents_nothing(self):
        self.assertFalse(self.m.report("MADE_UP", "S1"))
        self.assertEqual(self.m.frames(), [])

    def test_hold_then_decay_then_drop(self):
        self.m.report("MOTOR_BLOCKED", "S1")
        self.t.t = 5.0
        self.assertEqual(self.m.frames()[0]["amplitude"], 0.08)
        self.t.t = 8.0                                               # one time constant after hold
        self.assertAlmostEqual(self.m.frames()[0]["amplitude"], 0.08 * math.exp(-1), places=5)
        self.t.t = 5.0 + 3.0 * math.log(100) + 1                     # below the 1 % cutoff
        self.assertEqual(self.m.frames(), [])

    def test_refresh_does_not_stack(self):
        self.m.report("MOTOR_BLOCKED", "S1")
        self.m.report("MOTOR_BLOCKED", "S1")
        self.assertEqual(self.m.frames()[0]["amplitude"], 0.08)

    def test_same_bind_combines_rss_and_weighted_frequency(self):
        data = template()
        data["errorMatrix"]["RELAY_OPEN_FAIL"]["canvasBind"] = "door.obstruction"
        m = NoiseMatrix(parse_keys(data), mono=self.t, wall=lambda: 1.0)
        m.report("MOTOR_BLOCKED", "S1")
        m.report("RELAY_OPEN_FAIL", "S1")
        (frame,) = m.frames()
        self.assertAlmostEqual(frame["amplitude"], math.sqrt(0.08 ** 2 + 0.12 ** 2), places=5)
        self.assertAlmostEqual(frame["frequency_hz"], (0.08 * 18 + 0.12 * 22) / 0.20, places=5)
        self.assertEqual(frame["codes"], ["MOTOR_BLOCKED", "RELAY_OPEN_FAIL"])

    def test_different_doors_are_separate_frames_and_amplitude_is_clamped(self):
        data = template()
        data["errorMatrix"]["MOTOR_BLOCKED"]["noiseAmplitude"] = 1.0
        data["errorMatrix"]["RELAY_OPEN_FAIL"]["noiseAmplitude"] = 1.0
        data["errorMatrix"]["RELAY_OPEN_FAIL"]["canvasBind"] = "door.obstruction"
        m = NoiseMatrix(parse_keys(data), mono=self.t, wall=lambda: 1.0)
        m.report("MOTOR_BLOCKED", "S1")
        m.report("RELAY_OPEN_FAIL", "S1")
        m.report("MOTOR_BLOCKED", "S2")
        frames = m.frames()
        self.assertEqual([f["door_id"] for f in frames], ["S1", "S2"])
        self.assertEqual(frames[0]["amplitude"], 1.0)

    def test_sample_waveform(self):
        frame = {"amplitude": 0.5, "frequency_hz": 1.0}
        self.assertAlmostEqual(sample(frame, 0.25), 0.5)
        self.assertAlmostEqual(sample(frame, 0.0), 0.0)


class DispatchTests(unittest.TestCase):
    SECRET = "test-secret-not-real"

    def setUp(self):
        self.keys = load_keys(TEMPLATE)
        self.dir = tempfile.TemporaryDirectory()
        self.gpio = FakeGpio()
        self.now = Clock(10_000.0)
        self.lock = LockdownMachine(Path(self.dir.name) / "l.json", enabled=True, wall=self.now)
        self.noise = NoiseMatrix(self.keys, mono=self.now)
        self.pulse = PulseController(self.keys, self.gpio, inhibited=self.lock.inhibited, mono=self.now)
        self.env = {"COMPASS_HMAC_SECRET": self.SECRET, "GUARDIAN_HMAC_SECRET": ""}
        self.d = EventDispatcher(self.keys, self.pulse, self.lock, self.noise, env=self.env)

    def tearDown(self):
        self.dir.cleanup()

    def sign(self, body, secret=None):
        return hmac.new((secret or self.SECRET).encode(), body, hashlib.sha256).hexdigest()

    def send(self, event_type, door="S1", event_id="e1", ts=9_990.0, source="compass", body=b"{}", sig=None):
        return self.d.handle(source, event_type, door, event_id, ts, body, self.sign(body) if sig is None else sig)

    def test_verify_hmac(self):
        sig = self.sign(b"abc")
        self.assertTrue(verify_hmac(self.SECRET.encode(), b"abc", sig))
        self.assertTrue(verify_hmac(self.SECRET.encode(), b"abc", "sha256=" + sig.upper()))
        self.assertFalse(verify_hmac(self.SECRET.encode(), b"abd", sig))
        self.assertFalse(verify_hmac(b"", b"abc", sig))
        self.assertFalse(verify_hmac(self.SECRET.encode(), b"abc", ""))

    def test_good_signature_pulses(self):
        out = self.send("SCHEDULE_RELEASE")
        self.assertTrue(out["ok"])
        self.assertEqual(self.gpio.levels[22], "LOW")

    def test_bad_signature_never_reaches_gpio_and_reports_noise(self):
        out = self.send("SCHEDULE_RELEASE", sig="00" * 32)
        self.assertEqual((out["ok"], out["error"]), (False, "HMAC_REJECT"))
        self.assertEqual(self.gpio.levels[22], "HIGH")
        self.assertEqual(self.noise.frames()[0]["bind"], "webhook.auth")

    def test_empty_or_missing_secret_rejects(self):
        self.assertEqual(self.send("SCHEDULE_RELEASE", source="guardian")["error"], "HMAC_REJECT")   # env var empty
        self.assertEqual(self.send("SCHEDULE_RELEASE", source="nobody")["error"], "HMAC_REJECT")     # no such source

    def test_event_and_door_validation(self):
        self.assertEqual(self.send("EXPLODE")["error"], "BAD_EVENT")
        self.assertEqual(self.send("SCHEDULE_RELEASE", door=None)["error"], "BAD_EVENT")
        self.assertEqual(self.send("SCHEDULE_RELEASE", door="S9")["error"], "UNKNOWN_DOOR")

    def test_lockdown_blocks_then_all_clear_releases(self):
        self.assertTrue(self.send("LOCKDOWN", door=None, event_id="L1", ts=9_990.0)["ok"])
        blocked = self.send("VISITOR_RELEASE", event_id="v1")
        self.assertEqual((blocked["ok"], blocked["error"]), (False, "LOCKDOWN_HOLD"))
        self.assertTrue(self.send("ALL_CLEAR", door=None, event_id="C1", ts=9_995.0)["ok"])
        self.assertTrue(self.send("VISITOR_RELEASE", event_id="v2")["ok"])

    def test_lockdown_retry_is_ok_but_stale_clear_is_not(self):
        self.send("LOCKDOWN", door=None, event_id="L1", ts=9_990.0)
        self.assertTrue(self.send("LOCKDOWN", door=None, event_id="L1", ts=9_990.0)["ok"])        # webhook retry
        self.assertFalse(self.send("ALL_CLEAR", door=None, event_id="C0", ts=9_000.0)["ok"])      # stale

    def test_motor_blocked_drives_noise_not_gpio(self):
        out = self.send("MOTOR_BLOCKED", door="S2")
        self.assertTrue(out["ok"])
        self.assertEqual(self.noise.frames()[0]["door_id"], "S2")
        self.assertEqual(self.gpio.levels[23], "HIGH")


if __name__ == "__main__":
    unittest.main(verbosity=2)
