"""Algorithm 1: pulse arbitration.

pulse_door() decides, in a FIXED fail-closed order, whether a door may be
pulsed, and if so drives exactly one bounded dry-contact pulse:

    1. unknown door            -> UNKNOWN_DOOR
    2. door disabled           -> DISABLED_DOOR
    3. lockdown inhibit set    -> LOCKDOWN_HOLD   (unless door.lockdownExempt)
    4. pulse running / re-trigger inside minRetriggerMs -> BAD_EVENT (detail audited)
    5. drive active level; read back (if a reader is fitted) -> RELAY_OPEN_FAIL
    6. a write fault           -> GPIO_FAULT      (line forced back to recover level)

Interlocks that hold whatever the caller asks for:
  * a pulse always ends by durationMs; enforce() is run by the main loop AND by
    an independent watchdog thread, so a stalled caller cannot leave a line
    asserted;
  * a pulse is only recorded as ENDED after the recover-level write succeeded;
    a failed recover write is retried on every enforce() pass and audited;
  * watchdogMs is a hard ceiling: a pulse still asserted that long after it
    started is force-recovered and audited as watchdog_forced;
  * construction and shutdown() drive every door line to the recover level;
  * the pin map comes ONLY from the Keys object (no pin literal in this file).

Return dict (all keys always present, project instructions s8):
    ok, door_id, bcm_gpio, duration_ms, inhibited, error, ts_unix
error is None or one of UNKNOWN_DOOR | DISABLED_DOOR | LOCKDOWN_HOLD | GPIO_FAULT |
MOTOR_BLOCKED | RELAY_OPEN_FAIL | HMAC_REJECT | BAD_EVENT. This module produces
the first six minus MOTOR_BLOCKED/HMAC_REJECT, which belong to the event layer.

TRUTH_GAP (re-trigger code): the s8 error list has no code for "re-trigger too
soon". It is reported as BAD_EVENT and the precise cause is in the audit record
(detail=RETRIGGER_TOO_SOON / PULSE_RUNNING). Add a code via an APPROVED schema bump.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Protocol

from .keys import Door, Keys

AuditFn = Callable[[str, Dict[str, Any]], None]
InhibitFn = Callable[[Door], bool]
TelemetryFn = Callable[[Dict[str, Any]], None]


class GpioLines(Protocol):
    """What the controller needs from the hardware layer (lgpio / gpiozero / a fake in tests)."""

    def write(self, bcm: int, level: str) -> None: ...          # "LOW" | "HIGH"; raises on fault
    def read(self, bcm: int) -> str: ...                         # optional read-back


@dataclass
class _Active:
    started: float           # monotonic seconds
    ends: float
    ended_ok: bool = False   # recover level confirmed written


def _noop_audit(event: str, fields: Dict[str, Any]) -> None:
    return None


class PulseController:
    def __init__(self, keys: Keys, gpio: GpioLines, *, audit: AuditFn = _noop_audit,
                 inhibited: Optional[InhibitFn] = None, telemetry: Optional[TelemetryFn] = None,
                 read_back: bool = False, mono: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time) -> None:
        self.keys = keys
        self._gpio = gpio
        self._audit = audit
        self._inhibited = inhibited or (lambda door: False)
        self._telemetry = telemetry or (lambda frame: None)
        self._read_back = read_back
        self._mono = mono
        self._wall = wall
        self._lock = threading.RLock()
        self._active: Dict[str, _Active] = {}
        self._last_start: Dict[str, float] = {}
        self._stop = threading.Event()
        # Start-up: every line to the recover level BEFORE anything can pulse.
        for door in keys.doors:
            gpio.write(door.bcm_gpio, keys.recover_level)

    # ------------------------------------------------------------------ API
    def pulse_door(self, door_id: str, reason: str, source: str) -> Dict[str, Any]:
        door = self.keys.door(door_id)
        if door is None:
            return self._result(None, door_id, False, False, "UNKNOWN_DOOR", reason, source)
        if not door.enabled:
            return self._result(door, door_id, False, False, "DISABLED_DOOR", reason, source)
        if self._inhibited(door):
            self._telemetry({"type": "LOCKDOWN_HOLD", "door_id": door.id, "ts_unix": self._wall()})
            return self._result(door, door_id, False, True, "LOCKDOWN_HOLD", reason, source)

        with self._lock:
            now = self._mono()
            active = self._active.get(door.id)
            if active is not None:
                self._audit("pulse_refused", {"door": door.id, "detail": "PULSE_RUNNING", "reason": reason, "source": source})
                return self._result(door, door_id, False, False, "BAD_EVENT", reason, source)
            last = self._last_start.get(door.id)
            if last is not None and (now - last) * 1000.0 < self.keys.min_retrigger_ms:
                self._audit("pulse_refused", {"door": door.id, "detail": "RETRIGGER_TOO_SOON", "reason": reason, "source": source})
                return self._result(door, door_id, False, False, "BAD_EVENT", reason, source)

            try:
                self._gpio.write(door.bcm_gpio, self.keys.active_level)
            except Exception as error:  # noqa: BLE001 - any hardware fault must end with the line recovered
                self._force_recover(door, f"write fault: {type(error).__name__}")
                self._audit("gpio_fault", {"door": door.id, "stage": "assert", "error": type(error).__name__})
                return self._result(door, door_id, False, False, "GPIO_FAULT", reason, source)

            if self._read_back:
                try:
                    level = self._gpio.read(door.bcm_gpio)
                except Exception as error:  # noqa: BLE001
                    self._force_recover(door, f"read-back fault: {type(error).__name__}")
                    self._audit("gpio_fault", {"door": door.id, "stage": "read_back", "error": type(error).__name__})
                    return self._result(door, door_id, False, False, "GPIO_FAULT", reason, source)
                if level != self.keys.active_level:
                    self._force_recover(door, "read-back mismatch")
                    self._audit("relay_open_fail", {"door": door.id, "wanted": self.keys.active_level, "read": level})
                    self._telemetry({"type": "RELAY_OPEN_FAIL", "door_id": door.id, "ts_unix": self._wall()})
                    return self._result(door, door_id, False, False, "RELAY_OPEN_FAIL", reason, source)

            self._active[door.id] = _Active(started=now, ends=now + self.keys.pulse_duration_ms / 1000.0)
            self._last_start[door.id] = now
            self._audit("pulse_start", {"door": door.id, "bcm": door.bcm_gpio, "ms": self.keys.pulse_duration_ms,
                                        "reason": reason, "source": source})
            self._telemetry({"type": "PULSE", "door_id": door.id, "ts_unix": self._wall()})
            return self._result(door, door_id, True, False, None, reason, source)

    def enforce(self, now: Optional[float] = None) -> None:
        """End due pulses, retry failed recoveries, apply the watchdog ceiling. Safe to call from any thread."""
        now = self._mono() if now is None else now
        with self._lock:
            for door_id, active in list(self._active.items()):
                door = self.keys.door(door_id)
                overdue_watchdog = (now - active.started) * 1000.0 > self.keys.watchdog_ms
                if now < active.ends and not overdue_watchdog:
                    continue
                try:
                    self._gpio.write(door.bcm_gpio, self.keys.recover_level)
                except Exception as error:  # noqa: BLE001 - keep the entry; retried next pass
                    self._audit("recover_failed", {"door": door_id, "error": type(error).__name__})
                    continue
                del self._active[door_id]
                self._audit("watchdog_forced" if overdue_watchdog else "pulse_end", {"door": door_id})

    def active_doors(self) -> list:
        with self._lock:
            return sorted(self._active)

    def shutdown(self) -> None:
        """Stop the watchdog thread and drive every line to the recover level (best effort on each line)."""
        self._stop.set()
        with self._lock:
            for door in self.keys.doors:
                try:
                    self._gpio.write(door.bcm_gpio, self.keys.recover_level)
                except Exception as error:  # noqa: BLE001
                    self._audit("shutdown_recover_failed", {"door": door.id, "error": type(error).__name__})
            self._active.clear()
            self._audit("shutdown", {})

    def start_watchdog(self, interval_s: float = 0.05) -> threading.Thread:
        """Independent thread that calls enforce() so a stalled caller cannot hold a line asserted."""
        def run() -> None:
            while not self._stop.wait(interval_s):
                try:
                    self.enforce()
                except Exception:  # noqa: BLE001 - the watchdog must never die with a line asserted
                    for door in self.keys.doors:
                        try:
                            self._gpio.write(door.bcm_gpio, self.keys.recover_level)
                        except Exception:  # noqa: BLE001
                            pass

        thread = threading.Thread(target=run, name="pulse-watchdog", daemon=True)
        thread.start()
        return thread

    # ------------------------------------------------------------- internals
    def _force_recover(self, door: Door, why: str) -> None:
        try:
            self._gpio.write(door.bcm_gpio, self.keys.recover_level)
        except Exception as error:  # noqa: BLE001
            self._audit("recover_failed", {"door": door.id, "why": why, "error": type(error).__name__})
            # Track it so enforce() keeps retrying the recover write.
            now = self._mono()
            self._active[door.id] = _Active(started=now, ends=now)

    def _result(self, door: Optional[Door], door_id: str, ok: bool, inhibited: bool, error: Optional[str],
                reason: str, source: str) -> Dict[str, Any]:
        if error is not None and error != "BAD_EVENT":
            self._audit("pulse_refused" if error != "GPIO_FAULT" else "pulse_failed",
                        {"door": door_id, "error": error, "reason": reason, "source": source})
        return {
            "ok": ok,
            "door_id": door_id,
            "bcm_gpio": door.bcm_gpio if door is not None else None,
            "duration_ms": self.keys.pulse_duration_ms if ok else 0,
            "inhibited": inhibited,
            "error": error,
            "ts_unix": self._wall(),
        }
