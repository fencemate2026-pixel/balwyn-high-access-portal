"""Raspberry Pi health readings reported to the portal (24 Oct 2026).

Only the CPU temperature for now: the Pi's own SoC sensor, read from the Linux
thermal interface. It is the temperature of the Pi's processor, NOT the air in
the gate enclosure (a Pi CPU normally runs well above the air around it), and
the portal labels it that way. Reading it never raises: any problem returns
None and the portal shows no figure rather than a guessed one.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Optional

CPU_THERMAL_ZONE = Path("/sys/class/thermal/thermal_zone0/temp")

# A reading outside this range is a sensor or parsing fault, not a temperature.
MIN_PLAUSIBLE_C = -40.0
MAX_PLAUSIBLE_C = 125.0


def read_cpu_temp_c(path: Path = CPU_THERMAL_ZONE) -> Optional[float]:
    """CPU temperature in degrees Celsius (one decimal), or None if unavailable or implausible."""
    try:
        raw = path.read_text(encoding="ascii").strip()
        value = int(raw) / 1000.0  # the kernel reports millidegrees
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not math.isfinite(value) or not MIN_PLAUSIBLE_C <= value <= MAX_PLAUSIBLE_C:
        return None
    return round(value, 1)


class CpuTemperature:
    """Caches the reading so the 750 ms poll loop reads the sensor at most every `interval_s`."""

    def __init__(self, interval_s: float = 30.0, path: Path = CPU_THERMAL_ZONE) -> None:
        self._interval = interval_s
        self._path = path
        self._value: Optional[float] = None
        self._read_at: Optional[float] = None

    def get(self, now: float) -> Optional[float]:
        if self._read_at is None or now - self._read_at >= self._interval or now < self._read_at:
            self._value = read_cpu_temp_c(self._path)
            self._read_at = now
        return self._value
