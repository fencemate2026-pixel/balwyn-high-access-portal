#!/usr/bin/env python3
"""Fail-safe Raspberry Pi dry-contact relay bridge for Balwyn gate controllers.

The bridge never powers a gate motor. It pulses dedicated OPEN/CLOSE dry-contact
inputs on an existing, correctly commissioned gate operator and requires local
safety and position feedback before reporting success.

Fire / evacuation hold (AGENT-1, 18 Oct 2026, ported from
gate-controller/balwyn_gate_controller/controller.py — see its FAULT-REGISTER
items #2, #3, #32, #33):
  * the portal's command "source" (manual / schedule / emergency) is read and
    enforced, not dropped;
  * an open commanded with source "emergency" marks a fire/evacuation hold in
    effect (persisted to disk, restored after a restart up to
    EMERGENCY_RESTORE_MAX_S old) even though this agent's hardware has no
    continuous "hold" relay output of its own — the operator's own logic keeps
    the gate open, but this agent will not help end that state early;
  * while a hold is in effect, a "closed" command is executed ONLY if its
    source is "emergency" or "manual"; a "schedule" close (a window simply
    ending) is refused without touching the relay;
  * only an OPEN requires a healthy local safety input; a CLOSE is always the
    safe direction and is never refused for that reason, so a fire hold can
    still be ended while a safety device is tripped.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lgpio

VERSION = "1.0.0"
LOG = logging.getLogger("balwyn-relay-agent")

# Exactly the sources the portal can create (lib/portal-store.ts: queueGateCommands
# "manual" / "emergency", getOrCreateScheduledControllerCommand "schedule"). Mirrors
# gate-controller/balwyn_gate_controller/controller.py VALID_SOURCES. An unrecognised
# source is refused, never guessed at.
VALID_SOURCES = {"manual", "schedule", "emergency"}
# Who may end a fire / evacuation hold. A schedule window ending during a fire must
# not. Mirrors controller.py EMERGENCY_RELEASE_SOURCES (FAULT-REGISTER #3).
EMERGENCY_RELEASE_SOURCES = {"emergency", "manual"}


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required setting {name} is missing")
    return value


def required_bool(name: str) -> bool:
    value = required(name).lower()
    if value not in {"true", "false"}:
        raise RuntimeError(f"{name} must be exactly true or false")
    return value == "true"


def optional_float(name: str, default: float, low: float, high: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a number") from None
    if not low <= value <= high:
        raise RuntimeError(f"{name} must be between {low:g} and {high:g}")
    return value


@dataclass(frozen=True)
class Config:
    portal_url: str
    gate_id: str
    controller_token: str
    open_pin: int
    close_pin: int
    open_limit_pin: int
    closed_limit_pin: int
    safety_ok_pin: int
    estop_pin: int
    relay_active_low: bool
    input_active_low: bool
    input_bias: str
    pulse_seconds: float
    movement_timeout_seconds: float
    schedule_control: bool
    state_dir: Path
    # Fire / evacuation hold parity with gate-controller/balwyn_gate_controller
    # (FAULT-REGISTER #32/#33). emergency_restore_max_s bounds how old a
    # persisted hold may be and still be restored after a restart; older than
    # that, it is discarded and a physical check is logged as required instead
    # of silently trusting stale state. emergency_alarm_s is when a long-
    # standing hold starts being reported as a fault so staff notice it.
    emergency_restore_max_s: float
    emergency_alarm_s: float

    @classmethod
    def load(cls) -> "Config":
        config = cls(
            portal_url=required("PORTAL_URL").rstrip("/"),
            gate_id=required("GATE_ID"),
            controller_token=required("CONTROLLER_TOKEN"),
            open_pin=int(required("OPEN_RELAY_PIN")),
            close_pin=int(required("CLOSE_RELAY_PIN")),
            open_limit_pin=int(required("OPEN_LIMIT_PIN")),
            closed_limit_pin=int(required("CLOSED_LIMIT_PIN")),
            safety_ok_pin=int(required("SAFETY_OK_PIN")),
            estop_pin=int(required("ESTOP_PIN")),
            relay_active_low=required_bool("RELAY_ACTIVE_LOW"),
            input_active_low=required_bool("INPUT_ACTIVE_LOW"),
            input_bias=required("INPUT_BIAS").lower(),
            pulse_seconds=float(required("PULSE_SECONDS")),
            movement_timeout_seconds=float(required("MOVEMENT_TIMEOUT_SECONDS")),
            schedule_control=os.environ.get("ENABLE_SCHEDULE_CONTROL", "false").strip().lower() == "true",
            state_dir=Path(os.environ.get("STATE_DIRECTORY", "/var/lib/balwyn-relay-agent")),
            emergency_restore_max_s=optional_float("EMERGENCY_RESTORE_MAX_S", 12 * 3600.0, 0.0, 48 * 3600.0),
            emergency_alarm_s=optional_float("EMERGENCY_ALARM_S", 4 * 3600.0, 60.0, 48 * 3600.0),
        )
        pins = [config.open_pin, config.close_pin, config.open_limit_pin, config.closed_limit_pin, config.safety_ok_pin, config.estop_pin]
        if len(set(pins)) != len(pins):
            raise RuntimeError("Every relay and safety input must use a different GPIO pin")
        parsed_portal = urllib.parse.urlparse(config.portal_url)
        if parsed_portal.scheme != "https" or not parsed_portal.netloc or parsed_portal.username or parsed_portal.password:
            raise RuntimeError("PORTAL_URL must be an HTTPS origin without embedded credentials")
        if config.input_bias not in {"pull_up", "pull_down", "off"}:
            raise RuntimeError("INPUT_BIAS must be pull_up, pull_down or off")
        if not 0.2 <= config.pulse_seconds <= 3.0:
            raise RuntimeError("PULSE_SECONDS must be between 0.2 and 3.0")
        if not 5 <= config.movement_timeout_seconds <= 120:
            raise RuntimeError("MOVEMENT_TIMEOUT_SECONDS must be between 5 and 120")
        return config


class RelayIO:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.chip = lgpio.gpiochip_open(0)
        self.inactive = 1 if config.relay_active_low else 0
        self.active = 0 if config.relay_active_low else 1
        self.lock = asyncio.Lock()
        lgpio.gpio_claim_output(self.chip, config.open_pin, self.inactive)
        lgpio.gpio_claim_output(self.chip, config.close_pin, self.inactive)
        input_bias = {
            "pull_up": lgpio.SET_PULL_UP,
            "pull_down": lgpio.SET_PULL_DOWN,
            "off": lgpio.SET_PULL_NONE,
        }[config.input_bias]
        for pin in (config.open_limit_pin, config.closed_limit_pin, config.safety_ok_pin, config.estop_pin):
            lgpio.gpio_claim_input(self.chip, pin, input_bias)
        self.all_off()

    def _active_input(self, pin: int) -> bool:
        value = bool(lgpio.gpio_read(self.chip, pin))
        return not value if self.config.input_active_low else value

    def sensors(self) -> dict[str, Any]:
        is_open = self._active_input(self.config.open_limit_pin)
        is_closed = self._active_input(self.config.closed_limit_pin)
        safety_ok = self._active_input(self.config.safety_ok_pin)
        estop_active = self._active_input(self.config.estop_pin)
        faults: list[str] = []
        if is_open and is_closed:
            faults.append("Both open and closed position inputs are active")
        if not safety_ok:
            faults.append("Local safety circuit is not healthy")
        if estop_active:
            faults.append("Emergency stop is active")
        position = "open" if is_open and not is_closed else "closed" if is_closed and not is_open else "unknown"
        return {"position": position, "safetyOk": safety_ok and not estop_active and not faults, "faults": faults}

    def all_off(self) -> None:
        lgpio.gpio_write(self.chip, self.config.open_pin, self.inactive)
        lgpio.gpio_write(self.chip, self.config.close_pin, self.inactive)

    async def pulse(self, command: str) -> None:
        pin = self.config.open_pin if command == "open" else self.config.close_pin
        async with self.lock:
            self.all_off()
            lgpio.gpio_write(self.chip, pin, self.active)
            try:
                await asyncio.sleep(self.config.pulse_seconds)
            finally:
                self.all_off()

    def close(self) -> None:
        try:
            self.all_off()
        finally:
            lgpio.gpiochip_close(self.chip)


class PortalClient:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.ssl_context = ssl.create_default_context()

    def _request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.config.portal_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.config.controller_token}",
                "Content-Type": "application/json",
                "User-Agent": f"BalwynRelayAgent/{VERSION}",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15, context=self.ssl_context) as response:
            return json.loads(response.read().decode("utf-8"))

    async def request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._request, path, payload)


class Agent:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.io = RelayIO(config)
        self.portal = PortalClient(config)
        self.stopping = asyncio.Event()
        config.state_dir.mkdir(parents=True, exist_ok=True)
        self.pending_ack_path = config.state_dir / "pending-ack.json"
        self.execution_journal_path = config.state_dir / "execution-journal.json"
        # Fire / evacuation hold state (FAULT-REGISTER #32/#33 parity). Kept on
        # disk across restarts; see _load_emergency_hold / _set_emergency_hold.
        self.emergency_hold_path = config.state_dir / "emergency-hold.json"
        self.emergency_since: float | None = self._load_emergency_hold()
        self._emergency_alarm_reported = False

    @staticmethod
    def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)

    # ------------------------------------------------- fire / evacuation hold
    def _load_emergency_hold(self) -> float | None:
        """Restore a fire/evacuation hold recorded before a crash, update or power
        cut (FAULT-REGISTER #32). Only used to decide whether a later schedule
        close must still be refused — this agent has no continuous "hold" relay
        output; the physical gate operator's own logic governs how long it stays
        open. A restored hold older than emergency_restore_max_s is treated as
        stale and discarded instead of trusted indefinitely."""
        if not self.emergency_hold_path.exists():
            return None
        try:
            data = json.loads(self.emergency_hold_path.read_text(encoding="utf-8"))
            since = data["since"]
            if isinstance(since, bool) or not isinstance(since, (int, float)):
                raise ValueError("invalid since")
            since = float(since)
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            LOG.warning("Emergency hold record was unreadable and is being discarded: %s", error)
            self.emergency_hold_path.unlink(missing_ok=True)
            return None
        age = time.time() - since
        if not 0 <= age <= self.config.emergency_restore_max_s:
            LOG.warning(
                "Emergency hold record is %.0f s old (max %.0f s); not restoring it. "
                "If this gate is meant to still be held open for an evacuation, check it physically.",
                age, self.config.emergency_restore_max_s,
            )
            self.emergency_hold_path.unlink(missing_ok=True)
            return None
        LOG.warning(
            "Restoring a fire/evacuation hold recorded %.0f s ago. A schedule close will not "
            "end it; only an emergency or manual close will.", age,
        )
        return since

    def _set_emergency_hold(self, active: bool) -> None:
        """Remember (or forget) that a fire/evacuation hold is in effect. A disk
        error here is reported, never raised: persistence must never block or
        unwind a life-safety open, nor stop a legitimate close from proceeding."""
        if active:
            if self.emergency_since is None:
                self.emergency_since = time.time()
                self._emergency_alarm_reported = False
            try:
                self.write_json_atomic(self.emergency_hold_path, {"since": self.emergency_since})
            except OSError as error:
                LOG.error(
                    "Could not persist emergency hold state (%s). The hold is still in effect "
                    "for this process but will not survive a restart until this is fixed.", error,
                )
        else:
            self.emergency_since = None
            self._emergency_alarm_reported = False
            try:
                self.emergency_hold_path.unlink(missing_ok=True)
            except OSError as error:
                LOG.error(
                    "Could not clear persisted emergency hold state (%s). Delete %s manually "
                    "if a restart wrongly restores a hold that was actually ended.",
                    error, self.emergency_hold_path,
                )

    def state_payload(self) -> dict[str, Any]:
        sensors = self.io.sensors()
        faults = list(sensors["faults"])
        if self.emergency_since is not None:
            age_s = time.time() - self.emergency_since
            if age_s > self.config.emergency_alarm_s:
                faults.append(
                    f"Fire / evacuation hold has been in effect for {age_s / 3600.0:.1f} h. "
                    "Send the all-clear close when it is over."
                )
                if not self._emergency_alarm_reported:
                    self._emergency_alarm_reported = True
                    LOG.warning("Emergency hold on %s has been active for %.1f h", self.config.gate_id, age_s / 3600.0)
        return {
            "gateId": self.config.gate_id,
            "position": sensors["position"],
            "safetyOk": sensors["safetyOk"],
            "faults": faults,
            "softwareVersion": VERSION,
            "scheduleControl": self.config.schedule_control,
        }

    async def deliver_pending_ack(self) -> bool:
        if not self.pending_ack_path.exists():
            return True
        try:
            payload = json.loads(self.pending_ack_path.read_text(encoding="utf-8"))
            await self.portal.request(f"/api/controller/commands/{payload['commandId']}/ack", payload)
            self.pending_ack_path.unlink(missing_ok=True)
            return True
        except Exception as error:  # noqa: BLE001 - service must keep retrying safely
            LOG.warning("Acknowledgement delivery pending: %s", error)
            return False

    async def recover_interrupted_execution(self) -> None:
        if not self.execution_journal_path.exists():
            return
        self.io.all_off()
        if self.pending_ack_path.exists():
            self.execution_journal_path.unlink(missing_ok=True)
            return
        try:
            journal = json.loads(self.execution_journal_path.read_text(encoding="utf-8"))
            command_id = int(journal["commandId"])
            command = str(journal["command"])
            phase = str(journal["phase"])
            # "source" was added after this journal shape existed in the field; an
            # old record written before this fix simply has none, so default to
            # "manual" (the most conservative source — never auto-assumed to be
            # an emergency hold) rather than failing recovery outright.
            source = str(journal.get("source", "manual"))
            if command_id <= 0 or command not in {"open", "closed"} or phase not in {"accepted", "pulsed"}:
                raise ValueError("invalid execution journal")
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise RuntimeError("Execution journal is invalid; refusing automatic operation") from error

        sensors = self.io.sensors()
        if sensors["safetyOk"] and sensors["position"] == command:
            state = "acknowledged"
            detail = "Agent restarted during command handling; relay remained off and the independent limit input confirmed the requested position."
        elif not sensors["safetyOk"] and command == "open":
            # FAULT-REGISTER #2 parity: an unhealthy safety input only matters for
            # an open; a close is always the safe direction regardless of source.
            state = "blocked"
            detail = "Agent restarted during command handling; relay remained off and the local safety inputs require attention."
        else:
            state = "failed"
            detail = "Agent restarted during command handling; relay remained off and the command was not automatically repeated. Deliberate operator retry is required."
        LOG.info("Recovered an interrupted %s command (source: %s) as %s", command, source, state)
        await self.save_and_deliver_ack(command_id, state, sensors, detail)

    async def execute(self, command_id: int, command: str, source: str) -> None:
        if command not in {"open", "closed"}:
            await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), "Controller rejected an unsupported command without pulsing a relay.")
            return
        if source not in VALID_SOURCES:
            # Mirrors controller.py _handle(): an unrecognised source is refused, never guessed at.
            await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), f"Unsupported command source {source[:40]!r}; relay not operated.")
            return
        sensors = self.io.sensors()

        # FAULT-REGISTER #2 parity: releasing (closing) is always the safe direction,
        # so only an OPEN requires a healthy safety input — otherwise a fire hold
        # could never be ended while a safety device is tripped.
        if command == "open" and not sensors["safetyOk"]:
            await self.save_and_deliver_ack(command_id, "blocked", sensors, "; ".join(sensors["faults"]))
            return

        # FAULT-REGISTER #3/#32/#33 parity: a schedule window ending must never end
        # an active fire/evacuation hold. Only an emergency all-clear or a manual
        # close may. Checked, and cleared, before anything else about this close
        # is decided — exactly when controller.py's _handle() does it.
        if command == "closed" and self.emergency_since is not None:
            if source not in EMERGENCY_RELEASE_SOURCES:
                await self.save_and_deliver_ack(
                    command_id, "blocked", sensors,
                    f"Fire / evacuation hold kept: a {source} close cannot end it.",
                )
                return
            self._set_emergency_hold(False)

        if command == "open" and source == "emergency":
            # Marked before the relay is pulsed (and before the "already in
            # position" shortcut below), exactly as controller.py's _start_open
            # does for HOLD_SOURCES — so a close that arrives before this open is
            # confirmed still cannot end a hold that has already been accepted.
            self._set_emergency_hold(True)

        if sensors["position"] == command:
            await self.save_and_deliver_ack(command_id, "acknowledged", sensors, "Position input already confirmed the requested state; relay was not pulsed.")
            return

        self.write_json_atomic(self.execution_journal_path, {"commandId": command_id, "command": command, "source": source, "phase": "accepted"})
        LOG.warning("Pulsing dedicated %s dry-contact relay for command %s (source: %s)", command, command_id, source)
        try:
            await self.io.pulse(command)
        except Exception:  # noqa: BLE001 - any GPIO fault must become an explicit failed acknowledgement
            LOG.exception("Relay pulse failed for command %s", command_id)
            await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), "Relay pulse failed; outputs were de-energised and no automatic retry was attempted.")
            return
        self.write_json_atomic(self.execution_journal_path, {"commandId": command_id, "command": command, "source": source, "phase": "pulsed"})
        deadline = asyncio.get_running_loop().time() + self.config.movement_timeout_seconds
        while asyncio.get_running_loop().time() < deadline and not self.stopping.is_set():
            sensors = self.io.sensors()
            # FAULT-REGISTER #2 parity: only an open's confirmation wait is cut
            # short by an unhealthy safety input. A close that is already moving
            # is the safe direction and keeps waiting for its own confirmation
            # instead of being reported "blocked".
            if command == "open" and not sensors["safetyOk"]:
                await self.save_and_deliver_ack(command_id, "blocked", sensors, "; ".join(sensors["faults"]))
                return
            if sensors["position"] == command:
                await self.save_and_deliver_ack(command_id, "acknowledged", sensors, "Physical limit input confirmed the requested position.")
                return
            await asyncio.sleep(0.25)
        await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), "Timed out waiting for physical position confirmation.")

    async def save_and_deliver_ack(self, command_id: int, state: str, sensors: dict[str, Any], detail: str) -> None:
        payload = {"gateId": self.config.gate_id, "commandId": command_id, "state": state, "position": sensors["position"], "safetyOk": sensors["safetyOk"], "detail": detail}
        self.write_json_atomic(self.pending_ack_path, payload)
        self.execution_journal_path.unlink(missing_ok=True)
        await self.deliver_pending_ack()

    async def run(self) -> None:
        while not self.stopping.is_set():
            try:
                await self.recover_interrupted_execution()
                if not await self.deliver_pending_ack():
                    await asyncio.sleep(2)
                    continue
                response = await self.portal.request("/api/controller/commands", self.state_payload())
                command = response.get("command")
                if command:
                    # Default "manual" mirrors controller.py _handle(): command.get("source", "manual").
                    await self.execute(int(command["id"]), str(command["command"]), str(command.get("source", "manual")))
                await asyncio.sleep(max(0.5, min(float(response.get("pollAfterMs", 1500)) / 1000, 10)))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                LOG.warning("Portal unavailable; relays remain de-energised: %s", error)
                self.io.all_off()
                await asyncio.sleep(5)
            except Exception:
                LOG.exception("Controller loop fault; relays remain de-energised")
                self.io.all_off()
                await asyncio.sleep(5)

    def stop(self) -> None:
        self.stopping.set()
        self.io.all_off()


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = Config.load()
    agent = Agent(config)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, agent.stop)
    try:
        await agent.run()
    finally:
        agent.io.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001
        LOG.critical("Agent could not start safely: %s", error)
        sys.exit(1)
