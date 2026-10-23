"""The single relay contact, supervised.

States:
  idle      relay off
  pulsing   relay on for a bounded time -> operator runs one open/auto-close cycle
  holding   relay on until released     -> operator holds the gate open

Interlocks enforced here, whatever the caller asks for:
  * a pulse always ends by its deadline (and never exceeds MAX_PULSE_S);
  * a pulse is refused while a hold is active (a pulse ending would drop the
    hold and close the gate mid-window: the defect fixed on 19 Sep);
  * a hold started during a pulse survives the pulse ending;
  * a SCHEDULE hold ends after hold_max_s, and after network_loss_release_s
    without portal contact;
  * an EMERGENCY (fire) hold is never ended by a timer or a network loss:
    only an explicit release, or the process stopping, ends it;
  * if the main loop stops feeding the watchdog for loop_stall_s, pulses and
    schedule holds are dropped. Emergency holds are kept.
  * process exit and start-up always leave the relay OFF (see GateIO).

enforce(now) is called by both the main loop and an independent watchdog
thread, so a stalled loop cannot leave the relay on past its deadline.

PulseOutput (added 11 Oct 2026) supervises the optional access-board unlock
relay the same way: it can only give one bounded press at a time, it starts
and ends OFF, and its deadline is enforced from the same watchdog thread
(RelaySupervisor.add_companion), so a stalled loop cannot hold the exit-button
input on.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from .config import MAX_PULSE_S, MAX_UNLOCK_PULSE_S


@dataclass
class RelayState:
    mode: str = "idle"          # idle | pulsing | holding
    hold_kind: str = ""          # "" | schedule | emergency | manual
    pulse_until: float = 0.0
    hold_since: float = 0.0
    released_reason: str = ""


class RelaySupervisor:
    def __init__(self, set_relay: Callable[[bool], None], hold_max_s: float, network_loss_release_s: float,
                 loop_stall_s: float, audit: Callable[[str, dict], None], clock: Callable[[], float] = time.monotonic) -> None:
        self._set = set_relay
        self._hold_max = hold_max_s
        self._net_loss = network_loss_release_s
        self._stall = loop_stall_s
        self._audit = audit
        self._clock = clock
        self._lock = threading.RLock()
        self.state = RelayState()
        now = clock()
        self._last_feed = now
        self._last_portal_ok = now
        self._companions: list = []  # other outputs whose deadlines the watchdog must also enforce
        self._set(False)

    def add_companion(self, enforce: Callable[[float], None]) -> None:
        """Have enforce(now) (main loop and watchdog) also enforce another output's deadline."""
        self._companions.append(enforce)

    # ---------------------------------------------------------------- requests
    def pulse(self, seconds: float) -> bool:
        with self._lock:
            if self.state.mode == "holding":
                self._audit("relay_pulse_refused", {"reason": "hold active"})
                return False
            seconds = min(max(seconds, 0.3), MAX_PULSE_S)
            now = self._clock()
            self._energise()
            self.state = RelayState(mode="pulsing", pulse_until=now + seconds)
            self._audit("relay_pulse", {"seconds": round(seconds, 2)})
            return True

    def hold(self, kind: str) -> None:
        with self._lock:
            now = self._clock()
            if self.state.mode == "holding":
                # Upgrade only: an emergency hold is never downgraded to a schedule hold.
                if self.state.hold_kind != "emergency":
                    self.state.hold_kind = kind
                return
            self._energise()
            self.state = RelayState(mode="holding", hold_kind=kind, hold_since=now)
            self._audit("relay_hold", {"kind": kind})

    def _energise(self) -> None:
        """Switch the relay on BEFORE recording it as on (audit 24 Oct 2026, controller F2). If the GPIO write fails
        the state stays idle, so it never claims a hold the contact is not making, and the next request (a repeated
        fire OPEN, for example) tries the write again instead of returning early as "already holding"."""
        try:
            self._set(True)
        except Exception:
            self._audit("relay_write_failed", {})
            try:
                self._set(False)
            except Exception:  # noqa: BLE001 - the original error is the one to report
                pass
            raise

    def release(self, reason: str) -> bool:
        """End a hold or pulse. Returns True if the relay was on."""
        with self._lock:
            was_on = self.state.mode != "idle"
            if was_on:
                self._set(False)
                self._audit("relay_release", {"reason": reason, "was": self.state.mode, "kind": self.state.hold_kind})
            self.state = RelayState(released_reason=reason if was_on else self.state.released_reason)
            return was_on

    # ------------------------------------------------------------- liveness
    def feed(self) -> None:
        self._last_feed = self._clock()

    def portal_ok(self) -> None:
        self._last_portal_ok = self._clock()

    # ------------------------------------------------------------ enforcement
    def enforce(self, now: Optional[float] = None) -> None:
        now = self._clock() if now is None else now
        for companion in self._companions:
            try:
                companion(now)
            except Exception:
                # The companion has already forced its own output off (see PulseOutput.enforce).
                # Never let it disturb this relay: a fire hold must survive a fault elsewhere.
                self._audit("companion_enforce_failed", {})
        with self._lock:
            s = self.state
            if s.mode == "pulsing" and now >= s.pulse_until:
                self.release("pulse complete")
                return
            stalled = now - self._last_feed > self._stall
            if stalled and (s.mode == "pulsing" or (s.mode == "holding" and s.hold_kind != "emergency")):
                self.release("controller loop stalled")
                return
            if s.mode == "holding" and s.hold_kind != "emergency":
                if now - s.hold_since > self._hold_max:
                    self.release("hold exceeded maximum duration")
                elif now - self._last_portal_ok > self._net_loss:
                    self.release("portal unreachable too long")

    def start_watchdog(self, interval: float = 0.1) -> threading.Thread:
        stop = threading.Event()

        def run() -> None:
            while not stop.wait(interval):
                try:
                    self.enforce()
                except Exception:  # the watchdog must never die holding the relay on
                    self._set(False)

        thread = threading.Thread(target=run, name="relay-watchdog", daemon=True)
        thread.stop = stop  # type: ignore[attr-defined]
        thread.start()
        return thread


class PulseOutput:
    """A relay that only ever gives short, bounded presses.

    Used for the access board's exit-button input: the board, not this
    program, decides how long the door stays unlocked, so a press never needs
    to be longer than MAX_UNLOCK_PULSE_S and is never held.
    """

    def __init__(self, set_output: Callable[[bool], None], audit: Callable[[str, dict], None],
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._set = set_output
        self._audit = audit
        self._clock = clock
        self._lock = threading.RLock()
        self.until = 0.0
        self.active = False
        self._set(False)

    def pulse(self, seconds: float) -> bool:
        """Start one press. Refused (False) while a press is already running."""
        with self._lock:
            if self.active:
                self._audit("unlock_pulse_refused", {"reason": "press already running"})
                return False
            seconds = min(max(seconds, 0.3), MAX_UNLOCK_PULSE_S)
            self.until = self._clock() + seconds
            self.active = True
            self._set(True)
            self._audit("unlock_pulse", {"seconds": round(seconds, 2)})
            return True

    def off(self, reason: str) -> None:
        with self._lock:
            was_on = self.active
            self.active = False
            self._set(False)  # always written, so a doubtful state is driven OFF
            if was_on:
                self._audit("unlock_release", {"reason": reason})

    def enforce(self, now: Optional[float] = None) -> None:
        now = self._clock() if now is None else now
        try:
            with self._lock:
                if self.active and now >= self.until:
                    self.off("press complete")
        except Exception:  # never leave the exit-button input pressed because of an error
            self.active = False
            self._set(False)
            raise
