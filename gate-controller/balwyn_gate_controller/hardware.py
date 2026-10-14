"""GPIO access. The only module that touches hardware.

LgpioBackend uses exactly the lgpio calls already proven in this repository
(controller-agent/balwyn_relay_agent.py): gpiochip_open, gpio_claim_output,
gpio_claim_input with SET_PULL_*, gpio_read, gpio_write, gpiochip_close.

FakeBackend is for tests and bench simulation. It never imports lgpio, so the
test suite cannot drive a real relay even when run on a Pi.

lgpio working directory (fixed 28 Sep 2026): `import lgpio` itself starts a
notification thread that creates a FIFO named .lgd-nfy<N> in the directory
named by the LG_WD environment variable, else the current directory, and then
chdir()s into it. The service runs from a read-only /opt directory as an
unprivileged user, where that FIFO cannot be created and the import raised
FileNotFoundError, so the controller could never start. LG_WD is now always
set to a private, writable directory before lgpio is imported.

Relay pin bias (added 15 Oct 2026): every relay output is claimed with the
internal pull resistor that holds that relay OFF (pull-down on a board that
switches on HIGH, pull-up on a board that switches on LOW). While the
controller runs, the pin is driven and the pull has no effect. It matters
when the controller is killed without running its clean-up (systemd
watchdog, out of memory) and the kernel returns the released line to an
input: only the pull then decides what the relay driver sees. lgpio passes the
pull to the kernel with the output request (GPIO_V2_LINE_FLAG_BIAS_PULL_*,
read from lgpio 0.2.2 source). If a kernel refuses a pull on an output, the
claim is retried without it and the fallback is reported, so start-up never
fails because of it.

What a Raspberry Pi kernel does with a released output is UNVERIFIED here:
recent Raspberry Pi kernels may keep a freed output DRIVING its last level
(pinctrl_bcm2835 parameter persist_gpio_outputs). In that case a relay that
was ON when the controller was killed stays ON, the pull does nothing, and only
`relays-off` (systemd ExecStopPost) switches it off. So: relays-off drives
every pin it can, one at a time, including the pins the dead process recorded
as claimed (relay-outputs.json), and install test B4 proves it on the Pi.
"""

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional, Protocol, Tuple

from .config import FORBIDDEN_RELAY_PINS


def lgpio_work_dir(preferred: Optional[Path]) -> str:
    """A private, writable directory for lgpio's notification FIFO.

    An LG_WD already set in the environment wins. Otherwise use `preferred`
    (the controller passes <state dir>/lgpio), and if that cannot be created or
    written, a fresh private temporary directory.
    """
    existing = os.environ.get("LG_WD", "").strip()
    if existing:
        return existing
    if preferred is not None:
        try:
            preferred.mkdir(mode=0o700, parents=True, exist_ok=True)
            if os.access(preferred, os.W_OK | os.X_OK):
                return str(preferred)
        except OSError:
            pass
    return tempfile.mkdtemp(prefix="balwyn-lgpio-")


class GpioBusyError(RuntimeError):
    """A GPIO line is already claimed by another program."""


class Backend(Protocol):
    def claim_output(self, pin: int, level: int, pull: str = "off") -> bool: ...
    def claim_input(self, pin: int, pull: str) -> None: ...
    def read(self, pin: int) -> int: ...
    def write(self, pin: int, level: int) -> None: ...
    def close(self) -> None: ...


class LgpioBackend:
    """Real GPIO on Raspberry Pi OS through lgpio, chip 0 (the 40-pin header on
    a Pi 4, and on a Pi 5 with a current kernel)."""

    def __init__(self, work_dir: Optional[Path] = None) -> None:
        # Must happen before the import: see the module docstring.
        os.environ["LG_WD"] = lgpio_work_dir(work_dir)
        import lgpio  # imported here so tests and non-Pi machines never load it

        self._lgpio = lgpio
        self._chip = lgpio.gpiochip_open(0)
        self._pulls = {"up": lgpio.SET_PULL_UP, "down": lgpio.SET_PULL_DOWN, "off": lgpio.SET_PULL_NONE}

    def _claim(self, pin: int, call: Callable[[], object]) -> None:
        try:
            call()
        except self._lgpio.error as error:
            if "busy" in str(error).lower():
                raise GpioBusyError(
                    f"GPIO {pin} is already in use by another program: the other gate's service with an "
                    "overlapping pin, pi-door-service, controller-agent, or a test script. Only one program "
                    "may own each pin.") from None
            raise

    def claim_output(self, pin: int, level: int, pull: str = "off") -> bool:
        """Claim an output at `level`. Returns False if the pull had to be dropped."""
        if pull == "off":
            self._claim(pin, lambda: self._lgpio.gpio_claim_output(self._chip, pin, level))
            return True
        try:
            self._claim(pin, lambda: self._lgpio.gpio_claim_output(self._chip, pin, level, self._pulls[pull]))
            return True
        except GpioBusyError:
            raise
        except self._lgpio.error:
            self._claim(pin, lambda: self._lgpio.gpio_claim_output(self._chip, pin, level))
            return False

    def claim_input(self, pin: int, pull: str) -> None:
        self._claim(pin, lambda: self._lgpio.gpio_claim_input(self._chip, pin, self._pulls[pull]))

    def read(self, pin: int) -> int:
        return int(self._lgpio.gpio_read(self._chip, pin))

    def write(self, pin: int, level: int) -> None:
        self._lgpio.gpio_write(self._chip, pin, level)

    def close(self) -> None:
        self._lgpio.gpiochip_close(self._chip)


class FakeBackend:
    """In-memory GPIO. Records every write so tests can prove what the relay did."""

    def __init__(self, strict_claims: bool = False) -> None:
        # strict_claims=True models two programs sharing one chip: a second claim of a
        # pin is refused, as the kernel does. Off by default so a test can model a
        # restart (a new process) on the same simulated hardware.
        self.strict_claims = strict_claims
        self.levels: Dict[int, int] = {}
        self.outputs: set[int] = set()
        self.output_pulls: Dict[int, str] = {}
        self.refuse_output_pull = False  # simulate a kernel that rejects a pull on an output
        self.claimed: set[int] = set()
        self.writes: List[Tuple[int, int]] = []
        self.closed = False
        self._lock = threading.Lock()

    def claim_output(self, pin: int, level: int, pull: str = "off") -> bool:
        with self._lock:
            if self.strict_claims and pin in self.claimed:
                raise GpioBusyError(f"GPIO {pin} is already in use by another program")
            self.claimed.add(pin)
            self.outputs.add(pin)
            accepted = not (self.refuse_output_pull and pull != "off")
            self.output_pulls[pin] = pull if accepted else "off"
            self.levels[pin] = level
            self.writes.append((pin, level))
            return accepted

    def claim_input(self, pin: int, pull: str) -> None:
        with self._lock:
            if self.strict_claims and pin in self.claimed:
                raise GpioBusyError(f"GPIO {pin} is already in use by another program")
            self.claimed.add(pin)
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
        self.claimed.clear()


def relay_off_pull(relay_active_low: bool) -> str:
    """The pull that keeps an undriven relay input OFF."""
    return "up" if relay_active_low else "down"


def force_relays_off(backend: Backend, pins: List[int], relay_active_low: bool,
                     settle_s: float = 0.2) -> Tuple[List[int], Dict[int, str]]:
    """Claim each relay output OFF (with the OFF pull), hold briefly, release. For ExecStopPost.

    Every pin is tried on its own: one busy or failing pin never stops the
    others being driven OFF. Returns (pins driven OFF, {pin: error})."""
    off = 1 if relay_active_low else 0
    done: List[int] = []
    failed: Dict[int, str] = {}
    try:
        for pin in pins:
            try:
                backend.claim_output(pin, off, relay_off_pull(relay_active_low))
                done.append(pin)
            except Exception as error:  # noqa: BLE001 - report and carry on to the next pin
                failed[pin] = str(error) or type(error).__name__
        if done and settle_s > 0:
            import time
            time.sleep(settle_s)
    finally:
        backend.close()
    return done, failed


RELAY_RECORD = "relay-outputs.json"


def record_relay_outputs(state_dir: Path, pins: List[int], relay_active_low: bool) -> None:
    """Remember which relay pins this process claimed, for relays-off after a crash.

    The env file may be edited while the controller runs; relays-off must still
    switch off the pins the dead process actually drove. Atomic write. A failure
    is not fatal (relays-off still has the env file's pins)."""
    import json
    try:
        tmp = state_dir / (RELAY_RECORD + ".tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"pins": pins, "active_low": relay_active_low}))
            handle.flush()
            os.fsync(handle.fileno())
        tmp.replace(state_dir / RELAY_RECORD)
    except OSError:
        pass


def recorded_relay_outputs(state_dir: Path) -> Optional[Tuple[List[int], bool]]:
    """The record written by record_relay_outputs, or None if absent or unreadable."""
    import json
    try:
        data = json.loads((state_dir / RELAY_RECORD).read_text(encoding="utf-8"))
        # Never a pin the controller itself would refuse to use as a relay (GPIO 2, 3, 14, 15 idle HIGH by themselves).
        pins = [int(p) for p in data["pins"] if 2 <= int(p) <= 27 and int(p) not in FORBIDDEN_RELAY_PINS]
        return pins, bool(data["active_low"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


class GateIO:
    """Named, polarity-corrected view of one gate's pins."""

    def __init__(self, backend: Backend, relay_pin: int, relay_active_low: bool,
                 closed_reed_pin: int, open_reed_pin: Optional[int], safety_pin: Optional[int],
                 input_active_low: bool, input_pull: str,
                 unlock_relay_pin: Optional[int] = None, unlock_sense_pin: Optional[int] = None) -> None:
        self._b = backend
        self.relay_pin = relay_pin
        self._relay_on = 0 if relay_active_low else 1
        self._relay_off = 1 - self._relay_on
        self.closed_reed_pin = closed_reed_pin
        self.open_reed_pin = open_reed_pin
        self.safety_pin = safety_pin
        self._input_active_low = input_active_low
        self._energised = False
        self.unlock_relay_pin = unlock_relay_pin
        self.unlock_sense_pin = unlock_sense_pin
        # Relays claimed OFF first, before any input, so a start-up fault can never leave one on.
        # Both relay channels sit on the same relay board, so they share RELAY_ACTIVE_LOW.
        # The pull holds the relay OFF if the line is ever released undriven (module docstring).
        self.relay_off_pull = relay_off_pull(relay_active_low)
        self.pull_fallback: List[int] = []
        for pin in (relay_pin, unlock_relay_pin):
            if pin is not None and not backend.claim_output(pin, self._relay_off, self.relay_off_pull):
                self.pull_fallback.append(pin)
        for pin in (closed_reed_pin, open_reed_pin, safety_pin, unlock_sense_pin):
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

    def unlock_relay(self, on: bool) -> None:
        """The access board's exit-button press. A no-op when no unlock relay is fitted."""
        if self.unlock_relay_pin is not None:
            self._b.write(self.unlock_relay_pin, self._relay_on if on else self._relay_off)

    def unlock_sensed(self) -> Optional[bool]:
        """True while the access board holds the door unlocked (K1 spare contact made). None if not fitted."""
        return None if self.unlock_sense_pin is None else self._active(self.unlock_sense_pin)

    @property
    def relay_energised(self) -> bool:
        return self._energised

    def shutdown(self) -> None:
        """Both relays off, then release the chip. Safe to call more than once."""
        try:
            try:
                self.relay(False)
            finally:
                self.unlock_relay(False)
        finally:
            self._b.close()
