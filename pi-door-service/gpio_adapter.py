from __future__ import annotations

import hmac
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any


ALLOWED_MODES = {"NORMAL", "LOCKDOWN", "EVACUATION", "MAINTENANCE", "DEMO"}
EMERGENCY_MODES = {"LOCKDOWN", "EVACUATION"}


@dataclass(frozen=True)
class GateRecord:
    commissioned: bool = True
    healthy: bool = True


@dataclass(frozen=True)
class AdapterConfig:
    hardware_enabled: bool = False
    pulse_seconds: float = 0.4
    cooldown_seconds: float = 0.9
    active_low: bool = True
    webhook_secret: str = ""

    def __post_init__(self) -> None:
        if not 0.1 <= self.pulse_seconds <= 1.5:
            raise ValueError("pulse_seconds must be between 0.1 and 1.5")
        if not 0.1 <= self.cooldown_seconds <= 5.0:
            raise ValueError("cooldown_seconds must be between 0.1 and 5.0")


class SimulationOutputs:
    """Simulation output driver; keeps relays de-energised by default.

    Assumption: active_low wiring means logical relay "active" drives GPIO low.
    This software does not replace certified local safety circuits.
    """

    def __init__(self, active_low: bool = True) -> None:
        self.active_low = active_low
        self.states: dict[str, bool] = {}
        self.lock = threading.Lock()

    def write(self, gate_id: str, active: bool) -> None:
        with self.lock:
            self.states[gate_id] = bool(active)

    def safe_off(self) -> None:
        with self.lock:
            for gate_id in list(self.states):
                self.states[gate_id] = False


class GateHardwareAdapter:
    def __init__(
        self,
        gate_registry: dict[str, GateRecord],
        token_roles: dict[str, str],
        config: AdapterConfig | None = None,
        outputs: SimulationOutputs | None = None,
    ) -> None:
        self.config = config or AdapterConfig()
        self.mode = "DEMO" if not self.config.hardware_enabled else "NORMAL"
        self.gates = {self.normalize_gate_id(gate_id): value for gate_id, value in gate_registry.items()}
        self.token_roles = {str(token): str(role).lower() for token, role in token_roles.items()}
        self.outputs = outputs or SimulationOutputs(active_low=self.config.active_low)
        self.audit_log: list[dict[str, Any]] = []
        self.cooldown_until: dict[str, float] = {}
        self.pending: set[str] = set()
        self.state_lock = threading.Lock()
        self.last_heartbeat = 0.0
        self.interlock_healthy = True
        self._stop = threading.Event()
        self._work_q: queue.Queue[dict[str, Any]] = queue.Queue()
        self._worker = threading.Thread(target=self._run_worker, daemon=True)
        self.outputs.safe_off()
        self._worker.start()

    @staticmethod
    def normalize_gate_id(gate_id: Any) -> str:
        if isinstance(gate_id, int):
            if gate_id <= 0:
                raise ValueError("invalid_gate")
            return f"GATE-{gate_id}"
        text = str(gate_id or "").strip().upper().replace("_", "-")
        if text.isdigit():
            value = int(text)
            if value <= 0:
                raise ValueError("invalid_gate")
            return f"GATE-{value}"
        if not text.startswith("GATE-"):
            raise ValueError("invalid_gate")
        suffix = text[5:]
        if not suffix or not suffix.replace("-", "").isalnum():
            raise ValueError("invalid_gate")
        return text

    def connect_websocket(self, token: str | None, telemetry_only: bool = False) -> dict[str, Any]:
        if not token:
            if telemetry_only:
                return {"ok": True, "role": "viewer", "telemetryOnly": True}
            self._audit(False, "ws_connect", "anonymous_command_denied", "websocket")
            return {"ok": False, "reason": "authentication_required"}
        role = self.token_roles.get(token)
        if role not in {"viewer", "operator", "administrator"}:
            self._audit(False, "ws_connect", "invalid_token", "websocket")
            return {"ok": False, "reason": "invalid_token"}
        return {"ok": True, "role": role, "telemetryOnly": telemetry_only and role == "viewer"}

    def mark_heartbeat(self) -> None:
        self.last_heartbeat = time.time()

    def set_mode(self, role: str, mode: str, confirmed_by_admin: bool = False) -> dict[str, Any]:
        normalized_mode = str(mode or "").upper()
        if normalized_mode not in ALLOWED_MODES:
            return self._decision(False, "set_mode", "invalid_mode", "websocket", role)
        if role != "administrator":
            return self._decision(False, "set_mode", "administrator_required", "websocket", role)
        if normalized_mode in EMERGENCY_MODES and not confirmed_by_admin:
            return self._decision(False, "set_mode", "explicit_confirmation_required", "websocket", role)
        self.mode = normalized_mode
        return self._decision(True, "set_mode", "accepted", "websocket", role, mode=self.mode)

    def queue_gate_pulse(self, role: str, gate_id: Any, source: str, maintenance_path: bool = False) -> dict[str, Any]:
        if role not in {"operator", "administrator"}:
            return self._decision(False, "toggle_gate", "insufficient_role", source, role)
        if self.mode == "LOCKDOWN":
            return self._decision(False, "toggle_gate", "lockdown_blocks_pulse", source, role)
        if self.mode == "MAINTENANCE" and source in {"automation", "webhook"} and not maintenance_path:
            return self._decision(False, "toggle_gate", "maintenance_blocks_automation", source, role)
        try:
            normalized_gate = self.normalize_gate_id(gate_id)
        except ValueError:
            return self._decision(False, "toggle_gate", "invalid_gate", source, role)
        record = self.gates.get(normalized_gate)
        if not record:
            return self._decision(False, "toggle_gate", "uncommissioned_gate", source, role, gateId=str(gate_id))
        if not record.commissioned:
            return self._decision(False, "toggle_gate", "uncommissioned_gate", source, role, gateId=normalized_gate)
        if not record.healthy:
            return self._decision(False, "toggle_gate", "unhealthy_gate", source, role, gateId=normalized_gate)

        with self.state_lock:
            now = time.monotonic()
            if normalized_gate in self.pending:
                return self._decision(False, "toggle_gate", "overlapping_pulse", source, role, gateId=normalized_gate)
            if self.cooldown_until.get(normalized_gate, 0.0) > now:
                return self._decision(False, "toggle_gate", "cooldown", source, role, gateId=normalized_gate)
            self.pending.add(normalized_gate)
            self.cooldown_until[normalized_gate] = now + self.config.pulse_seconds + self.config.cooldown_seconds
        self._work_q.put({"gateId": normalized_gate, "source": source})
        return self._decision(True, "toggle_gate", "queued", source, role, gateId=normalized_gate)

    def handle_bulk_command(self, role: str, payload: dict[str, Any], source: str = "websocket") -> dict[str, Any]:
        if role not in {"operator", "administrator"}:
            return self._decision(False, "bulk", "insufficient_role", source, role)
        open_all = bool(payload.get("openAll"))
        close_all = bool(payload.get("closeAll"))
        if not open_all and not close_all:
            return self._decision(False, "bulk", "bulk_operation_required", source, role)
        if open_all and close_all:
            return self._decision(False, "bulk", "conflicting_bulk_command", source, role)
        return self._decision(True, "bulk", "accepted", source, role)

    def handle_webhook(self, headers: dict[str, str], payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        provided = str(headers.get("X-Webhook-Secret", ""))
        if not self.config.webhook_secret or not hmac.compare_digest(provided, self.config.webhook_secret):
            self._audit(False, "webhook", "invalid_secret", "webhook")
            return 401, {"status": "DENIED"}
        event_type = str(payload.get("eventType") or payload.get("type") or "").upper()
        if event_type not in {"AUTHORIZED_ENTRY", "REMOTE_OPEN"}:
            self._audit(False, "webhook", "invalid_event_type", "webhook")
            return 400, {"status": "DENIED", "reason": "invalid_event_type"}
        source = str(payload.get("source") or "").lower()
        if source and source not in {"compass", "guardian"}:
            self._audit(False, "webhook", "invalid_source", "webhook")
            return 400, {"status": "DENIED", "reason": "invalid_source"}
        authorized = bool(payload.get("authorized"))
        if not authorized:
            self._audit(False, "webhook", "not_authorized", "webhook")
            return 403, {"status": "DENIED", "reason": "not_authorized"}

        gate_id = payload.get("zoneId") or payload.get("targetZoneId")
        result = self.queue_gate_pulse("operator", gate_id, source="webhook", maintenance_path=bool(payload.get("maintenancePath")))
        if not result["ok"]:
            code = 423 if result["reason"].startswith("lockdown") else 400
            return code, {"status": "DENIED", "reason": result["reason"]}
        return 200, {"status": "PROCESSED", "gateId": result.get("gateId"), "mode": self.mode}

    def handle_ws_message(self, role: str, message: dict[str, Any]) -> dict[str, Any]:
        command = str(message.get("command") or "").upper()
        if command == "SET_MODE":
            return self.set_mode(role, str(message.get("mode") or ""), confirmed_by_admin=bool(message.get("confirmEmergency")))
        if command == "TOGGLE_GATE":
            return self.queue_gate_pulse(role, message.get("gateId"), source="websocket")
        if command == "BULK":
            return self.handle_bulk_command(role, message)
        return self._decision(False, "unknown", "unsupported_command", "websocket", role)

    def health_status(self) -> dict[str, Any]:
        now = time.monotonic()
        cooling = [gate for gate, until in self.cooldown_until.items() if until > now]
        hardware_available = bool(self.config.hardware_enabled)
        runtime_mode = "live" if hardware_available else "demo"
        heartbeat_age = None if not self.last_heartbeat else max(0.0, time.time() - self.last_heartbeat)
        ready = self.interlock_healthy and not self._stop.is_set() and (runtime_mode == "demo" or hardware_available)
        return {
            "mode": self.mode,
            "runtimeMode": runtime_mode,
            "hardwareEnabled": self.config.hardware_enabled,
            "hardwareAvailable": hardware_available,
            "interlockHealthy": self.interlock_healthy,
            "ready": ready,
            "lastHeartbeat": self.last_heartbeat or None,
            "heartbeatAgeSeconds": heartbeat_age,
            "pendingPulses": sorted(self.pending),
            "cooldownGates": sorted(cooling),
        }

    def shutdown(self) -> None:
        self._stop.set()
        self._work_q.put({"stop": True})
        self._worker.join(timeout=2)
        self.outputs.safe_off()

    def _run_worker(self) -> None:
        while not self._stop.is_set():
            task = self._work_q.get()
            if task.get("stop"):
                break
            gate_id = task["gateId"]
            pulse_ok = False
            try:
                self.outputs.write(gate_id, True)
                time.sleep(self.config.pulse_seconds)
                pulse_ok = True
            except Exception:
                self.interlock_healthy = False
                self._audit(False, "pulse", "pulse_failed", task.get("source", "worker"), gateId=gate_id)
            finally:
                try:
                    self.outputs.write(gate_id, False)
                except Exception:
                    self.interlock_healthy = False
                    self._audit(False, "pulse", "cleanup_failed", task.get("source", "worker"), gateId=gate_id)
                with self.state_lock:
                    self.pending.discard(gate_id)
                if pulse_ok:
                    self._audit(True, "pulse", "completed", task.get("source", "worker"), gateId=gate_id)

    def _decision(
        self,
        allowed: bool,
        action: str,
        reason: str,
        source: str,
        role: str | None = None,
        **extras: Any,
    ) -> dict[str, Any]:
        payload = {"ok": allowed, "action": action, "reason": reason, **extras}
        self._audit(allowed, action, reason, source, role=role, **extras)
        return payload

    def _audit(self, allowed: bool, action: str, reason: str, source: str, role: str | None = None, **extras: Any) -> None:
        self.audit_log.append({
            "ts": time.time(),
            "allowed": allowed,
            "action": action,
            "reason": reason,
            "source": source,
            "role": role,
            **extras,
        })
