"""Durable local record: which commands were executed, and an audit trail.

Execution journal (state.json, atomic write + fsync):
  * the command id is written BEFORE the relay is touched ("in_flight");
  * after a restart, an id found there is never actuated again, even if the
    portal re-dispatches it (its 30 s lease expired while we were down);
  * the last 200 ids are kept.
A corrupt journal is moved aside (state.json.corrupt-<ts>) and reported as a
fault, instead of stopping the controller forever with no heartbeat.

Audit log (audit.jsonl): one JSON line per event, rotated at 2 MB, 5 files.
Threat detection and labelling are tracked for continuous learning.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

MAX_IDS = 200
AUDIT_MAX_BYTES = 2 * 1024 * 1024
AUDIT_KEEP = 5


class Journal:
    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.dir, 0o700)
        self.state_path = self.dir / "state.json"
        self.audit_path = self.dir / "audit.jsonl"
        self.faults: List[str] = []
        self.done: Dict[str, Dict[str, Any]] = {}
        self.in_flight: Optional[Dict[str, Any]] = None
        # audit() is called from the control loop AND the relay watchdog thread.
        self._audit_lock = threading.Lock()
        self._write_fault_reported = False
        self._load()

    # ----------------------------------------------------------------- state
    def _load(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("done", {}), dict):
                raise ValueError("unexpected shape")
            done = {str(k): v for k, v in data.get("done", {}).items()}
            if not all(isinstance(v, dict) for v in done.values()):
                raise ValueError("unexpected shape")
            flight = data.get("in_flight")
            if flight is not None:
                # A recovered command must carry a real integer id, or recovery itself would crash on every start.
                if not isinstance(flight, dict) or isinstance(flight.get("id"), bool) or not isinstance(flight.get("id"), int):
                    raise ValueError("unexpected shape")
            self.done = done
            self.in_flight = flight
        except (ValueError, OSError) as error:
            aside = self.state_path.with_name(f"state.json.corrupt-{int(time.time())}")
            try:
                self.state_path.replace(aside)
            except OSError:
                pass
            self.faults.append(f"Execution journal was unreadable and was set aside ({type(error).__name__})")
            self.audit("journal_corrupt", {"moved_to": aside.name})

    def _save(self) -> None:
        ids = list(self.done)[-MAX_IDS:]
        payload = {"done": {k: self.done[k] for k in ids}, "in_flight": self.in_flight}
        tmp = self.state_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        tmp.replace(self.state_path)
        self._sync_directory()
        self.done = payload["done"]

    def _sync_directory(self) -> None:
        """Make the rename itself durable: without this a power cut just after a command starts can bring back the OLD
        state.json, and the command would then be repeated."""
        try:
            fd = os.open(self.dir, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        except OSError:
            pass
        finally:
            os.close(fd)

    def seen(self, command_id: int) -> bool:
        key = str(command_id)
        return key in self.done or (self.in_flight is not None and str(self.in_flight.get("id")) == key)

    def begin(self, command: Dict[str, Any]) -> None:
        """Record intent BEFORE actuation. If this raises, the relay is not touched."""
        previous = self.in_flight
        self.in_flight = {"id": command["id"], "command": command["command"], "source": command.get("source"), "at": time.time()}
        try:
            self._save()
        except BaseException:
            self.in_flight = previous  # nothing was written, so nothing is "in flight": no phantom restart report later
            raise

    def finish(self, command_id: int, outcome: str, detail: str) -> None:
        self.done[str(command_id)] = {"outcome": outcome, "detail": detail[:300], "at": time.time()}
        if self.in_flight and str(self.in_flight.get("id")) == str(command_id):
            self.in_flight = None
        try:
            self._save()
        except OSError as error:
            # The relay has already acted. A disk fault must not become an exception inside the control loop (that
            # would end the process and drop a fire hold). Keep the result in memory and report the fault.
            if not self._write_fault_reported:
                self._write_fault_reported = True
                self.faults.append(f"Execution journal could not be written ({error.strerror or type(error).__name__})")
            self.audit("journal_write_failed", {"id": command_id})

    def interrupted(self) -> Optional[Dict[str, Any]]:
        """A command that was in flight when the process last stopped."""
        return self.in_flight

    # ----------------------------------------------------------------- audit
    def audit(self, event: str, data: Dict[str, Any] | None = None) -> None:
        # Text that came from the portal is clipped, so one hostile or buggy reply cannot fill the log and push the
        # real history out of the five rotated files.
        clipped = {k: (v[:300] if isinstance(v, str) else v) for k, v in (data or {}).items()}
        line = json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "event": event, **clipped}, separators=(",", ":"))
        with self._audit_lock:
            try:
                if self.audit_path.exists() and self.audit_path.stat().st_size > AUDIT_MAX_BYTES:
                    for index in range(AUDIT_KEEP - 1, 0, -1):
                        older = self.audit_path.with_name(f"audit.jsonl.{index}")
                        newer = self.audit_path.with_name(f"audit.jsonl.{index - 1}") if index > 1 else self.audit_path
                        if newer.exists():
                            newer.replace(older)
                with open(self.audit_path, "a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
                os.chmod(self.audit_path, 0o600)
            except OSError:
                pass  # an audit write failure must never stop gate control; journal state is separate

    # ----------------------------------------------------------------- threats (for learning)
    def threat_detected(self, detection_id: str, source: str, confidence: float,
                       location: str, distance_m: float, approach_speed: float = 0.0) -> None:
        """Record a perimeter threat detection from thermal/radar/video."""
        self.audit("threat_detected", {
            "detection_id": detection_id,
            "source": source,  # "THERMAL", "RADAR", "VIDEO", "FUSION"
            "confidence": round(confidence, 4),
            "location": location,  # "FRONT", "SPORTS", "STAFF", "EMERGENCY"
            "distance_m": round(distance_m, 1),
            "approach_speed": round(approach_speed, 2),
        })

    def threat_proposed(self, detection_id: str, model_id: str,
                       confidence: float, proposed_action: str,
                       reasoning: Dict[str, Any] | None = None) -> None:
        """Record AI model's proposal before staff approval."""
        data = {
            "detection_id": detection_id,
            "model_id": model_id,
            "confidence": round(confidence, 4),
            "proposed_action": proposed_action,  # "FULL_LOCKDOWN", "HEIGHTENED_ALERT", "MONITOR"
        }
        if reasoning:
            data["reasoning"] = reasoning
        self.audit("threat_proposed", data)

    def threat_approved(self, detection_id: str, approved_by: str,
                       action: str, door_sequence: List[str] | None = None) -> None:
        """Record staff approval of threat response."""
        data = {
            "detection_id": detection_id,
            "approved_by": approved_by,
            "action": action,
        }
        if door_sequence:
            data["door_sequence"] = door_sequence
        self.audit("threat_approved", data)

    def threat_rejected(self, detection_id: str, rejected_by: str, reason: str = "") -> None:
        """Record staff rejection of threat proposal."""
        self.audit("threat_rejected", {
            "detection_id": detection_id,
            "rejected_by": rejected_by,
            "reason": reason[:200],
        })

    def threat_labelled(self, detection_id: str, label: str, labelled_by: str,
                       confidence_in_label: float = 1.0) -> None:
        """Record staff label for a past threat (for learning)."""
        if label not in ("true_positive", "false_positive", "unsure"):
            raise ValueError("label must be true_positive, false_positive, or unsure")
        self.audit("threat_labelled", {
            "detection_id": detection_id,
            "label": label,
            "labelled_by": labelled_by,
            "confidence_in_label": round(confidence_in_label, 2),
        })
