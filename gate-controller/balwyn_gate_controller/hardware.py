"""GPIO access. The only module that touches hardware.

LgpioBackend uses exactly the lgpio calls already proven in this repository
(controller-agent/balwyn_relay_agent.py): gpiochip_open, gpio_claim_output,
gpio_claim_input with SET_PULL_*, gpio_read, gpio_write, gpiochip_close.

FakeBackend is for tests and bench simulation. It never imports lgpio, so the
test suite cannot drive a real relay even when run on a Pi.
"""

from __future__ import annotations

import threading
from typing import Dict, List, Optional, Protocol, Tuple


class Backend(Protocol):
    def claim_output(self, pin: int, level: int) -> None: ...
    def claim_input(self, pin: int, pull: str) -> None: ...
    def read(self, pin: int) -> int: ...
    def write(self, pin: int, level: int) -> None: ...
    def close(self) -> None: ...


class LgpioBackend:
    """Real GPIO on Raspberry Pi OS (Bookworm) through lgpio, chip 0."""

    def __init__(self) -> None:
        import lgpio  # imported here so tests and non-Pi machines never load it

        self._lgpio = lgpio
        self._chip = lgpio.gpiochip_open(0)
        self._pulls = {"up": lgpio.SET_PULL_UP, "down": lgpio.SET_PULL_DOWN, "off": lgpio.SET_PULL_NONE}

    def claim_output(self, pin: int, level: int) -> None:
        self._lgpio.gpio_claim_output(self._chip, pin, level)

    def claim_input(self, pin: int, pull: str) -> None:
        self._lgpio.gpio_claim_input(self._chip, pin, self._pulls[pull])

    def read(self, pin: int) -> int:
        return int(self._lgpio.gpio_read(self._chip, pin))

    def write(self, pin: int, level: int) -> None:
        self._lgpio.gpio_write(self._chip, pin, level)

    def close(self) -> None:
        self._lgpio.gpiochip_close(self._chip)


class FakeBackend:
    """In-memory GPIO. Records every write so tests can prove what the relay did."""

    def __init__(self) -> None:
        self.levels: Dict[int, int] = {}
        self.outputs: set[int] = set()
        self.writes: List[Tuple[int, int]] = []
        self.closed = False
        self._lock = threading.Lock()

    def claim_output(self, pin: int, level: int) -> None:
        with self._lock:
            self.outputs.add(pin)
            self.levels[pin] = level
            self.writes.append((pin, level))

    def claim_input(self, pin: int, pull: str) -> None:
        with self._lock:
            self.levels.setdefault(pin, 1 if pull == "up" else 0)

    def read(self, pin: int) -> int:
        with self._lock:
            return self.levels.get(pin, 0)

    def write(self, pin: int, level: int) -> None:
        with self._lock:
            if pin not in self.outputs:
                raise RuntimeError(f"write to unclaimed pin {pin}")
            self.levels[pin] = level
            self.writes.append((pin, level))

    def set_input(self, pin: int, level: int) -> None:
        with self._lock:
            self.levels[pin] = level

    def close(self) -> None:
        self.closed = True


class GateIO:
    """Named, polarity-corrected view of one gate's pins."""

    def __init__(self, backend: Backend, relay_pin: int, relay_active_low: bool,
                 closed_reed_pin: int, open_reed_pin: Optional[int], safety_pin: Optional[int],
                 input_active_low: bool, input_pull: str) -> None:
        self._b = backend
        self.relay_pin = relay_pin
        self._relay_on = 0 if relay_active_low else 1
        self._relay_off = 1 - self._relay_on
        self.closed_reed_pin = closed_reed_pin
        self.open_reed_pin = open_reed_pin
        self.safety_pin = safety_pin
        self._input_active_low = input_active_low
        self._energised = False
        # Relay claimed OFF first, before any input, so a start-up fault can never leave it on.
        backend.claim_output(relay_pin, self._relay_off)
        for pin in (closed_reed_pin, open_reed_pin, safety_pin):
            if pin is not None:
                backend.claim_input(pin, input_pull)

    def _active(self, pin: int) -> bool:
        raw = bool(self._b.read(pin))
        return not raw if self._input_active_low else raw

    def closed_reed(self) -> bool:
        return self._active(self.closed_reed_pin)

    def open_reed(self) -> Optional[bool]:
        return None if self.open_reed_pin is None else self._active(self.open_reed_pin)

    def safety_healthy(self) -> Optional[bool]:
        return None if self.safety_pin is None else self._active(self.safety_pin)

    def relay(self, on: bool) -> None:
        self._b.write(self.relay_pin, self._relay_on if on else self._relay_off)
        self._energised = on

    @property
    def relay_energised(self) -> bool:
        return self._energised

    def shutdown(self) -> None:
        """Relay off, then release the chip. Safe to call more than once."""
        try:
            self.relay(False)
        finally:
            self._b.close()
