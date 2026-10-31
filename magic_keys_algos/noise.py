"""Algorithm 4: error code -> noise-matrix telemetry for the portal canvas.

Each active error contributes a decaying sinusoid at its own frequency. The
canvas needs ONE amplitude and ONE frequency per bind point, so contributions
that share a canvasBind are combined by:

    amplitude = min(1, sqrt(sum(a_i^2)))        (root-sum-square: two equal
                                                  errors are louder than one but
                                                  never exceed the 0..1 range)
    frequency = amplitude-weighted mean of f_i  (the loudest error dominates)

Envelope: while an error is still being reported (refreshed within hold_s) it
sits at full amplitude; after that it decays exponentially with time constant
decay_s and is dropped once below 1% of its amplitude. A repeat error simply
refreshes the hold time (no stacking of the same code on the same door).

The numbers (amplitude, frequency, canvasBind) come ONLY from keys.errorMatrix.
An unknown code returns None: this module never invents a row for it.

Output frame (JSON-ready, one per bind point per tick):
    {"type": "NOISE", "bind": "door.obstruction", "door_id": "S1",
     "amplitude": 0.08, "frequency_hz": 18.0, "codes": ["MOTOR_BLOCKED"], "ts_unix": ...}
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from .keys import Keys

CUTOFF_FRACTION = 0.01


class NoiseMatrix:
    def __init__(self, keys: Keys, *, hold_s: float = 5.0, decay_s: float = 3.0,
                 mono: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time) -> None:
        if hold_s < 0 or decay_s <= 0:
            raise ValueError("hold_s must be >= 0 and decay_s > 0")
        self.keys = keys
        self._hold = hold_s
        self._decay = decay_s
        self._mono = mono
        self._wall = wall
        self._lock = threading.RLock()
        self._active: Dict[Tuple[str, str], float] = {}   # (code, door_id) -> last refreshed (monotonic)

    def report(self, code: str, door_id: Optional[str] = None) -> bool:
        """Note that this error is happening now. False for a code not in errorMatrix (nothing is invented)."""
        if code not in self.keys.error_matrix:
            return False
        with self._lock:
            self._active[(code, door_id or "")] = self._mono()
        return True

    def _envelope(self, age: float) -> float:
        if age <= self._hold:
            return 1.0
        return math.exp(-(age - self._hold) / self._decay)

    def frames(self) -> List[Dict[str, Any]]:
        """One frame per (bind, door) with live contributions; expired entries are dropped."""
        now = self._mono()
        groups: Dict[Tuple[str, str], List[Tuple[str, float, float]]] = {}
        with self._lock:
            for key, stamp in list(self._active.items()):
                code, door_id = key
                envelope = self._envelope(now - stamp)
                if envelope < CUTOFF_FRACTION:
                    del self._active[key]
                    continue
                row = self.keys.error_matrix[code]
                groups.setdefault((row["canvasBind"], door_id), []).append(
                    (code, float(row["noiseAmplitude"]) * envelope, float(row["noiseFrequencyHz"])))
        frames = []
        for (bind, door_id), parts in sorted(groups.items()):
            amplitude = min(1.0, math.sqrt(sum(a * a for _, a, _ in parts)))
            total = sum(a for _, a, _ in parts)
            frequency = sum(a * f for _, a, f in parts) / total if total > 0 else 0.0
            frames.append({"type": "NOISE", "bind": bind, "door_id": door_id or None,
                           "amplitude": round(amplitude, 6), "frequency_hz": round(frequency, 6),
                           "codes": sorted(code for code, _, _ in parts), "ts_unix": self._wall()})
        return frames


def sample(frame: Dict[str, Any], t_seconds: float) -> float:
    """Instantaneous canvas displacement for a frame: amplitude * sin(2*pi*f*t)."""
    return frame["amplitude"] * math.sin(2.0 * math.pi * frame["frequency_hz"] * t_seconds)
