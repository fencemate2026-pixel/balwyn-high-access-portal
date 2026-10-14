"""Durable local record: which commands were executed, and an audit trail.

Execution journal (state.json, atomic write + fsync):
  * the command id is written BEFORE the relay is touched ("in_flight");
  * after a restart, an id found there is never actuated again, even if the
    portal re-dispatches it (its 30 s lease expired while we were down);
  * the last 1000 ids are kept.
A corrupt journal is moved aside (state.json.corrupt-<ts>) and reported as a
fault, instead of stopping the controller forever with no heartbeat.

Audit log (audit.jsonl): one JSON line per event, rotated at 2 MB, 5 files.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

MAX_IDS = 1000   # each id is ~100 bytes; a bigger memory makes a replayed old command id much less likely
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
        # Wall-clock time a fire / evacuation hold began, while one is on. Kept across restarts so a crash or an
        # update does not silently end an evacuation hold (the controller switches it on again at start-up).
        self.emergency_since: Optional[float] = None
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
            since = data.get("emergency_since")
            self.emergency_since = float(since) if isinstance(since, (int, float)) and not isinstance(since, bool) and since == since else None
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
        payload = {"done": {k: self.done[k] for k in ids}, "in_flight": self.in_flight, "emergency_since": self.emergency_since}
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

    def set_emergency_hold(self, active: bool) -> None:
        """Remember (or forget) that a fire / evacuation hold is on. A disk error is reported, never raised."""
        if active:
            if self.emergency_since is None:
                self.emergency_since = time.time()
        else:
            self.emergency_since = None
        try:
            self._save()
        except OSError as error:
            if not self._write_fault_reported:
                self._write_fault_reported = True
                self.faults.append(f"Execution journal could not be written ({error.strerror or type(error).__name__})")
            self.audit("journal_write_failed", {"emergency_hold": active})

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
