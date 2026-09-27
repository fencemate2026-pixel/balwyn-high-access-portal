"""Gate position from reed switches, debounced.

Rules (never upgraded to a guess):
  closed reed made, open reed not made   -> "closed"
  open reed made, closed reed not made   -> "open"
  both made                              -> "unknown" + fault (wiring or magnet fault)
  neither made, open reed fitted, and a movement began within travel time -> "moving"
  anything else                          -> "unknown"
Without an open reed, "released closed reed" is reported as "unknown", never
"open": not-closed is equally consistent with open, half-way and blocked.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class _Debounced:
    """A boolean that only changes after it has been stable for `hold` seconds."""
    hold: float
    stable: Optional[bool] = None
    candidate: Optional[bool] = None
    since: float = 0.0

    def update(self, raw: Optional[bool], now: float) -> Optional[bool]:
        if raw is None:
            self.stable = None
            return None
        if self.stable is None:  # first reading: accept after one debounce period
            if self.candidate != raw:
                self.candidate, self.since = raw, now
            elif now - self.since >= self.hold:
                self.stable = raw
            return self.stable
        if raw == self.stable:
            self.candidate = raw
            return self.stable
        if self.candidate != raw:
            self.candidate, self.since = raw, now
        elif now - self.since >= self.hold:
            self.stable = raw
        return self.stable


@dataclass
class PositionReading:
    position: str
    faults: List[str] = field(default_factory=list)


class PositionTracker:
    def __init__(self, debounce_s: float, travel_timeout_s: float, open_reed_fitted: bool) -> None:
        self._closed = _Debounced(debounce_s)
        self._open = _Debounced(debounce_s)
        self._travel = travel_timeout_s
        self._open_fitted = open_reed_fitted
        self._movement_started: Optional[float] = None
        self.last = PositionReading("unknown")

    def movement_started(self, now: float) -> None:
        """Called when the relay asks the gate to move, so 'moving' can be reported honestly."""
        self._movement_started = now

    def update(self, closed_raw: bool, open_raw: Optional[bool], now: float) -> PositionReading:
        closed = self._closed.update(closed_raw, now)
        opened = self._open.update(open_raw, now) if self._open_fitted else None
        faults: List[str] = []
        if closed is None or (self._open_fitted and opened is None):
            position = "unknown"
        elif closed and opened:
            position = "unknown"
            faults.append("Both open and closed reeds are made: check reed wiring and magnets")
        elif closed:
            position = "closed"
            self._movement_started = None
        elif opened:
            position = "open"
            self._movement_started = None
        elif self._open_fitted and self._movement_started is not None and now - self._movement_started < self._travel:
            position = "moving"
        else:
            position = "unknown"
        self.last = PositionReading(position, faults)
        return self.last
