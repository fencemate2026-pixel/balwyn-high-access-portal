"""Algorithm 3: schedule release.

Turns timetable release events into door pulses at the right instant, exactly
once, and never fires one late. Three problems are solved here:

  TIME     Wall-clock strings are interpreted in campus.timezone (zoneinfo).
           * A local time that does not exist (the spring-forward gap, 02:00 to
             03:00 on 4 Oct 2026 in Australia/Melbourne) is moved FORWARD by the
             gap, i.e. it fires at the first real instant after the gap.
           * A local time that happens twice (the autumn fall-back hour) uses
             the FIRST occurrence (fold=0).
  SKEW     ClockSkew estimates (server time - local time) from portal replies
           (median of the last N samples, round-trip compensated). The release
           clock is local wall time + that offset. An offset beyond max_skew_s
           is reported as untrustworthy and is NOT applied.
  EXACTLY-ONCE / LATE
           * an event_id fires at most once (fired ids are remembered);
           * an event more than late_tolerance_s past its time is MISSED, never
             fired: a door pulsing minutes late is worse than a logged miss;
           * two releases for one door closer than minRetriggerMs coalesce; the
             first wins and the rest are reported COALESCED.

Only events whose type maps to action PULSE_DOOR in keys.events are accepted
(SCHEDULE_RELEASE, VISITOR_RELEASE in the template) and only for enabled, known
doors. Every rejected event is returned with a reason; nothing is dropped silently.
"""

from __future__ import annotations

import statistics
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .keys import Keys

MAX_FIRED_REMEMBERED = 4096


def resolve_local(tz_name: str, local: str) -> float:
    """Epoch seconds for a campus-local 'YYYY-MM-DDTHH:MM[:SS]' string. See module docstring for DST rules."""
    zone = ZoneInfo(tz_name)
    naive = datetime.fromisoformat(local)
    if naive.tzinfo is not None:
        raise ValueError("local time must not carry an offset")
    aware = naive.replace(tzinfo=zone, fold=0)
    return aware.astimezone(timezone.utc).timestamp()


class ClockSkew:
    """Median estimate of (server clock - local clock) from timestamped portal replies."""

    def __init__(self, samples: int = 9, max_skew_s: float = 120.0) -> None:
        self._offsets: Deque[float] = deque(maxlen=samples)
        self._max = max_skew_s

    def observe(self, server_ts: float, local_sent: float, local_received: float) -> None:
        """One reply: the server stamped server_ts; we sent at local_sent and got it at local_received."""
        if local_received < local_sent:
            return  # local clock stepped backwards mid-request: unusable sample
        midpoint = local_sent + (local_received - local_sent) / 2.0
        self._offsets.append(server_ts - midpoint)

    def offset(self) -> float:
        return statistics.median(self._offsets) if self._offsets else 0.0

    def trustworthy(self) -> bool:
        return abs(self.offset()) <= self._max

    def applied_offset(self) -> float:
        """The offset to add to local time: 0.0 when none is known or it is implausibly large."""
        return self.offset() if self._offsets and self.trustworthy() else 0.0


class ScheduleReleaser:
    def __init__(self, keys: Keys, *, wall: Callable[[], float] = time.time, skew: Optional[ClockSkew] = None,
                 late_tolerance_s: float = 30.0, audit: Callable[[str, Dict[str, Any]], None] = lambda e, f: None) -> None:
        if late_tolerance_s < 0:
            raise ValueError("late_tolerance_s must be >= 0")
        self.keys = keys
        self._wall = wall
        self._skew = skew
        self._late = late_tolerance_s
        self._audit = audit
        self._lock = threading.RLock()
        self._pending: List[Dict[str, Any]] = []
        self._ids: set = set()
        self._fired: Deque[str] = deque(maxlen=MAX_FIRED_REMEMBERED)

    def now(self) -> float:
        return self._wall() + (self._skew.applied_offset() if self._skew else 0.0)

    def add(self, event_id: str, event_type: str, door_id: str, local_time: str) -> Tuple[bool, str]:
        """Queue one release. Returns (accepted, reason)."""
        spec = self.keys.events.get(event_type)
        if spec is None or spec.get("action") != "PULSE_DOOR":
            return self._reject(event_id, "BAD_EVENT")
        door = self.keys.door(door_id)
        if door is None:
            return self._reject(event_id, "UNKNOWN_DOOR")
        if not door.enabled:
            return self._reject(event_id, "DISABLED_DOOR")
        try:
            at = resolve_local(self.keys.timezone, local_time)
        except (ValueError, KeyError):
            return self._reject(event_id, "BAD_TIME")
        with self._lock:
            if event_id in self._ids or event_id in self._fired:
                return (False, "DUPLICATE")
            self._ids.add(event_id)
            self._pending.append({"event_id": event_id, "event_type": event_type, "door_id": door_id, "at": at})
            self._pending.sort(key=lambda item: (item["at"], item["event_id"]))
        return (True, "QUEUED")

    def due(self) -> Dict[str, List[Dict[str, Any]]]:
        """Pop everything whose time has come: {'fire': [...], 'missed': [...], 'coalesced': [...]}."""
        now = self.now()
        out: Dict[str, List[Dict[str, Any]]] = {"fire": [], "missed": [], "coalesced": []}
        last_fire: Dict[str, float] = {}
        gap = self.keys.min_retrigger_ms / 1000.0
        with self._lock:
            keep: List[Dict[str, Any]] = []
            for item in self._pending:
                if item["at"] > now:
                    keep.append(item)
                    continue
                self._ids.discard(item["event_id"])
                if now - item["at"] > self._late:
                    out["missed"].append(item)
                    self._audit("schedule_missed", {"id": item["event_id"], "door": item["door_id"], "late_s": round(now - item["at"], 1)})
                    continue
                previous = last_fire.get(item["door_id"])
                if previous is not None and item["at"] - previous < gap:
                    out["coalesced"].append(item)
                    self._audit("schedule_coalesced", {"id": item["event_id"], "door": item["door_id"]})
                    continue
                last_fire[item["door_id"]] = item["at"]
                self._fired.append(item["event_id"])
                out["fire"].append(item)
            self._pending = keep
        return out

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)

    def _reject(self, event_id: str, reason: str) -> Tuple[bool, str]:
        self._audit("schedule_rejected", {"id": event_id, "why": reason})
        return (False, reason)
