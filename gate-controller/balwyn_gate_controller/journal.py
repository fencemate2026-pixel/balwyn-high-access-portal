"""Durable local record: which commands were executed, and an audit trail.

Execution journal (state.json, atomic write + fsync):
  * the command id is written BEFORE the relay is touched ("in_flight");
  * after a restart, an id found there is never actuated again, even if the
    portal re-dispatches it (its 30 s lease expired while we were down);
  * the last 200 ids are kept.
A corrupt journal is moved aside (state.json.corrupt-<ts>) and reported as a
fault, instead of stopping the controller forever with no heartbeat.

Audit log (audit.jsonl): one JSON line per event, rotated at 2 MB, 5 files.
"""

from __future__ import annotations

import json
import os
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
        self._load()

    # ----------------------------------------------------------------- state
    def _load(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("done", {}), dict):
                raise ValueError("unexpected shape")
            self.done = {str(k): v for k, v in data.get("done", {}).items()}
            flight = data.get("in_flight")
            self.in_flight = flight if isinstance(flight, dict) else None
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
        self.done = payload["done"]

    def seen(self, command_id: int) -> bool:
        key = str(command_id)
        return key in self.done or (self.in_flight is not None and str(self.in_flight.get("id")) == key)

    def begin(self, command: Dict[str, Any]) -> None:
        """Record intent BEFORE actuation. If this raises, the relay is not touched."""
        self.in_flight = {"id": command["id"], "command": command["command"], "source": command.get("source"), "at": time.time()}
        self._save()

    def finish(self, command_id: int, outcome: str, detail: str) -> None:
        self.done[str(command_id)] = {"outcome": outcome, "detail": detail[:300], "at": time.time()}
        if self.in_flight and str(self.in_flight.get("id")) == str(command_id):
            self.in_flight = None
        self._save()

    def interrupted(self) -> Optional[Dict[str, Any]]:
        """A command that was in flight when the process last stopped."""
        return self.in_flight

    # ----------------------------------------------------------------- audit
    def audit(self, event: str, data: Dict[str, Any] | None = None) -> None:
        line = json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "event": event, **(data or {})}, separators=(",", ":"))
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
