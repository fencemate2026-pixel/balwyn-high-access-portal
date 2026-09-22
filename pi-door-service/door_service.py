#!/usr/bin/env python3
"""Safe Raspberry Pi gate relay adapter with simulation-first defaults."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import signal
import socket
import sqlite3
import struct
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Any

LOG = logging.getLogger("compass-door-open")
VERSION = "2.0.0"
MODES = {"NORMAL", "LOCKDOWN", "EVACUATION", "MAINTENANCE", "DEMO"}
ROLE_ORDER = {"viewer": 1, "operator": 2, "administrator": 3}
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_gate_list(value: str, valid: set[int]) -> set[int]:
    if not value.strip():
        return set(valid)
    parsed = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        parsed.add(int(part))
    if not parsed or not parsed.issubset(valid):
        raise ValueError("Configured gate list includes unknown gate IDs")
    return parsed


def parse_token(name: str, value: str) -> str:
    if not value:
        return ""
    if len(value) < 32 or not value.isascii() or any(ch.isspace() for ch in value) or value.startswith("REPLACE_"):
        raise ValueError(f"{name} must be an ASCII token of at least 32 characters")
    return value


def canonical_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


class Role(str, Enum):
    VIEWER = "viewer"
    OPERATOR = "operator"
    ADMIN = "administrator"


@dataclass(frozen=True)
class Config:
    pins: tuple[int, ...]
    pulse_ms: int = 500
    cooldown_ms: int = 1000
    active_low: bool = True
    chip: int = 0
    journal: str = "door-open-state.sqlite3"
    hardware_enabled: bool = False
    mode: str = "DEMO"
    worker_count: int = 2
    worker_queue_size: int = 16
    heartbeat_ttl_seconds: int = 45
    allow_anonymous_telemetry: bool = True
    max_body_bytes: int = 8192
    max_ws_message_bytes: int = 4096
    allowed_origins: tuple[str, ...] = ()
    commissioned_gates: tuple[int, ...] = ()
    viewer_token: str = ""
    operator_token: str = ""
    admin_token: str = ""
    webhook_secret: str = ""
    webhook_max_skew_seconds: int = 120
    webhook_debounce_seconds: int = 5

    def __post_init__(self):
        if len(self.pins) != 4 or len(set(self.pins)) != 4 or any(type(p) is not int or not 2 <= p <= 27 for p in self.pins):
            raise ValueError("DOOR_GPIO_PINS requires four distinct BCM pins in gate 1,2,3,4 order (2..27)")
        if type(self.pulse_ms) is not int or not 300 <= self.pulse_ms <= 800:
            raise ValueError("DOOR_PULSE_MS must be an integer between 300 and 800")
        if type(self.cooldown_ms) is not int or not 100 <= self.cooldown_ms <= 60000:
            raise ValueError("DOOR_COOLDOWN_MS must be between 100 and 60000")
        if self.mode not in MODES:
            raise ValueError("DOOR_MODE must be one of NORMAL, LOCKDOWN, EVACUATION, MAINTENANCE, DEMO")
        if type(self.active_low) is not bool or type(self.chip) is not int or self.chip < 0:
            raise ValueError("Invalid GPIO polarity or chip")
        if type(self.worker_count) is not int or not 1 <= self.worker_count <= 8:
            raise ValueError("DOOR_WORKER_COUNT must be between 1 and 8")
        if type(self.worker_queue_size) is not int or not 1 <= self.worker_queue_size <= 128:
            raise ValueError("DOOR_WORKER_QUEUE_SIZE must be between 1 and 128")
        if type(self.heartbeat_ttl_seconds) is not int or not 5 <= self.heartbeat_ttl_seconds <= 600:
            raise ValueError("DOOR_HEARTBEAT_TTL_SECONDS must be between 5 and 600")
        if type(self.max_body_bytes) is not int or not 512 <= self.max_body_bytes <= 1_000_000:
            raise ValueError("DOOR_MAX_BODY_BYTES must be between 512 and 1000000")
        if type(self.max_ws_message_bytes) is not int or not 128 <= self.max_ws_message_bytes <= 100_000:
            raise ValueError("DOOR_MAX_WS_MESSAGE_BYTES must be between 128 and 100000")
        for key, token in {
            "DOOR_VIEWER_TOKEN": self.viewer_token,
            "DOOR_OPERATOR_TOKEN": self.operator_token,
            "DOOR_ADMIN_TOKEN": self.admin_token,
        }.items():
            parse_token(key, token)
        if self.hardware_enabled:
            if not self.operator_token and not self.admin_token:
                raise ValueError("Live hardware requires operator/admin service tokens")
            if not self.webhook_secret:
                raise ValueError("Live hardware requires COMPASS_WEBHOOK_SECRET")
        if self.webhook_secret:
            parse_token("COMPASS_WEBHOOK_SECRET", self.webhook_secret)

    @classmethod
    def from_env(cls):
        hardware_enabled = env_bool("HARDWARE_ENABLED", False)
        mode = os.environ.get("DOOR_MODE", "DEMO").upper()
        if mode == "HARDWARE":
            mode = "NORMAL"
            hardware_enabled = True
        viewer = os.environ.get("DOOR_VIEWER_TOKEN", "")
        operator = os.environ.get("DOOR_OPERATOR_TOKEN", "") or os.environ.get("DOOR_API_TOKEN", "")
        admin = os.environ.get("DOOR_ADMIN_TOKEN", "")
        pins = tuple(int(p.strip()) for p in os.environ.get("DOOR_GPIO_PINS", "17,27,22,23").split(","))
        valid_gates = set(range(1, len(pins) + 1))
        commissioned = parse_gate_list(os.environ.get("DOOR_COMMISSIONED_GATES", ""), valid_gates)
        origins = tuple(filter(None, (origin.strip() for origin in os.environ.get("DOOR_ALLOWED_ORIGINS", "").split(","))))
        for origin in origins:
            if origin.endswith("/") or "/" in origin.split("://", 1)[-1]:
                raise ValueError("DOOR_ALLOWED_ORIGINS entries must be origins without trailing slash or path")
        return cls(
            pins=pins,
            pulse_ms=int(os.environ.get("DOOR_PULSE_MS", "500")),
            cooldown_ms=int(os.environ.get("DOOR_COOLDOWN_MS", "1000")),
            mode=mode,
            active_low=os.environ.get("DOOR_ACTIVE_LOW", "true").strip().lower() == "true",
            chip=int(os.environ.get("DOOR_GPIO_CHIP", "0")),
            journal=os.environ.get("DOOR_JOURNAL", "door-open-state.sqlite3"),
            hardware_enabled=hardware_enabled,
            worker_count=int(os.environ.get("DOOR_WORKER_COUNT", "2")),
            worker_queue_size=int(os.environ.get("DOOR_WORKER_QUEUE_SIZE", "16")),
            heartbeat_ttl_seconds=int(os.environ.get("DOOR_HEARTBEAT_TTL_SECONDS", "45")),
            allow_anonymous_telemetry=env_bool("DOOR_ALLOW_ANON_TELEMETRY", True),
            max_body_bytes=int(os.environ.get("DOOR_MAX_BODY_BYTES", "8192")),
            max_ws_message_bytes=int(os.environ.get("DOOR_MAX_WS_MESSAGE_BYTES", "4096")),
            allowed_origins=origins,
            commissioned_gates=tuple(sorted(commissioned)),
            viewer_token=viewer,
            operator_token=operator,
            admin_token=admin,
            webhook_secret=os.environ.get("COMPASS_WEBHOOK_SECRET", ""),
            webhook_max_skew_seconds=int(os.environ.get("COMPASS_WEBHOOK_MAX_SKEW_SECONDS", "120")),
            webhook_debounce_seconds=int(os.environ.get("COMPASS_WEBHOOK_DEBOUNCE_SECONDS", "5")),
        )


class MockOutputs:
    def __init__(self, config: Config):
        self.states = {pin: False for pin in config.pins}

    def write(self, pin: int, active: bool):
        self.states[pin] = active

    def close(self):
        for pin in self.states:
            self.write(pin, False)


class GpioOutputs:
    def __init__(self, config: Config):
        import lgpio

        self.gpio, self.config, self.claimed = lgpio, config, []
        self.handle = lgpio.gpiochip_open(config.chip)
        try:
            for pin in config.pins:
                lgpio.gpio_claim_output(self.handle, pin, int(config.active_low))
                self.claimed.append(pin)
        except BaseException:
            self.close()
            raise

    def write(self, pin: int, active: bool):
        level = int(not active) if self.config.active_low else int(active)
        self.gpio.gpio_write(self.handle, pin, level)

    def close(self):
        error = None
        for pin in self.claimed:
            try:
                self.write(pin, False)
                self.gpio.gpio_free(self.handle, pin)
            except Exception as exc:  # noqa: BLE001
                error = exc
        self.claimed.clear()
        self.gpio.gpiochip_close(self.handle)
        if error:
            raise RuntimeError("GPIO cleanup failed; inspect relay outputs locally") from error


@dataclass(frozen=True)
class Actor:
    role: Role
    identity: str
    source: str


class AuthManager:
    def __init__(self, config: Config):
        self.tokens = {
            config.viewer_token: Actor(Role.VIEWER, "token:viewer", "api"),
            config.operator_token: Actor(Role.OPERATOR, "token:operator", "api"),
            config.admin_token: Actor(Role.ADMIN, "token:administrator", "api"),
        }
        self.tokens = {token: actor for token, actor in self.tokens.items() if token}

    def authenticate_header(self, value: str | None) -> Actor | None:
        if not value:
            return None
        match = re.fullmatch(r"Bearer\s+(.+)", value.strip())
        if not match:
            return None
        token = match.group(1)
        for known, actor in self.tokens.items():
            if hmac.compare_digest(token.encode(), known.encode()):
                return actor
        return None

    @staticmethod
    def allows(actor: Actor | None, required: Role) -> bool:
        if actor is None:
            return False
        return ROLE_ORDER[actor.role.value] >= ROLE_ORDER[required.value]


class TelemetryHub:
    def __init__(self, max_queue: int = 64):
        self.max_queue = max_queue
        self.lock = threading.Lock()
        self.clients: dict[int, Queue[str]] = {}
        self.next_id = 1

    def register(self) -> tuple[int, Queue[str]]:
        with self.lock:
            client_id = self.next_id
            self.next_id += 1
            queue: Queue[str] = Queue(self.max_queue)
            self.clients[client_id] = queue
            return client_id, queue

    def unregister(self, client_id: int):
        with self.lock:
            self.clients.pop(client_id, None)

    def broadcast(self, event: dict[str, Any]):
        payload = json.dumps(event, separators=(",", ":"))
        stale: list[int] = []
        with self.lock:
            for client_id, queue in self.clients.items():
                try:
                    queue.put_nowait(payload)
                except Full:
                    stale.append(client_id)
            for client_id in stale:
                self.clients.pop(client_id, None)


class GatePolicy:
    def __init__(self, config: Config):
        self.config = config
        self.lock = threading.Lock()
        self.mode = config.mode
        self.stopping = False
        self.faulted = False
        self.inflight: set[int] = set()
        self.cooldown_until: dict[int, float] = {gate: 0.0 for gate in range(1, len(config.pins) + 1)}
        self.last_heartbeat: dict[int, float | None] = {gate: None for gate in range(1, len(config.pins) + 1)}
        default_ready = not config.hardware_enabled
        self.ready: dict[int, bool] = {gate: default_ready for gate in range(1, len(config.pins) + 1)}
        self.commissioned = set(config.commissioned_gates) or set(range(1, len(config.pins) + 1))
        self.emergency_action: str | None = None

    def status(self) -> dict[str, Any]:
        with self.lock:
            heartbeat = [value for value in self.last_heartbeat.values() if value is not None]
            last = max(heartbeat) if heartbeat else None
            interlocks_healthy = not self.faulted and not self.stopping
            return {
                "mode": self.mode,
                "interlocksHealthy": interlocks_healthy,
                "lastHeartbeat": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last)) if last else None,
            }

    def normalize_gate(self, gate: Any) -> int:
        if isinstance(gate, str) and gate.isdigit():
            gate = int(gate)
        if not isinstance(gate, int):
            raise ValueError("ERR_INVALID_GATE_ID")
        if gate not in range(1, len(self.config.pins) + 1):
            raise ValueError("ERR_UNKNOWN_GATE")
        return gate

    def update_heartbeat(self, gate: Any, healthy: bool):
        gate_id = self.normalize_gate(gate)
        with self.lock:
            self.last_heartbeat[gate_id] = time.time()
            self.ready[gate_id] = bool(healthy)

    def set_mode(self, mode: str, actor: Actor, confirm: bool, reason: str) -> tuple[bool, str]:
        mode = mode.upper()
        if mode not in MODES:
            return False, "ERR_INVALID_MODE"
        if mode in {"LOCKDOWN", "EVACUATION", "MAINTENANCE"}:
            if not AuthManager.allows(actor, Role.ADMIN):
                return False, "ERR_FORBIDDEN"
            if not confirm or not reason.strip():
                return False, "ERR_CONFIRMATION_REQUIRED"
        with self.lock:
            if self.emergency_action and mode in {"LOCKDOWN", "EVACUATION"} and self.mode != mode:
                return False, "ERR_EMERGENCY_CONFLICT"
            self.mode = mode
        return True, "OK"

    def begin_pulse(self, gate: int, source: str, maintenance_path: bool = False) -> tuple[bool, str]:
        now = time.time()
        with self.lock:
            if self.stopping or self.faulted:
                return False, "ERR_SERVICE_UNAVAILABLE"
            if gate not in self.commissioned:
                return False, "ERR_GATE_NOT_COMMISSIONED"
            if self.mode == "LOCKDOWN":
                return False, "ERR_MODE_LOCKDOWN"
            if self.mode == "MAINTENANCE" and source == "webhook" and not maintenance_path:
                return False, "ERR_MODE_MAINTENANCE"
            if source == "webhook" and self.mode == "EVACUATION":
                return False, "ERR_MODE_EVACUATION"
            if gate in self.inflight:
                return False, "ERR_PULSE_IN_FLIGHT"
            if self.cooldown_until[gate] > now:
                return False, "ERR_COOLDOWN"
            if self.config.hardware_enabled:
                heartbeat = self.last_heartbeat.get(gate)
                if not self.ready.get(gate, False):
                    return False, "ERR_GATE_UNREADY"
                if heartbeat is None or now - heartbeat > self.config.heartbeat_ttl_seconds:
                    return False, "ERR_STALE_HEARTBEAT"
            self.inflight.add(gate)
            return True, "OK"

    def finish_pulse(self, gate: int):
        with self.lock:
            self.inflight.discard(gate)
            self.cooldown_until[gate] = time.time() + (self.config.cooldown_ms / 1000)

    def mark_fault(self):
        with self.lock:
            self.faulted = True

    def stop(self):
        with self.lock:
            self.stopping = True


class BoundedExecutor:
    def __init__(self, workers: int, queue_size: int):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="door-worker")
        self.slots = threading.Semaphore(workers + queue_size)

    def submit(self, fn, *args, **kwargs) -> Future | None:
        if not self.slots.acquire(blocking=False):
            return None
        future = self.pool.submit(fn, *args, **kwargs)

        def release(_):
            self.slots.release()

        future.add_done_callback(release)
        return future

    def shutdown(self):
        self.pool.shutdown(wait=True, cancel_futures=False)


class DoorController:
    def __init__(self, config: Config, outputs=None):
        self.config = config
        self.outputs = outputs or (GpioOutputs(config) if config.hardware_enabled else MockOutputs(config))
        self.auth = AuthManager(config)
        self.policy = GatePolicy(config)
        self.telemetry = TelemetryHub()
        self.executor = BoundedExecutor(config.worker_count, config.worker_queue_size)
        self.db_lock = threading.Lock()
        self.webhook_seen: dict[str, float] = {}
        self.webhook_last_gate_fire: dict[int, float] = {}
        self.close_lock = threading.Lock()
        try:
            Path(config.journal).parent.mkdir(parents=True, exist_ok=True)
            with self.database() as db:
                db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, gate INTEGER NOT NULL, result TEXT)")
                db.execute("CREATE TABLE IF NOT EXISTS mode_requests (id TEXT PRIMARY KEY, result TEXT)")
                db.execute("CREATE TABLE IF NOT EXISTS audit (at REAL NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL)")
            os.chmod(config.journal, 0o600)
        except BaseException:
            self.outputs.close()
            raise

    @property
    def simulation(self) -> bool:
        return not self.config.hardware_enabled

    @contextmanager
    def database(self):
        db = sqlite3.connect(self.config.journal, timeout=2)
        try:
            with db:
                yield db
        finally:
            db.close()

    def audit(self, event: str, **details):
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "event": event,
            "simulation": self.simulation,
            **details,
        }
        safe = {key: value for key, value in record.items() if "token" not in key.lower() and "secret" not in key.lower()}
        LOG.info("audit %s", json.dumps(safe, separators=(",", ":"), sort_keys=True))
        with self.db_lock:
            with self.database() as db:
                db.execute("INSERT INTO audit (at, event, details) VALUES (?, ?, ?)", (time.time(), event, json.dumps(safe)))

    def service_status(self) -> dict[str, Any]:
        status = self.policy.status()
        return {
            "status": "ok" if status["interlocksHealthy"] else "degraded",
            "mode": status["mode"],
            "hardwareEnabled": self.config.hardware_enabled,
            "simulation": self.simulation,
            "gpioAvailable": self.config.hardware_enabled,
            "interlocksHealthy": status["interlocksHealthy"],
            "lastHeartbeat": status["lastHeartbeat"],
            "version": VERSION,
            "webhookEnabled": bool(self.config.webhook_secret),
        }

    def _reserve_request(self, gate: int, request_id: str) -> tuple[int | None, dict[str, Any] | None]:
        with self.db_lock:
            with self.database() as db:
                row = db.execute("SELECT gate, result FROM requests WHERE id = ?", (request_id,)).fetchone()
                if row:
                    if row[0] != gate or row[1] is None:
                        return 409, {"code": "ERR_REQUEST_CONFLICT", "error": "Request already reserved"}
                    code, payload = json.loads(row[1])
                    payload["replayed"] = True
                    return code, payload
                db.execute("INSERT INTO requests (id, gate) VALUES (?, ?)", (request_id, gate))
        return None, None

    def _store_result(self, request_id: str, code: int, payload: dict[str, Any]):
        with self.db_lock:
            with self.database() as db:
                db.execute("UPDATE requests SET result = ? WHERE id = ?", (json.dumps([code, payload]), request_id))

    def _pulse_job(self, gate: int, actor: Actor, source: str, correlation_id: str, cancel_event: threading.Event) -> tuple[int, dict[str, Any]]:
        pin = self.config.pins[gate - 1]
        self.audit("pulse_requested", actor=actor.identity, role=actor.role.value, source=source, gateId=gate, correlationId=correlation_id)
        try:
            if cancel_event.is_set():
                raise RuntimeError("Cancelled before pulse")
            try:
                self.outputs.write(pin, True)
                deadline = time.monotonic() + (self.config.pulse_ms / 1000)
                while time.monotonic() < deadline:
                    if cancel_event.is_set():
                        raise RuntimeError("Cancelled during pulse")
                    time.sleep(min(0.05, max(0, deadline - time.monotonic())))
            finally:
                self.outputs.write(pin, False)
            payload = {
                "status": "pulsed" if self.config.hardware_enabled else "dry_run",
                "door": gate,
                "pulse_ms": self.config.pulse_ms,
                "position": "unknown",
                "sensor_feedback": False,
                "request_id": correlation_id,
                "code": "OK",
            }
            self.audit("pulse_completed", actor=actor.identity, source=source, gateId=gate, correlationId=correlation_id, result="accepted")
            self.telemetry.broadcast({"type": "pulse", "gateId": gate, "result": payload["status"], "simulation": self.simulation})
            return 200, payload
        except Exception as exc:  # noqa: BLE001
            self.policy.mark_fault()
            self.audit("pulse_failed", actor=actor.identity, source=source, gateId=gate, correlationId=correlation_id, reasonCode="ERR_PULSE_FAILED")
            return 503, {"code": "ERR_PULSE_FAILED", "error": "Pulse failed or interrupted; physical outcome unknown"}
        finally:
            self.policy.finish_pulse(gate)

    def request_pulse(self, gate_raw: Any, actor: Actor, source: str, request_id: str, maintenance_path: bool = False) -> tuple[int, dict[str, Any]]:
        if not canonical_uuid(request_id):
            return 400, {"code": "ERR_INVALID_REQUEST_ID", "error": "A canonical UUID Idempotency-Key is required"}
        try:
            gate = self.policy.normalize_gate(gate_raw)
        except ValueError as exc:
            code = str(exc)
            return (404 if code == "ERR_UNKNOWN_GATE" else 400), {"code": code, "error": "Invalid gate ID"}
        replay_status, replay_payload = self._reserve_request(gate, request_id)
        if replay_status is not None:
            self.audit("command_denied", actor=actor.identity, source=source, gateId=gate, correlationId=request_id, reasonCode=replay_payload.get("code", "ERR_REQUEST_CONFLICT"))
            return replay_status, replay_payload

        allowed, reason = self.policy.begin_pulse(gate, source=source, maintenance_path=maintenance_path)
        if not allowed:
            payload = {"code": reason, "error": "Pulse denied by interlocks"}
            self._store_result(request_id, 409 if reason in {"ERR_PULSE_IN_FLIGHT", "ERR_COOLDOWN"} else 503, payload)
            self.audit("command_denied", actor=actor.identity, source=source, gateId=gate, correlationId=request_id, reasonCode=reason)
            return (409 if reason in {"ERR_PULSE_IN_FLIGHT", "ERR_COOLDOWN"} else 503), payload

        cancel_event = threading.Event()
        future = self.executor.submit(self._pulse_job, gate, actor, source, request_id, cancel_event)
        if future is None:
            self.policy.finish_pulse(gate)
            payload = {"code": "ERR_WORKER_SATURATED", "error": "Worker queue is saturated; command rejected"}
            self._store_result(request_id, 503, payload)
            self.audit("command_denied", actor=actor.identity, source=source, gateId=gate, correlationId=request_id, reasonCode="ERR_WORKER_SATURATED")
            return 503, payload
        try:
            code, payload = future.result(timeout=max(2, self.config.pulse_ms / 1000 + 1))
        except TimeoutError:
            cancel_event.set()
            future.cancel()
            self.policy.mark_fault()
            payload = {"code": "ERR_EXECUTION_TIMEOUT", "error": "Pulse execution timeout; outcome unknown"}
            self._store_result(request_id, 503, payload)
            self.audit("pulse_failed", actor=actor.identity, source=source, gateId=gate, correlationId=request_id, reasonCode="ERR_EXECUTION_TIMEOUT")
            return 503, payload
        except Exception:  # noqa: BLE001
            cancel_event.set()
            self.policy.mark_fault()
            payload = {"code": "ERR_EXECUTION_FAILED", "error": "Pulse execution failed before completion"}
            self._store_result(request_id, 503, payload)
            self.audit("pulse_failed", actor=actor.identity, source=source, gateId=gate, correlationId=request_id, reasonCode="ERR_EXECUTION_FAILED")
            return 503, payload
        self._store_result(request_id, code, payload)
        return code, payload

    def set_mode(self, actor: Actor, mode: str, confirm: bool, reason: str, correlation_id: str) -> tuple[int, dict[str, Any]]:
        if canonical_uuid(correlation_id):
            with self.db_lock:
                with self.database() as db:
                    existing = db.execute("SELECT result FROM mode_requests WHERE id = ?", (correlation_id,)).fetchone()
                    if existing:
                        if existing[0] is None:
                            return 409, {"code": "ERR_REQUEST_CONFLICT", "error": "Request already reserved"}
                        code, payload = json.loads(existing[0])
                        return code, payload
                    db.execute("INSERT INTO mode_requests (id, result) VALUES (?, ?)", (correlation_id, None))
        allowed, result = self.policy.set_mode(mode, actor, confirm, reason)
        if not allowed:
            self.audit("mode_change_denied", actor=actor.identity, source="ws", requestedMode=mode, reasonCode=result, correlationId=correlation_id)
            code = 403 if result == "ERR_FORBIDDEN" else 400
            payload = {"code": result, "error": "Mode change denied"}
            if canonical_uuid(correlation_id):
                with self.db_lock:
                    with self.database() as db:
                        db.execute("UPDATE mode_requests SET result = ? WHERE id = ?", (json.dumps([code, payload]), correlation_id))
            return code, payload
        self.audit("mode_change_completed", actor=actor.identity, source="ws", requestedMode=mode, correlationId=correlation_id)
        self.telemetry.broadcast({"type": "mode", "mode": mode, "simulation": self.simulation})
        payload = {"code": "OK", "mode": mode}
        if canonical_uuid(correlation_id):
            with self.db_lock:
                with self.database() as db:
                    db.execute("UPDATE mode_requests SET result = ? WHERE id = ?", (json.dumps([200, payload]), correlation_id))
        return 200, payload

    def process_webhook(self, headers: Any, body: bytes, request_id: str) -> tuple[int, dict[str, Any]]:
        if not self.config.webhook_secret:
            return 503, {"code": "ERR_WEBHOOK_DISABLED", "error": "Webhook integration is disabled"}
        if len(body) > self.config.max_body_bytes:
            return 413, {"code": "ERR_BODY_TOO_LARGE", "error": "Payload too large"}
        content_type = (headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            return 415, {"code": "ERR_UNSUPPORTED_CONTENT_TYPE", "error": "application/json required"}

        timestamp = headers.get("X-Compass-Timestamp", "")
        signature = headers.get("X-Compass-Signature", "")
        if not timestamp.isdigit() or not re.fullmatch(r"[0-9a-f]{64}", signature.lower()):
            return 401, {"code": "ERR_WEBHOOK_AUTH", "error": "Invalid webhook signature"}
        now = int(time.time())
        stamp = int(timestamp)
        if abs(now - stamp) > self.config.webhook_max_skew_seconds:
            return 401, {"code": "ERR_WEBHOOK_STALE", "error": "Stale webhook timestamp"}
        digest = hmac.new(self.config.webhook_secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(digest.encode(), signature.lower().encode()):
            return 401, {"code": "ERR_WEBHOOK_AUTH", "error": "Invalid webhook signature"}

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return 400, {"code": "ERR_INVALID_JSON", "error": "Malformed JSON"}
        if not isinstance(payload, dict):
            return 400, {"code": "ERR_INVALID_SCHEMA", "error": "JSON object required"}
        if payload.get("eventType") not in {"gate_open_request"}:
            return 400, {"code": "ERR_EVENT_NOT_ALLOWED", "error": "Unsupported event type"}
        if payload.get("authorized") is not True:
            return 403, {"code": "ERR_UNAUTHORIZED_EVENT", "error": "Event not authorized"}
        if "gateId" not in payload:
            return 400, {"code": "ERR_INVALID_SCHEMA", "error": "gateId required"}

        try:
            gate = self.policy.normalize_gate(payload["gateId"])
        except ValueError as exc:
            return 400, {"code": str(exc), "error": "Invalid gate"}

        replay_key = f"{timestamp}:{signature.lower()}"
        with self.close_lock:
            if replay_key in self.webhook_seen:
                return 409, {"code": "ERR_WEBHOOK_REPLAY", "error": "Replay denied"}
            self.webhook_seen[replay_key] = time.time()
            cutoff = time.time() - self.config.webhook_max_skew_seconds
            for key, seen_at in list(self.webhook_seen.items()):
                if seen_at < cutoff:
                    del self.webhook_seen[key]

        now = time.time()
        recent = self.webhook_last_gate_fire.get(gate, 0)
        if now - recent < self.config.webhook_debounce_seconds:
            return 429, {"code": "ERR_WEBHOOK_DEBOUNCE", "error": "Repeated trigger blocked"}

        actor = Actor(Role.OPERATOR, "service:compass-webhook", "webhook")
        pulse_code, pulse_payload = self.request_pulse(gate, actor, source="webhook", request_id=request_id)
        if pulse_code >= 400:
            self.audit("webhook_denied", actor=actor.identity, source="webhook", gateId=gate, correlationId=request_id, reasonCode=pulse_payload.get("code"))
            return pulse_code, {"code": pulse_payload.get("code", "ERR_DENIED"), "error": pulse_payload.get("error", "Webhook denied"), "result": "denied"}
        self.webhook_last_gate_fire[gate] = time.time()
        self.audit("webhook_processed", actor=actor.identity, source="webhook", gateId=gate, correlationId=request_id, result="accepted")
        return 202, {"code": "OK", "result": "accepted", "requestId": request_id}

    def close(self):
        self.policy.stop()
        self.executor.shutdown()
        self.outputs.close()


# ---- Minimal websocket support ----
def ws_send(sock: socket.socket, text: str):
    payload = text.encode("utf-8")
    size = len(payload)
    if size <= 125:
        header = bytes([0x81, size])
    elif size <= 65535:
        header = bytes([0x81, 126]) + struct.pack("!H", size)
    else:
        header = bytes([0x81, 127]) + struct.pack("!Q", size)
    sock.sendall(header + payload)


def ws_recv(sock: socket.socket, max_bytes: int) -> str | None:
    first = sock.recv(2)
    if not first:
        return None
    b1, b2 = first[0], first[1]
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    size = b2 & 0x7F
    if size == 126:
        size = struct.unpack("!H", sock.recv(2))[0]
    elif size == 127:
        size = struct.unpack("!Q", sock.recv(8))[0]
    if size > max_bytes:
        raise ValueError("message too large")
    mask = sock.recv(4) if masked else b""
    payload = bytearray()
    while len(payload) < size:
        chunk = sock.recv(size - len(payload))
        if not chunk:
            return None
        payload.extend(chunk)
    if masked:
        for index in range(size):
            payload[index] ^= mask[index % 4]
    if opcode == 0x8:
        return None
    if opcode != 0x1:
        raise ValueError("unsupported frame")
    return payload.decode("utf-8")


def make_handler(controller: DoorController):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DoorOpen/2"

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *args):
            pass

        def json_response(self, status: int, payload: dict):
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def _actor_from_auth(self) -> Actor | None:
            return controller.auth.authenticate_header(self.headers.get("Authorization"))

        def _request_id(self) -> str:
            value = self.headers.get("Idempotency-Key", "")
            return value if canonical_uuid(value) else str(uuid.uuid4())

        def _origin_allowed(self) -> bool:
            if not controller.config.allowed_origins:
                return True
            origin = self.headers.get("Origin", "").rstrip("/")
            return origin in controller.config.allowed_origins

        def do_GET(self):
            if self.path in {"/health", "/status"}:
                return self.json_response(200, controller.service_status())
            if self.path == "/ws/telemetry":
                return self._handle_websocket()
            return self.json_response(404, {"code": "ERR_NOT_FOUND", "error": "Not found"})

        def _handle_websocket(self):
            if self.headers.get("Upgrade", "").lower() != "websocket":
                return self.json_response(426, {"code": "ERR_WS_UPGRADE_REQUIRED", "error": "WebSocket upgrade required"})
            if not self._origin_allowed():
                return self.json_response(403, {"code": "ERR_ORIGIN_DENIED", "error": "Origin denied"})
            actor = self._actor_from_auth()
            if actor is None and not controller.config.allow_anonymous_telemetry:
                return self.json_response(401, {"code": "ERR_UNAUTHORIZED", "error": "Unauthorized"})
            if actor is None:
                actor = Actor(Role.VIEWER, "anonymous", "ws")
            key = self.headers.get("Sec-WebSocket-Key", "")
            if not key:
                return self.json_response(400, {"code": "ERR_WS_KEY_REQUIRED", "error": "Missing websocket key"})
            try:
                decoded_key = base64.b64decode(key, validate=True)
            except Exception:  # noqa: BLE001
                return self.json_response(400, {"code": "ERR_WS_KEY_INVALID", "error": "Malformed websocket key"})
            if len(decoded_key) != 16:
                return self.json_response(400, {"code": "ERR_WS_KEY_INVALID", "error": "Malformed websocket key"})

            accept = base64.b64encode(hashlib.sha1((key + WEBSOCKET_GUID).encode()).digest()).decode()
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()

            client_id, queue = controller.telemetry.register()
            try:
                ws_send(self.connection, json.dumps({"type": "status", **controller.service_status(), "role": actor.role.value}))
                while True:
                    while True:
                        try:
                            outbound = queue.get_nowait()
                            ws_send(self.connection, outbound)
                        except Empty:
                            break
                    try:
                        message = ws_recv(self.connection, controller.config.max_ws_message_bytes)
                    except socket.timeout:
                        continue
                    except ValueError:
                        ws_send(self.connection, json.dumps({"type": "error", "code": "ERR_INVALID_MESSAGE", "error": "Malformed websocket frame"}))
                        continue
                    if message is None:
                        return
                    self._handle_ws_command(actor, message)
            finally:
                controller.telemetry.unregister(client_id)

        def _handle_ws_command(self, actor: Actor, message: str):
            try:
                payload = json.loads(message)
                if not isinstance(payload, dict):
                    raise ValueError()
            except (json.JSONDecodeError, ValueError):
                return ws_send(self.connection, json.dumps({"type": "error", "code": "ERR_INVALID_JSON", "error": "Malformed JSON"}))
            command = payload.get("command")
            correlation_id = payload.get("requestId")
            if not isinstance(correlation_id, str) or not canonical_uuid(correlation_id):
                correlation_id = str(uuid.uuid4())
            if command == "PULSE_GATE":
                if not AuthManager.allows(actor, Role.OPERATOR):
                    return ws_send(self.connection, json.dumps({"type": "error", "code": "ERR_FORBIDDEN", "error": "Operator role required"}))
                code, result = controller.request_pulse(payload.get("gateId"), actor, source="ws", request_id=correlation_id, maintenance_path=payload.get("maintenancePath") is True)
                return ws_send(self.connection, json.dumps({"type": "result", "command": command, "status": code, "result": result}))
            if command == "SET_MODE":
                if not AuthManager.allows(actor, Role.ADMIN):
                    return ws_send(self.connection, json.dumps({"type": "error", "code": "ERR_FORBIDDEN", "error": "Administrator role required"}))
                code, result = controller.set_mode(actor, str(payload.get("mode", "")), payload.get("confirm") is True, str(payload.get("reason", "")), correlation_id)
                return ws_send(self.connection, json.dumps({"type": "result", "command": command, "status": code, "result": result}))
            return ws_send(self.connection, json.dumps({"type": "error", "code": "ERR_UNKNOWN_COMMAND", "error": "Unknown command"}))

        def do_POST(self):
            actor = self._actor_from_auth()
            if self.path.startswith("/doors/"):
                if not AuthManager.allows(actor, Role.OPERATOR):
                    controller.audit("command_denied", actor="anonymous" if actor is None else actor.identity, source="http", reasonCode="ERR_UNAUTHORIZED")
                    return self.json_response(401, {"code": "ERR_UNAUTHORIZED", "error": "Unauthorized"})
                match = re.fullmatch(r"/doors/([1-4])/open", self.path)
                if not match:
                    return self.json_response(404, {"code": "ERR_NOT_FOUND", "error": "Only POST /doors/{1-4}/open is supported"})
                if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                    return self.json_response(400, {"code": "ERR_BODY_NOT_ALLOWED", "error": "Send an empty body"})
                status, payload = controller.request_pulse(int(match[1]), actor, source="http", request_id=self.headers.get("Idempotency-Key", ""))
                return self.json_response(status, payload)

            if self.path == "/api/v1/compass-webhook":
                try:
                    content_length = int(self.headers.get("Content-Length", "0") or "0")
                except ValueError:
                    return self.json_response(400, {"code": "ERR_INVALID_LENGTH", "error": "Invalid content length"})
                if content_length > controller.config.max_body_bytes:
                    return self.json_response(413, {"code": "ERR_BODY_TOO_LARGE", "error": "Payload too large"})
                body = self.rfile.read(content_length)
                status, payload = controller.process_webhook(self.headers, body, self._request_id())
                return self.json_response(status, payload)

            if self.path == "/api/v1/heartbeat":
                if not AuthManager.allows(actor, Role.OPERATOR):
                    return self.json_response(401, {"code": "ERR_UNAUTHORIZED", "error": "Unauthorized"})
                try:
                    body_size = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    return self.json_response(400, {"code": "ERR_INVALID_LENGTH", "error": "Invalid content length"})
                if body_size > controller.config.max_body_bytes:
                    return self.json_response(413, {"code": "ERR_BODY_TOO_LARGE", "error": "Payload too large"})
                body = self.rfile.read(body_size)
                try:
                    payload = json.loads(body)
                    gate_id = payload.get("gateId")
                    healthy = payload.get("healthy")
                    if healthy not in {True, False}:
                        raise ValueError("healthy must be boolean")
                    controller.policy.update_heartbeat(gate_id, healthy is True)
                except (json.JSONDecodeError, TypeError, ValueError, KeyError):
                    return self.json_response(400, {"code": "ERR_INVALID_SCHEMA", "error": "Invalid heartbeat payload"})
                return self.json_response(202, {"code": "OK"})

            return self.json_response(404, {"code": "ERR_NOT_FOUND", "error": "Not found"})

        do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_GET

    return Handler


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    controller = DoorController(Config.from_env())
    try:
        server = ThreadingHTTPServer((os.environ.get("DOOR_BIND", "127.0.0.1"), int(os.environ.get("DOOR_PORT", "8080"))), make_handler(controller))
    except BaseException:
        controller.close()
        raise
    server.daemon_threads = False

    def stop(*_):
        controller.policy.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    LOG.info("event=service_started mode=%s hardware_enabled=%s", controller.config.mode, controller.config.hardware_enabled)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        controller.close()


if __name__ == "__main__":
    main()
