#!/usr/bin/env python3
"""Fail-safe Raspberry Pi dry-contact relay bridge for Balwyn gate controllers.

The bridge never powers a gate motor. It pulses dedicated OPEN/CLOSE dry-contact
inputs on an existing, correctly commissioned gate operator and requires local
safety and position feedback before reporting success.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lgpio

VERSION = "1.0.0"
LOG = logging.getLogger("balwyn-relay-agent")


def sd_notify(message: str) -> None:
    """Minimal systemd notify (READY=1 / WATCHDOG=1). No dependency; never raises.

    Same no-op-when-absent pattern as gate-controller/balwyn_gate_controller/sdnotify.py:
    silently does nothing outside systemd (tests, local runs) and never lets a
    notify failure take down the relay loop.
    """
    address = os.environ.get("NOTIFY_SOCKET")
    if not address or not hasattr(socket, "AF_UNIX"):
        return
    if address.startswith("@"):
        address = "\0" + address[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.connect(address)
            sock.sendall(message.encode("utf-8"))
    except OSError:
        pass


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

    @staticmethod
    def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)

    def state_payload(self) -> dict[str, Any]:
        return {"gateId": self.config.gate_id, **self.io.sensors(), "softwareVersion": VERSION, "scheduleControl": self.config.schedule_control}

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
            if command_id <= 0 or command not in {"open", "closed"} or phase not in {"accepted", "pulsed"}:
                raise ValueError("invalid execution journal")
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise RuntimeError("Execution journal is invalid; refusing automatic operation") from error

        sensors = self.io.sensors()
        if sensors["safetyOk"] and sensors["position"] == command:
            state = "acknowledged"
            detail = "Agent restarted during command handling; relay remained off and the independent limit input confirmed the requested position."
        elif not sensors["safetyOk"]:
            state = "blocked"
            detail = "Agent restarted during command handling; relay remained off and the local safety inputs require attention."
        else:
            state = "failed"
            detail = "Agent restarted during command handling; relay remained off and the command was not automatically repeated. Deliberate operator retry is required."
        await self.save_and_deliver_ack(command_id, state, sensors, detail)

    async def execute(self, command_id: int, command: str) -> None:
        if command not in {"open", "closed"}:
            await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), "Controller rejected an unsupported command without pulsing a relay.")
            return
        sensors = self.io.sensors()
        if not sensors["safetyOk"]:
            await self.save_and_deliver_ack(command_id, "blocked", sensors, "; ".join(sensors["faults"]))
            return
        if sensors["position"] == command:
            await self.save_and_deliver_ack(command_id, "acknowledged", sensors, "Position input already confirmed the requested state; relay was not pulsed.")
            return

        self.write_json_atomic(self.execution_journal_path, {"commandId": command_id, "command": command, "phase": "accepted"})
        LOG.warning("Pulsing dedicated %s dry-contact relay for command %s", command, command_id)
        try:
            await self.io.pulse(command)
        except Exception:  # noqa: BLE001 - any GPIO fault must become an explicit failed acknowledgement
            LOG.exception("Relay pulse failed for command %s", command_id)
            await self.save_and_deliver_ack(command_id, "failed", self.io.sensors(), "Relay pulse failed; outputs were de-energised and no automatic retry was attempted.")
            return
        self.write_json_atomic(self.execution_journal_path, {"commandId": command_id, "command": command, "phase": "pulsed"})
        deadline = asyncio.get_running_loop().time() + self.config.movement_timeout_seconds
        while asyncio.get_running_loop().time() < deadline and not self.stopping.is_set():
            sensors = self.io.sensors()
            if not sensors["safetyOk"]:
                await self.save_and_deliver_ack(command_id, "blocked", sensors, "; ".join(sensors["faults"]))
                return
            if sensors["position"] == command:
                await self.save_and_deliver_ack(command_id, "acknowledged", sensors, "Physical limit input confirmed the requested position.")
                return
            # A gate movement can run longer than WatchdogSec; ping here too so
            # systemd never kills a controller that is actively polling sensors.
            sd_notify("WATCHDOG=1")
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
                    await self.execute(int(command["id"]), str(command["command"]))
                sd_notify("WATCHDOG=1")
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


def relays_off() -> None:
    """systemd ExecStopPost: drive this gate's relays OFF whatever else is going on.

    Run after EVERY stop (clean exit, crash, `systemctl kill`, OOM kill) so a
    killed agent can never leave a relay energised. RelayIO claims both pins
    and calls all_off() in its own constructor, so building and closing it is
    the whole operation; it is intentionally synchronous (no asyncio loop) so
    it can run to completion even if the main process's event loop is the
    thing that is stuck.
    """
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = Config.load()
    io = RelayIO(config)
    io.close()
    LOG.info("relays-off: both relay outputs de-energised")


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = Config.load()
    agent = Agent(config)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, agent.stop)
    sd_notify("READY=1")
    try:
        await agent.run()
    finally:
        agent.io.close()


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "relays-off":
            relays_off()
        else:
            asyncio.run(main())
    except Exception as error:  # noqa: BLE001
        LOG.critical("Agent could not start safely: %s", error)
        sys.exit(1)
