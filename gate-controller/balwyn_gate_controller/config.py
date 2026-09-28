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
)


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
    if not raw.isdigit() or int(raw) not in VALID_PINS:
        raise ConfigError(f"{name} must be a BCM GPIO number between 2 and 27")
    return int(raw)


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

    @property
    def monitor_only(self) -> bool:
        return self.safety_pin is None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        env = os.environ if env is None else env
        # systemd's EnvironmentFile= only treats "#" as a comment at the START of
        # a line: "RELAY_PIN=17  # note" hands the controller the whole text.
        for name in SETTINGS:
            if "#" in env.get(name, ""):
                raise ConfigError(f"{name} contains '#'. Put comments on their own line: systemd keeps "
                                  "everything after the '=' as the value")
        portal_url = _req(env, "PORTAL_URL").rstrip("/")
        parsed = urllib.parse.urlparse(portal_url)
        allow_http = env.get("ALLOW_INSECURE_HTTP_FOR_TESTS", "") == "1"
        if parsed.scheme != "https" and not (allow_http and parsed.scheme == "http"):
            raise ConfigError("PORTAL_URL must start with https://")
        if not parsed.netloc or parsed.username or parsed.password or parsed.path not in {"", "/"}:
            raise ConfigError("PORTAL_URL must be the site origin only, e.g. https://magickeys-balwyn-portal.com")

        gate_id = _req(env, "GATE_ID")
        if not GATE_ID_PATTERN.match(gate_id):
            raise ConfigError("GATE_ID must look like TF-ENTRY")

        token = env.get("CONTROLLER_TOKEN", "").strip()
        token_file = env.get("CONTROLLER_TOKEN_FILE", "").strip()
        if token_file:
            try:
                token = Path(token_file).read_text(encoding="utf-8").strip()
            except OSError as error:
                raise ConfigError(f"CONTROLLER_TOKEN_FILE cannot be read: {error.strerror}") from error
        if len(token) < 32 or not token.isprintable() or " " in token:
            raise ConfigError("CONTROLLER_TOKEN (or CONTROLLER_TOKEN_FILE) must hold the credential issued by the portal")

        pull = env.get("INPUT_PULL", "up").strip().lower()
        if pull not in {"up", "down", "off"}:
            raise ConfigError("INPUT_PULL must be up, down or off")

        safety_raw = env.get("SAFETY_INPUT", "").strip().lower()
        if safety_raw == "none":
            safety_pin = None
        else:
            safety_pin = _pin(env, "SAFETY_INPUT", required=True)

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
            ca_file=env.get("CA_FILE", "").strip() or None,
        )
        pins = [p for p in (config.relay_pin, config.closed_reed_pin, config.open_reed_pin, config.safety_pin) if p is not None]
        if len(set(pins)) != len(pins):
            raise ConfigError("RELAY_PIN, CLOSED_REED_PIN, OPEN_REED_PIN and SAFETY_INPUT must all be different pins")
        if config.travel_timeout_s <= config.cycle_pulse_s:
            raise ConfigError("TRAVEL_TIMEOUT_S must be longer than CYCLE_PULSE_S")
        return config
