"""Algorithm 2: lockdown inhibit state machine.

States:  NORMAL  <-->  LOCKDOWN        (events: LOCKDOWN, ALL_CLEAR)

Rules, in the order they are applied to every event:
  1. DISABLED. enabled is a REQUIRED constructor argument, no default. With
     enabled=False every event is audited and ignored and nothing is ever
     inhibited. (Jarrod's recorded 12 Oct 2026 decision: lockdown stays inactive
     until the AI threat-detection work is complete. The caller must say so.)
  2. DUPLICATE. An event_id already applied is a no-op (webhook retries).
  3. FUTURE. An event stamped later than now + max_future_skew_s is rejected:
     one bad sender clock must not freeze the machine at a far-future stamp.
  4. STALE. An event ordered before the last applied event is ignored, so a late
     ALL_CLEAR can never cancel a newer LOCKDOWN.
  5. ORDER. Events are ordered by (event_ts, priority); on an equal timestamp
     LOCKDOWN (priority 1) beats ALL_CLEAR (priority 0), because wrongly
     staying inhibited is recoverable by a fresh ALL_CLEAR and wrongly
     releasing is not.
  6. NO TIMER EVER CLEARS A LOCKDOWN. After alarm_after_s the machine reports
     stale_alarm() so a human is told; it does not self-release. (Same
     principle as the deployed controller's fire hold.)

An in-flight pulse is NOT cut short when lockdown starts: pulses are 1.5 s and
the recover write is the safe state. Only NEW pulses are refused.

Persistence: state is written atomically (temp file, fsync, rename) on every
change, so a restart during a lockdown comes back in LOCKDOWN. If the state
file exists but cannot be read, on_unreadable decides: "inhibit" (default,
come up in LOCKDOWN) or "normal". A missing file is a first boot: NORMAL.

TRUTH_GAP (on_unreadable default): "inhibit" blocks every non-exempt door after
a corrupt state file until someone sends ALL_CLEAR. That is the fail-safe reading
of a lockdown product; the school may prefer "normal". It is a school decision.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .keys import Door

NORMAL = "NORMAL"
LOCKDOWN = "LOCKDOWN"
PRIORITY = {"ALL_CLEAR": 0, "LOCKDOWN": 1}
MAX_REMEMBERED_IDS = 256


def _noop_audit(event: str, fields: Dict[str, Any]) -> None:
    return None


class LockdownMachine:
    def __init__(self, state_path: str | Path, *, enabled: bool, audit: Callable[[str, Dict[str, Any]], None] = _noop_audit,
                 wall: Callable[[], float] = time.time, on_unreadable: str = "inhibit",
                 max_future_skew_s: float = 60.0, alarm_after_s: float = 4 * 3600.0) -> None:
        if not isinstance(enabled, bool):
            raise TypeError("enabled must be True or False (no default: lockdown is an explicit decision)")
        if on_unreadable not in {"inhibit", "normal"}:
            raise ValueError("on_unreadable must be 'inhibit' or 'normal'")
        self._path = Path(state_path)
        self._enabled = enabled
        self._audit = audit
        self._wall = wall
        self._max_future = max_future_skew_s
        self._alarm_after = alarm_after_s
        self._lock = threading.RLock()
        self.state = NORMAL
        self._last_ts = 0.0
        self._last_priority = -1
        self._since = 0.0
        self._seen: List[str] = []
        self._load(on_unreadable)

    # ------------------------------------------------------------------ API
    def apply(self, event_type: str, event_id: str, event_ts: float) -> Dict[str, Any]:
        """Apply one LOCKDOWN / ALL_CLEAR event. Returns {applied, state, reason}."""
        with self._lock:
            if event_type not in PRIORITY:
                return self._outcome(False, "BAD_EVENT")
            if not self._enabled:
                self._audit("lockdown_event_ignored", {"type": event_type, "id": event_id, "why": "LOCKDOWN_DISABLED"})
                return self._outcome(False, "LOCKDOWN_DISABLED")
            if not isinstance(event_id, str) or not event_id or not isinstance(event_ts, (int, float)) or isinstance(event_ts, bool):
                return self._outcome(False, "BAD_EVENT")
            if event_id in self._seen:
                return self._outcome(False, "DUPLICATE")
            if event_ts > self._wall() + self._max_future:
                self._audit("lockdown_event_rejected", {"type": event_type, "id": event_id, "why": "FUTURE_TIMESTAMP"})
                return self._outcome(False, "FUTURE_TIMESTAMP")
            order = (event_ts, PRIORITY[event_type])
            if order < (self._last_ts, self._last_priority):
                self._audit("lockdown_event_ignored", {"type": event_type, "id": event_id, "why": "STALE"})
                return self._outcome(False, "STALE")

            previous = self.state
            self.state = LOCKDOWN if event_type == "LOCKDOWN" else NORMAL
            self._last_ts, self._last_priority = order
            if self.state != previous:
                self._since = self._wall()
            self._seen.append(event_id)
            del self._seen[:-MAX_REMEMBERED_IDS]
            self._save()
            self._audit("lockdown_state", {"from": previous, "to": self.state, "type": event_type, "id": event_id})
            return self._outcome(True, "APPLIED")

    def inhibited(self, door: Door) -> bool:
        """True when a NEW pulse for this door must be refused."""
        with self._lock:
            return self._enabled and self.state == LOCKDOWN and not door.lockdown_exempt

    def stale_alarm(self) -> bool:
        """True when a lockdown has run longer than alarm_after_s. Tells a human; never releases."""
        with self._lock:
            return self._enabled and self.state == LOCKDOWN and self._wall() - self._since > self._alarm_after

    # ------------------------------------------------------------- internals
    def _outcome(self, applied: bool, reason: str) -> Dict[str, Any]:
        return {"applied": applied, "state": self.state, "reason": reason}

    def _save(self) -> None:
        payload = {"state": self.state, "last_ts": self._last_ts, "last_priority": self._last_priority,
                   "since": self._since, "seen": self._seen}
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, self._path)

    def _load(self, on_unreadable: str) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            state = data["state"]
            if state not in {NORMAL, LOCKDOWN}:
                raise ValueError("bad state")
            self.state = state
            self._last_ts = float(data["last_ts"])
            self._last_priority = int(data["last_priority"])
            self._since = float(data["since"])
            self._seen = [str(x) for x in data["seen"]][-MAX_REMEMBERED_IDS:]
        except (OSError, ValueError, KeyError, TypeError):
            self._audit("lockdown_state_unreadable", {"policy": on_unreadable})
            if self._enabled and on_unreadable == "inhibit":
                self.state = LOCKDOWN
                self._since = self._wall()
                self._last_ts, self._last_priority = 0.0, -1
