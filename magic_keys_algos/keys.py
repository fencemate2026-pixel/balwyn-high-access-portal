"""Magic Keys file: loader, validator and board-compatibility checker.

Algorithm 5 (validation / reconciliation) lives here, and every other module
reads its pin map, timings and event table from the Keys object this builds.
Nothing else in this package hardcodes a pin, a duration or an event name.

Contract: config/magic-keys.json, schemaVersion 1.0.0 (project instructions s2/s8).

Fail-closed rule: any violation raises KeysError listing EVERY problem found,
not just the first, so one bench session can fix them all. A process that gets
KeysError must refuse to start.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, List, Mapping, Optional, Tuple

SCHEMA_VERSION = "1.0.0"
PULSE_DURATION_MS = 1500            # GPIO LOCK: not 1 s, not 2 s
KNOWN_ACTIONS = {"PULSE_DOOR", "INHIBIT_ALL_PULSES", "CLEAR_INHIBIT", "NOISE_ALERT"}
LEVELS = {"LOW", "HIGH"}
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
HEX_COLOUR = re.compile(r"^#[0-9A-Fa-f]{6}$")
DEFAULT_SECRET_FIELDS = ("hmac", "secret", "token", "password", "pin", "cardUid", "privateKey")


class KeysError(ValueError):
    """The keys file is unusable. str(error) lists every problem, one per line."""

    def __init__(self, problems: Iterable[str]) -> None:
        self.problems = list(problems)
        super().__init__("magic-keys.json rejected:\n  - " + "\n  - ".join(self.problems))


@dataclass(frozen=True)
class Door:
    id: str
    label: Optional[str]
    bcm_gpio: int
    acb_input: str
    house_colour_token: str
    enabled: bool
    lockdown_exempt: bool
    notes: Optional[str]


@dataclass(frozen=True)
class Keys:
    schema_version: str
    timezone: str
    pulse_duration_ms: int
    active_level: str
    recover_level: str
    min_retrigger_ms: int
    watchdog_ms: int
    doors: Tuple[Door, ...]
    allowed_pins: frozenset
    forbidden_pins: frozenset
    events: Mapping[str, Mapping[str, Any]]
    error_matrix: Mapping[str, Mapping[str, Any]]
    house_tokens: Mapping[str, Mapping[str, Any]]
    auth_env: Mapping[str, str]

    def door(self, door_id: Any) -> Optional[Door]:
        for door in self.doors:
            if door.id == door_id:
                return door
        return None


def _scan_raw_secrets(node: Any, forbidden: Iterable[str], path: str, problems: List[str]) -> None:
    """Reject any KEY whose lower-cased name is exactly a forbidden word.

    Exact match on purpose: "compassHmacEnv" (an env var NAME) and
    "houseColourToken" (a colour reference) are legal; a key literally called
    "secret" or "token" would hold a raw value and is not.
    """
    banned = {word.lower() for word in forbidden}
    if isinstance(node, Mapping):
        for key, value in node.items():
            here = f"{path}.{key}" if path else str(key)
            if str(key).lower() in banned:
                problems.append(f"raw secret field forbidden: {here}")
            _scan_raw_secrets(value, forbidden, here, problems)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            _scan_raw_secrets(value, forbidden, f"{path}[{index}]", problems)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def parse_keys(data: Any) -> Keys:
    """Validate a decoded magic-keys document and return an immutable Keys."""
    problems: List[str] = []
    if not isinstance(data, Mapping):
        raise KeysError(["top level must be a JSON object"])

    policy = data.get("secretsPolicy") if isinstance(data.get("secretsPolicy"), Mapping) else {}
    forbidden_fields = policy.get("rawSecretFieldsForbidden") or DEFAULT_SECRET_FIELDS
    _scan_raw_secrets({k: v for k, v in data.items() if k != "secretsPolicy"}, forbidden_fields, "", problems)

    if data.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion must be {SCHEMA_VERSION!r}, got {data.get('schemaVersion')!r}")

    campus = data.get("campus") if isinstance(data.get("campus"), Mapping) else {}
    timezone = campus.get("timezone")
    if not isinstance(timezone, str) or not timezone:
        problems.append("campus.timezone is required")

    pulse = data.get("pulse") if isinstance(data.get("pulse"), Mapping) else {}
    duration = pulse.get("durationMs")
    if duration != PULSE_DURATION_MS or not _is_int(duration):
        problems.append(f"pulse.durationMs must be exactly {PULSE_DURATION_MS}")
    active, recover = pulse.get("activeLevel"), pulse.get("recoverLevel")
    if active not in LEVELS or recover not in LEVELS or active == recover:
        problems.append("pulse.activeLevel and pulse.recoverLevel must be LOW/HIGH and opposite")
    retrigger, watchdog = pulse.get("minRetriggerMs"), pulse.get("watchdogMs")
    if not _is_int(retrigger) or not _is_int(duration) or retrigger < duration:
        problems.append("pulse.minRetriggerMs must be an integer >= pulse.durationMs")
    if not _is_int(watchdog) or not _is_int(duration) or watchdog <= duration:
        problems.append("pulse.watchdogMs must be an integer > pulse.durationMs")

    gpio = data.get("gpio") if isinstance(data.get("gpio"), Mapping) else {}
    allowed = gpio.get("allowedPins")
    forbidden = gpio.get("forbiddenPins")
    if gpio.get("mode") != "BCM":
        problems.append("gpio.mode must be BCM")
    if not isinstance(allowed, list) or not all(_is_int(p) for p in allowed or []) or not allowed:
        problems.append("gpio.allowedPins must be a non-empty list of integers")
        allowed = []
    if not isinstance(forbidden, list) or not all(_is_int(p) for p in forbidden or []):
        problems.append("gpio.forbiddenPins must be a list of integers")
        forbidden = []
    overlap = set(allowed) & set(forbidden)
    if overlap:
        problems.append(f"gpio.allowedPins overlaps forbiddenPins: {sorted(overlap)}")

    tokens = data.get("houseColourTokens") if isinstance(data.get("houseColourTokens"), Mapping) else {}
    for name, token in tokens.items():
        if not isinstance(token, Mapping) or not HEX_COLOUR.match(str(token.get("hex", ""))):
            problems.append(f"houseColourTokens.{name}.hex must be #RRGGBB")

    doors: List[Door] = []
    raw_doors = data.get("doors")
    if not isinstance(raw_doors, list) or len(raw_doors) != 4:
        problems.append("doors must be a list of exactly four entries")
        raw_doors = raw_doors if isinstance(raw_doors, list) else []
    seen_ids, seen_pins = set(), set()
    for index, raw in enumerate(raw_doors):
        if not isinstance(raw, Mapping):
            problems.append(f"doors[{index}] must be an object")
            continue
        door_id, pin = raw.get("id"), raw.get("bcmGpio")
        if not isinstance(door_id, str) or not door_id:
            problems.append(f"doors[{index}].id is required")
            continue
        if door_id in seen_ids:
            problems.append(f"duplicate door id {door_id}")
        seen_ids.add(door_id)
        if not _is_int(pin):
            problems.append(f"{door_id}.bcmGpio must be an integer")
            continue
        if pin in seen_pins:
            problems.append(f"{door_id}.bcmGpio {pin} is used by another door")
        seen_pins.add(pin)
        if pin in forbidden:
            problems.append(f"{door_id}.bcmGpio {pin} is in gpio.forbiddenPins")
        if pin not in allowed:
            problems.append(f"{door_id}.bcmGpio {pin} is not in gpio.allowedPins")
        token_name = raw.get("houseColourToken")
        if token_name not in tokens:
            problems.append(f"{door_id}.houseColourToken {token_name!r} is not defined in houseColourTokens")
        if not isinstance(raw.get("enabled"), bool) or not isinstance(raw.get("lockdownExempt"), bool):
            problems.append(f"{door_id}.enabled and .lockdownExempt must be booleans")
        doors.append(Door(door_id, raw.get("label"), pin, str(raw.get("acbInput")), str(token_name),
                          raw.get("enabled") is True, raw.get("lockdownExempt") is True, raw.get("notes")))

    webhooks = data.get("webhooks") if isinstance(data.get("webhooks"), Mapping) else {}
    events = webhooks.get("events") if isinstance(webhooks.get("events"), Mapping) else {}
    if not events:
        problems.append("webhooks.events is required")
    for name, spec in events.items():
        if not isinstance(spec, Mapping) or spec.get("action") not in KNOWN_ACTIONS:
            problems.append(f"webhooks.events.{name}.action must be one of {sorted(KNOWN_ACTIONS)}")
        elif not isinstance(spec.get("requiresDoorId"), bool):
            problems.append(f"webhooks.events.{name}.requiresDoorId must be a boolean")
    auth = webhooks.get("auth") if isinstance(webhooks.get("auth"), Mapping) else {}
    for name, env_name in auth.items():
        if not isinstance(env_name, str) or not ENV_NAME.match(env_name):
            problems.append(f"webhooks.auth.{name} must be an environment variable NAME (A-Z, 0-9, _)")

    matrix = data.get("errorMatrix") if isinstance(data.get("errorMatrix"), Mapping) else {}
    for name, row in matrix.items():
        amplitude = row.get("noiseAmplitude") if isinstance(row, Mapping) else None
        frequency = row.get("noiseFrequencyHz") if isinstance(row, Mapping) else None
        if not isinstance(amplitude, (int, float)) or isinstance(amplitude, bool) or not 0 <= amplitude <= 1:
            problems.append(f"errorMatrix.{name}.noiseAmplitude must be a number from 0 to 1")
        if not isinstance(frequency, (int, float)) or isinstance(frequency, bool) or frequency <= 0:
            problems.append(f"errorMatrix.{name}.noiseFrequencyHz must be a number > 0")
        if not isinstance(row, Mapping) or not row.get("canvasBind"):
            problems.append(f"errorMatrix.{name}.canvasBind is required")

    if problems:
        raise KeysError(problems)

    return Keys(
        schema_version=data["schemaVersion"], timezone=timezone, pulse_duration_ms=duration,
        active_level=active, recover_level=recover, min_retrigger_ms=retrigger, watchdog_ms=watchdog,
        doors=tuple(doors), allowed_pins=frozenset(allowed), forbidden_pins=frozenset(forbidden),
        events=dict(events), error_matrix=dict(matrix), house_tokens=dict(tokens), auth_env=dict(auth),
    )


def load_keys(path: str | Path) -> Keys:
    """Read and validate the keys file. A missing or non-JSON file is a KeysError, never a default."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise KeysError([f"cannot read {path}: {error.strerror}"]) from error
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise KeysError([f"{path} is not valid JSON: {error.msg} (line {error.lineno})"]) from error
    return parse_keys(data)


def board_compatibility(keys: Keys, relay_pins: Iterable[int], board_name: str = "relay board") -> List[str]:
    """Reconcile the keys file against a relay board whose drivable pins are known.

    Returns one problem per ENABLED door whose bcmGpio the board cannot drive.
    Empty list = every enabled door has a relay behind it. This exists because a
    schema that names a pin the board does not wire up passes every other check
    and then fails silently on site: the pulse "succeeds" into an unconnected pin.
    """
    wired = set(relay_pins)
    problems = []
    for door in keys.doors:
        if door.enabled and door.bcm_gpio not in wired:
            problems.append(f"{door.id}: BCM {door.bcm_gpio} is not a relay pin on {board_name} (relays: {sorted(wired)})")
    return problems


def cross_gate_clashes(pin_owners: Mapping[str, Iterable[int]], keys: Keys) -> List[str]:
    """Pins used both by this keys file's doors and by another process on the same Pi.

    pin_owners maps an owner name (e.g. "gate-controller TF-ENTRY") to its pins.
    Two processes driving one pin is the failure the deployed controller's
    pin_plan_clashes() already guards against between its own gates; this extends
    the same check to the keys-file doors.
    """
    problems = []
    for owner, pins in pin_owners.items():
        pins = set(pins)
        for door in keys.doors:
            if door.bcm_gpio in pins:
                problems.append(f"{door.id}: BCM {door.bcm_gpio} is also used by {owner}")
    return problems
