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
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from .config import MAX_PULSE_S


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
        self._set(False)

    # ---------------------------------------------------------------- requests
    def pulse(self, seconds: float) -> bool:
        with self._lock:
            if self.state.mode == "holding":
                self._audit("relay_pulse_refused", {"reason": "hold active"})
                return False
            seconds = min(max(seconds, 0.3), MAX_PULSE_S)
            now = self._clock()
            self.state = RelayState(mode="pulsing", pulse_until=now + seconds)
            self._set(True)
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
            self.state = RelayState(mode="holding", hold_kind=kind, hold_since=now)
            self._set(True)
            self._audit("relay_hold", {"kind": kind})

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
