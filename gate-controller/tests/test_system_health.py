"""Pi CPU temperature reading (24 Oct 2026). No hardware: a temporary file stands in for the kernel sensor."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from balwyn_gate_controller.system_health import CpuTemperature, read_cpu_temp_c  # noqa: E402


class CpuTemperatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name, "temp")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_millidegrees_are_converted_to_one_decimal(self) -> None:
        self.path.write_text("48312\n", encoding="ascii")
        self.assertEqual(read_cpu_temp_c(self.path), 48.3)

    def test_missing_garbage_or_implausible_readings_give_none(self) -> None:
        self.assertIsNone(read_cpu_temp_c(Path(self.tmp.name, "absent")))
        for raw in ("", "hot", "250000", "-60000", "nan"):
            self.path.write_text(raw, encoding="ascii")
            self.assertIsNone(read_cpu_temp_c(self.path), raw)

    def test_the_reading_is_cached_for_the_interval(self) -> None:
        self.path.write_text("40000", encoding="ascii")
        sensor = CpuTemperature(interval_s=30, path=self.path)
        self.assertEqual(sensor.get(100.0), 40.0)
        self.path.write_text("55000", encoding="ascii")
        self.assertEqual(sensor.get(110.0), 40.0, "read again before the interval")
        self.assertEqual(sensor.get(130.0), 55.0)


if __name__ == "__main__":
    unittest.main()
