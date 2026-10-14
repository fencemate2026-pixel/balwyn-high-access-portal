"""Configuration for one gate controller process.

One process controls ONE gate. Run one systemd instance per gate
(balwyn-gate@TF-ENTRY, balwyn-gate@SIDE-ENTRY), each with its own env file.

Every setting is validated at start-up. A controller that is mis-configured
refuses to start rather than guessing: a wrong pin or a wrong polarity can
hold a gate open or report a closed gate as open.

Hardware model (agreed 19 Sep 2026):
  * ONE relay contact per gate into the operator's open input.
      - a short closure (CYCLE_PULSE_S, default 6 s) asks for a full
        open-and-auto-close cycle;
      - a maintained closure holds the gate open (schedules, bookings, fire).
  * CLOSED reed (required): made = gate fully closed.
  * OPEN reed (optional): made = gate fully open. Without it an open can
    never be confirmed, and the portal will record every open as not
    confirmed. That is the truth, not a fault in this program.
  * SAFETY input (optional but needed to command): a volt-free contact that
    is made while the operator's own safety circuit is healthy. With
    SAFETY_INPUT=none the controller runs monitor-only: it reports position
    but reports safety as NOT healthy, so the portal never sends it commands.

Access-board unlock (added 11 Oct 2026, optional): for gates whose magnetic
lock is powered by the school's ACB-004 access board.
  * UNLOCK_RELAY_PIN: a second relay channel whose volt-free contact is wired
    across the board's exit-button input for that door (P1-P4 and its GND).
    Before an open, the controller gives it one short press, so the board
    releases the lock for its own unlock time (e.g. 5 s) and logs the press.
    The gate relay then opens / holds the gate as usual. Once the gate is open
    the board may re-power the lock; it re-catches the gate when it closes.
  * UNLOCK_SENSE_PIN: an input wired to a spare volt-free contact of the 12 V
    interposing relay (K1) that the board's door relay drives. Made = the board
    has unlocked the door. When fitted, the controller only drives the gate
    after this confirms the unlock (a fire / evacuation command proceeds
    anyway). It also logs unlocks the board makes by itself (card, QR, button).

Relay board (added 15 Oct 2026): RELAY_BOARD names the relay hardware so a
wiring that cannot work is refused before any GPIO is touched.
  * keyestudio-ks0212: the Keyestudio "RPI 4-channel Relay Shield" (KS0212).
    Its four relays are hard-wired to BCM GPIO 4, 22, 6 and 26 (Keyestudio's
    own sample code, docs.keyestudio.com/projects/KS0212), and that code turns
    a relay ON by setting the pin HIGH, so RELAY_ACTIVE_LOW must be false.
    The relay pins must be among those four, and no reed / safety / sense
    input may use any of them: the shield's relay driver is connected to all
    four whether this gate uses it or not.
  * generic: any other board driven by one GPIO per channel. Only the
    general rules below apply; prove the polarity on the bench (test B0).
Whatever the board, a relay output may not use GPIO 2 or 3 (they carry the
board's fixed I2C pull-up resistors, so the line sits HIGH whenever the
controller is not driving it) or GPIO 14 or 15 (the serial port: GPIO 14
idles HIGH during boot when the serial console is on).
"""

from __future__ import annotations

import os
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

GATE_ID_PATTERN = re.compile(r"^[A-Z0-9-]{2,40}$")
# BCM GPIO numbers usable on a 40-pin Raspberry Pi header without clashing
# with the ID EEPROM pins (0, 1).
VALID_PINS = set(range(2, 28))
MAX_PULSE_S = 10.0  # the portal refuses pulse acknowledgements longer than 10 s
SETTINGS = (
    "PORTAL_URL", "GATE_ID", "CONTROLLER_TOKEN", "CONTROLLER_TOKEN_FILE", "RELAY_PIN", "RELAY_ACTIVE_LOW",
    "CLOSED_REED_PIN", "OPEN_REED_PIN", "SAFETY_INPUT", "INPUT_ACTIVE_LOW", "INPUT_PULL", "CYCLE_PULSE_S",
    "TRAVEL_TIMEOUT_S", "AUTO_CLOSE_TIMEOUT_S", "DEBOUNCE_S", "SCHEDULE_CONTROL", "HOLD_MAX_S",
    "NETWORK_LOSS_RELEASE_S", "LOOP_STALL_S", "DRY_RUN", "CA_FILE",
    "UNLOCK_RELAY_PIN", "UNLOCK_SENSE_PIN", "UNLOCK_PULSE_S", "UNLOCK_CONFIRM_TIMEOUT_S", "UNLOCK_LEAD_S",
    "RELAY_BOARD", "EMERGENCY_ALARM_S", "EMERGENCY_RESTORE_MAX_S", "OPEN_RATE_MAX", "OPEN_RATE_WINDOW_S",
)
MAX_UNLOCK_PULSE_S = 2.0  # an exit-button press, never a hold: the board times the unlock itself
# GPIO lines that are pulled or driven HIGH by the Pi itself when the controller
# is not driving them (I2C pull-up resistors on 2/3, serial TX/RX on 14/15).
# A relay output there can switch on during boot or after the controller stops.
FORBIDDEN_RELAY_PINS = frozenset({2, 3, 14, 15})
# Known relay boards: the pins the board's relay drivers are wired to, and
# whether a relay switches on when its pin is LOW.
RELAY_BOARDS = {
    # Keyestudio KS0212 RPI 4-channel Relay Shield. Channel order J2..J5 is
    # not stated by Keyestudio; the pins are, in their sample-code order.
    "keyestudio-ks0212": {"pins": (4, 22, 6, 26), "active_low": False},
}


class ConfigError(ValueError):
    """Raised for any invalid setting. The message names the setting."""


def _req(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigError(f"{name} is required")
    return value


def _bool(env: Mapping[str, str], name: str, default: Optional[bool] = None) -> bool:
    raw = env.get(name, "").strip().lower()
    if not raw:
        if default is None:
            raise ConfigError(f"{name} is required (true or false)")
        return default
    if raw not in {"true", "false"}:
        raise ConfigError(f"{name} must be exactly true or false")
    return raw == "true"


def _num(env: Mapping[str, str], name: str, default: float, low: float, high: float) -> float:
    raw = env.get(name, "").strip()
    try:
        value = float(raw) if raw else default
    except ValueError as error:
        raise ConfigError(f"{name} must be a number") from error
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low:g} and {high:g}")
    return value


def _pin(env: Mapping[str, str], name: str, required: bool) -> Optional[int]:
    raw = env.get(name, "").strip().lower()
    if not raw or raw == "none":
        if required:
            raise ConfigError(f"{name} is required (a BCM GPIO number)")
        return None
    if not (raw.isascii() and raw.isdigit()) or int(raw) not in VALID_PINS:
        raise ConfigError(f"{name} must be a BCM GPIO number between 2 and 27")
    return int(raw)


def _check_token_file_mode(token_file: str, credentials_dir: str) -> None:
    """A credential file other users can read is a leaked credential. The private copy systemd makes under
    $CREDENTIALS_DIRECTORY is exempt (systemd already controls it)."""
    if os.name == "nt":
        return
    try:
        mode = os.stat(token_file).st_mode
    except OSError:
        return  # the read below reports the problem
    if credentials_dir and os.path.realpath(token_file).startswith(os.path.realpath(credentials_dir) + os.sep):
        return
    if mode & 0o077:
        raise ConfigError("CONTROLLER_TOKEN_FILE must not be readable by other users: chmod 600 it")


def _relay_board(env: Mapping[str, str]) -> str:
    board = env.get("RELAY_BOARD", "generic").strip().lower() or "generic"
    if board != "generic" and board not in RELAY_BOARDS:
        raise ConfigError("RELAY_BOARD must be generic or " + " or ".join(sorted(RELAY_BOARDS)))
    return board


def _check_relay_outputs(board: str, active_low: bool, outputs: Mapping[str, Optional[int]]) -> None:
    """Rules for relay OUTPUT pins, shared by Config.from_env and relay_outputs_from_env."""
    for name, pin in outputs.items():
        if pin is not None and pin in FORBIDDEN_RELAY_PINS:
            raise ConfigError(f"{name} must not be GPIO {pin}: GPIO 2, 3, 14 and 15 sit HIGH by themselves "
                              "(I2C pull-ups / serial port), which can switch a relay on")
    if board == "generic":
        return
    spec = RELAY_BOARDS[board]
    allowed = ", ".join(str(p) for p in spec["pins"])
    if active_low != spec["active_low"]:
        raise ConfigError(f"RELAY_ACTIVE_LOW must be {'true' if spec['active_low'] else 'false'} for RELAY_BOARD={board}")
    for name, pin in outputs.items():
        if pin is not None and pin not in spec["pins"]:
            raise ConfigError(f"{name} must be one of GPIO {allowed} for RELAY_BOARD={board} (the board's relays are fixed to those pins)")


def relay_outputs_from_env(env: Mapping[str, str] | None = None) -> tuple[list[int], bool]:
    """Only what is needed to force the relays OFF: (relay output pins, active_low).

    Used by `relays-off` (systemd ExecStopPost), which must work even when the
    rest of the configuration (portal address, credential) is unavailable.
    """
    env = os.environ if env is None else env
    for name in ("RELAY_PIN", "UNLOCK_RELAY_PIN", "RELAY_ACTIVE_LOW", "RELAY_BOARD"):
        if "#" in env.get(name, ""):
            raise ConfigError(f"{name} contains '#'. Put comments on their own line")
    board = _relay_board(env)
    active_low = _bool(env, "RELAY_ACTIVE_LOW")
    relay = _pin(env, "RELAY_PIN", required=True)
    unlock = _pin(env, "UNLOCK_RELAY_PIN", required=False)
    _check_relay_outputs(board, active_low, {"RELAY_PIN": relay, "UNLOCK_RELAY_PIN": unlock})
    if relay == unlock:
        raise ConfigError("RELAY_PIN and UNLOCK_RELAY_PIN must be different pins")
    return [p for p in (relay, unlock) if p is not None], active_low


@dataclass(frozen=True)
class Config:
    portal_url: str
    gate_id: str
    token: str
    relay_pin: int
    relay_active_low: bool
    closed_reed_pin: int
    open_reed_pin: Optional[int]
    safety_pin: Optional[int]
    input_active_low: bool
    input_pull: str  # "up" | "down" | "off"
    cycle_pulse_s: float
    travel_timeout_s: float
    auto_close_timeout_s: float
    debounce_s: float
    schedule_control: bool
    hold_max_s: float
    network_loss_release_s: float
    loop_stall_s: float
    state_dir: Path
    dry_run: bool
    ca_file: Optional[str]
    # Access-board unlock (optional). Defaults keep existing env files valid.
    unlock_relay_pin: Optional[int] = None
    unlock_sense_pin: Optional[int] = None
    unlock_pulse_s: float = 0.5
    unlock_confirm_timeout_s: float = 2.0
    unlock_lead_s: float = 0.5
    relay_board: str = "generic"
    # A fire / evacuation hold is never ended by a timer. After this long it raises a visible fault instead.
    emergency_alarm_s: float = 4 * 3600.0
    # A fire hold that was on when the controller stopped is switched on again at start-up if it began less than
    # this long ago (0 = never restore).
    emergency_restore_max_s: float = 12 * 3600.0
    # At most this many non-emergency OPEN commands per window: a runaway or hostile portal cannot cycle the gate.
    open_rate_max: int = 30
    open_rate_window_s: float = 600.0

    @property
    def monitor_only(self) -> bool:
        return self.safety_pin is None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, need_token: bool = True) -> "Config":
        """need_token=False is for read-inputs only: it never contacts the portal, so it must not require (and an
        installer must not have to type onto a command line) the credential."""
        env = os.environ if env is None else env
        # systemd's EnvironmentFile= only treats "#" as a comment at the START of
        # a line: "RELAY_PIN=17  # note" hands the controller the whole text.
        for name in SETTINGS:
            if "#" in env.get(name, ""):
                raise ConfigError(f"{name} contains '#'. Put comments on their own line: systemd keeps "
                                  "everything after the '=' as the value")
        portal_url = _req(env, "PORTAL_URL").rstrip("/")
        parsed = urllib.parse.urlparse(portal_url)
        # Plain HTTP exists for the test suite only, and only to this machine: a stray line in an env file must never
        # send the bearer token across the network unencrypted.
        allow_http = env.get("ALLOW_INSECURE_HTTP_FOR_TESTS", "") == "1" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme != "https" and not (allow_http and parsed.scheme == "http"):
            raise ConfigError("PORTAL_URL must start with https://")
        if not parsed.netloc or parsed.username or parsed.password or parsed.path not in {"", "/"}:
            raise ConfigError("PORTAL_URL must be the site origin only, e.g. https://magickeys-balwyn-portal.com")

        gate_id = _req(env, "GATE_ID")
        if not GATE_ID_PATTERN.match(gate_id):
            raise ConfigError("GATE_ID must look like TF-ENTRY")

        token = ""
        if need_token:
            token = env.get("CONTROLLER_TOKEN", "").strip()
            token_file = env.get("CONTROLLER_TOKEN_FILE", "").strip()
            if token_file:
                _check_token_file_mode(token_file, env.get("CREDENTIALS_DIRECTORY", ""))
                try:
                    token = Path(token_file).read_text(encoding="utf-8").strip()
                except (OSError, UnicodeDecodeError) as error:
                    raise ConfigError(f"CONTROLLER_TOKEN_FILE cannot be read: {getattr(error, 'strerror', None) or type(error).__name__}") from error
            if len(token) < 32 or not token.isprintable() or " " in token:
                raise ConfigError("CONTROLLER_TOKEN (or CONTROLLER_TOKEN_FILE) must hold the credential issued by the portal")

        ca_file = env.get("CA_FILE", "").strip() or None
        if ca_file:
            try:
                with open(ca_file, "rb") as handle:
                    handle.read(1)
            except OSError as error:
                # Otherwise check-config passes and the service then crash-loops in the TLS set-up.
                raise ConfigError(f"CA_FILE cannot be read: {error.strerror}") from error

        pull = env.get("INPUT_PULL", "up").strip().lower()
        if pull not in {"up", "down", "off"}:
            raise ConfigError("INPUT_PULL must be up, down or off")

        safety_raw = env.get("SAFETY_INPUT", "").strip().lower()
        if safety_raw == "none":
            safety_pin = None
        else:
            safety_pin = _pin(env, "SAFETY_INPUT", required=True)

        relay_board = _relay_board(env)

        config = cls(
            portal_url=portal_url,
            gate_id=gate_id,
            token=token,
            relay_pin=_pin(env, "RELAY_PIN", required=True),  # type: ignore[arg-type]
            relay_active_low=_bool(env, "RELAY_ACTIVE_LOW"),
            closed_reed_pin=_pin(env, "CLOSED_REED_PIN", required=True),  # type: ignore[arg-type]
            open_reed_pin=_pin(env, "OPEN_REED_PIN", required=False),
            safety_pin=safety_pin,
            input_active_low=_bool(env, "INPUT_ACTIVE_LOW"),
            input_pull=pull,
            cycle_pulse_s=_num(env, "CYCLE_PULSE_S", 6.0, 0.3, MAX_PULSE_S),
            travel_timeout_s=_num(env, "TRAVEL_TIMEOUT_S", 30.0, 5.0, 120.0),
            auto_close_timeout_s=_num(env, "AUTO_CLOSE_TIMEOUT_S", 90.0, 10.0, 600.0),
            debounce_s=_num(env, "DEBOUNCE_S", 0.3, 0.05, 2.0),
            schedule_control=_bool(env, "SCHEDULE_CONTROL", default=True),
            hold_max_s=_num(env, "HOLD_MAX_S", 14 * 3600, 60.0, 24 * 3600),
            network_loss_release_s=_num(env, "NETWORK_LOSS_RELEASE_S", 300.0, 30.0, 3600.0),
            loop_stall_s=_num(env, "LOOP_STALL_S", 10.0, 2.0, 60.0),
            # systemd may pass several state directories separated by the OS path
            # separator (":" on Linux). Splitting on ":" unconditionally broke Windows
            # paths such as C:\...\Temp (it produced a relative folder named "C").
            state_dir=Path(env.get("STATE_DIRECTORY", "/var/lib/balwyn-gate").split(os.pathsep)[0]),
            dry_run=_bool(env, "DRY_RUN", default=False),
            ca_file=ca_file,
            unlock_relay_pin=_pin(env, "UNLOCK_RELAY_PIN", required=False),
            unlock_sense_pin=_pin(env, "UNLOCK_SENSE_PIN", required=False),
            unlock_pulse_s=_num(env, "UNLOCK_PULSE_S", 0.5, 0.3, MAX_UNLOCK_PULSE_S),
            unlock_confirm_timeout_s=_num(env, "UNLOCK_CONFIRM_TIMEOUT_S", 2.0, 0.5, 10.0),
            unlock_lead_s=_num(env, "UNLOCK_LEAD_S", 0.5, 0.0, 5.0),
            relay_board=relay_board,
            emergency_alarm_s=_num(env, "EMERGENCY_ALARM_S", 4 * 3600.0, 60.0, 48 * 3600.0),
            emergency_restore_max_s=_num(env, "EMERGENCY_RESTORE_MAX_S", 12 * 3600.0, 0.0, 48 * 3600.0),
            open_rate_max=int(_num(env, "OPEN_RATE_MAX", 30, 1, 1000)),
            open_rate_window_s=_num(env, "OPEN_RATE_WINDOW_S", 600.0, 60.0, 3600.0),
        )
        pins = [p for p in (config.relay_pin, config.closed_reed_pin, config.open_reed_pin, config.safety_pin,
                            config.unlock_relay_pin, config.unlock_sense_pin) if p is not None]
        if len(set(pins)) != len(pins):
            raise ConfigError("RELAY_PIN, CLOSED_REED_PIN, OPEN_REED_PIN, SAFETY_INPUT, UNLOCK_RELAY_PIN and "
                              "UNLOCK_SENSE_PIN must all be different pins")
        _check_relay_outputs(relay_board, config.relay_active_low,
                             {"RELAY_PIN": config.relay_pin, "UNLOCK_RELAY_PIN": config.unlock_relay_pin})
        if relay_board != "generic":
            reserved = set(RELAY_BOARDS[relay_board]["pins"])
            for name, pin in (("CLOSED_REED_PIN", config.closed_reed_pin), ("OPEN_REED_PIN", config.open_reed_pin),
                              ("SAFETY_INPUT", config.safety_pin), ("UNLOCK_SENSE_PIN", config.unlock_sense_pin)):
                if pin is not None and pin in reserved:
                    raise ConfigError(f"{name} must not be GPIO {pin}: on RELAY_BOARD={relay_board} that pin drives a relay")
        if config.travel_timeout_s <= config.cycle_pulse_s:
            raise ConfigError("TRAVEL_TIMEOUT_S must be longer than CYCLE_PULSE_S")
        return config
