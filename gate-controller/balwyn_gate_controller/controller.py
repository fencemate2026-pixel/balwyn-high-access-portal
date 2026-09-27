"""The controller: reads the gate, talks to the portal, drives the relay.

Everything happens in tick(), which is called about every 50 ms. tick() never
blocks on the gate: a command starts an action and is then followed on later
ticks until its position is confirmed or its deadline passes, so heartbeats
keep flowing while a gate is moving.

Command handling (portal command -> relay action):
  open  / source schedule or emergency -> HOLD the contact (gate stays open)
  open  / source manual                -> PULSE for CYCLE_PULSE_S (open, then the
                                          operator's own timer auto-closes it)
  closed                               -> RELEASE any hold; the operator then
                                          auto-closes. Confirmed by the closed reed.
Results are acknowledged honestly:
  acknowledged  only when the reed confirms the requested position
  failed        not confirmed in time, no open reed fitted, dry run, restarted
  blocked       safety input not healthy / monitor-only: relay NOT operated
The portal independently downgrades any acknowledgement whose position does
not match the command (lib/controller-safety.ts).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .config import Config
from .hardware import GateIO
from .journal import Journal
from .portal import PortalClient, PortalError
from .position import PositionTracker
from .relay import RelaySupervisor

LOG = logging.getLogger("balwyn-gate")
HOLD_SOURCES = {"schedule", "emergency"}


@dataclass
class Job:
    command_id: int
    target: str          # "open" | "closed"
    source: str
    deadline: float
    action: str          # what the relay did, for the acknowledgement text


class GateController:
    def __init__(self, config: Config, io: GateIO, portal: PortalClient, journal: Journal,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.cfg = config
        self.io = io
        self.portal = portal
        self.journal = journal
        self.clock = clock
        self.relay = RelaySupervisor(io.relay, config.hold_max_s, config.network_loss_release_s,
                                     config.loop_stall_s, journal.audit, clock)
        self.tracker = PositionTracker(config.debounce_s, config.travel_timeout_s, config.open_reed_pin is not None)
        self.job: Optional[Job] = None
        self.pending_acks: List[Dict[str, Any]] = []
        self.next_poll = 0.0
        self.poll_failures = 0
        self.position = "unknown"
        self.safety_ok = False
        self.faults: List[str] = []
        self._recover_interrupted()

    # ------------------------------------------------------------- start-up
    def _recover_interrupted(self) -> None:
        flight = self.journal.interrupted()
        if not flight:
            return
        detail = "Controller restarted during this command. It was not repeated; the relay is off."
        self.journal.finish(int(flight["id"]), "failed", detail)
        self.pending_acks.append({"id": int(flight["id"]), "state": "failed", "detail": detail})
        self.journal.audit("command_interrupted", {"id": flight["id"]})

    # ---------------------------------------------------------------- sensing
    def _sense(self, now: float) -> None:
        reading = self.tracker.update(self.io.closed_reed(), self.io.open_reed(), now)
        faults = list(reading.faults) + list(self.journal.faults)
        safety = self.io.safety_healthy()
        if safety is None:
            faults.append("Monitor-only: no safety input fitted, so this gate cannot be commanded")
        elif not safety:
            faults.append("Local safety circuit is not healthy")
        if self.relay.state.released_reason in {"controller loop stalled", "portal unreachable too long", "hold exceeded maximum duration"} and self.relay.state.mode == "idle":
            faults.append(f"Relay hold released: {self.relay.state.released_reason}")
        self.position = reading.position
        self.safety_ok = safety is True and not reading.faults
        self.faults = faults[:8]
        # Interlock: an unhealthy safety input ends pulses and schedule/manual holds.
        # A fire hold is kept: the operator's own safety devices still govern motion.
        if not self.safety_ok and self.relay.state.mode != "idle" and self.relay.state.hold_kind != "emergency":
            self.relay.release("safety input not healthy")

    # ------------------------------------------------------------------ tick
    def tick(self) -> None:
        now = self.clock()
        self.relay.feed()
        self.relay.enforce(now)
        self._sense(now)
        self._follow_job(now)
        self._flush_acks()
        if now >= self.next_poll:
            self._poll(now)

    def _follow_job(self, now: float) -> None:
        job = self.job
        if not job:
            return
        if self.position == job.target:
            self._complete(job, "acknowledged", f"{job.action}; {job.target} confirmed by reed switch.")
        elif now >= job.deadline:
            self._complete(job, "failed", f"{job.action}; {job.target} NOT confirmed within {self._timeout_for(job.target):g} s (last position: {self.position}).")

    def _timeout_for(self, target: str) -> float:
        return self.cfg.travel_timeout_s if target == "open" else self.cfg.auto_close_timeout_s

    def _complete(self, job: Job, state: str, detail: str) -> None:
        self.journal.finish(job.command_id, state, detail)
        self.journal.audit("command_result", {"id": job.command_id, "state": state, "position": self.position})
        self.pending_acks.append({"id": job.command_id, "state": state, "detail": detail})
        self.job = None
        self.next_poll = 0.0  # report the outcome promptly

    # ------------------------------------------------------------------ portal
    def _poll(self, now: float) -> None:
        try:
            response = self.portal.poll(self.position, self.safety_ok, self.faults, self.cfg.schedule_control)
        except PortalError as error:
            self.poll_failures += 1
            backoff = min(30.0, 2.0 ** min(self.poll_failures, 5))
            self.next_poll = now + backoff
            if self.poll_failures in (1, 5) or self.poll_failures % 20 == 0:
                LOG.warning("portal poll failed (%s); retry in %.0f s", error, backoff)
                self.journal.audit("portal_unreachable", {"failures": self.poll_failures, "status": error.status})
            return
        self.relay.portal_ok()
        if self.poll_failures:
            self.journal.audit("portal_reachable", {"after_failures": self.poll_failures})
        self.poll_failures = 0
        wait_ms = response.get("pollAfterMs", 1500)
        self.next_poll = now + min(max(float(wait_ms) / 1000.0, 0.5), 5.0)
        command = response.get("command")
        if isinstance(command, dict):
            self._handle(command, now)

    def _flush_acks(self) -> None:
        remaining = []
        for ack in self.pending_acks:
            try:
                self.portal.ack(ack["id"], ack["state"], self.position, self.safety_ok, ack["detail"])
            except PortalError as error:
                if error.status == 404:
                    continue  # the portal no longer knows this command: nothing to report
                remaining.append(ack)
        self.pending_acks = remaining

    # ------------------------------------------------------------- commands
    def _handle(self, command: Dict[str, Any], now: float) -> None:
        try:
            command_id = int(command["id"])
            target = str(command["command"])
            source = str(command.get("source", "manual"))
        except (KeyError, TypeError, ValueError):
            self.journal.audit("command_malformed", {})
            return
        if target not in {"open", "closed"}:
            self.pending_acks.append({"id": command_id, "state": "failed", "detail": f"Unsupported command {target!r}."})
            return

        if self.journal.seen(command_id):
            if self.job and self.job.command_id == command_id:
                return  # still working on it; the portal re-sent it after its lease
            outcome = self.journal.done.get(str(command_id), {})
            state = "acknowledged" if self.position == target else "failed"
            self.pending_acks.append({"id": command_id, "state": state,
                                      "detail": f"Already handled ({outcome.get('outcome', 'unknown')}); not repeated."})
            return

        if self.job:
            if source != "emergency":
                return  # busy; the portal re-dispatches after its 30 s lease
            self._complete(self.job, "failed", "Superseded by fire / evacuation command.")

        if not self.safety_ok:
            detail = ("Monitor-only controller: no safety input fitted. Relay not operated."
                      if self.cfg.monitor_only else "Local safety circuit not healthy. Relay not operated.")
            self.journal.finish(command_id, "blocked", detail)
            self.pending_acks.append({"id": command_id, "state": "blocked", "detail": detail})
            return
        if self.cfg.dry_run:
            detail = "Dry run: relay not operated."
            self.journal.finish(command_id, "failed", detail)
            self.pending_acks.append({"id": command_id, "state": "failed", "detail": detail})
            return

        try:
            self.journal.begin({"id": command_id, "command": target, "source": source})
        except OSError as error:
            detail = f"Execution journal could not be written ({error.strerror}). Relay not operated."
            self.pending_acks.append({"id": command_id, "state": "failed", "detail": detail})
            return
        self.journal.audit("command_start", {"id": command_id, "command": target, "source": source})

        if target == "open":
            if source in HOLD_SOURCES:
                self.relay.hold(source)
                action = f"Relay held for {source} open"
            elif self.relay.state.mode == "holding":
                action = "Gate already held open; no pulse sent"
            elif self.relay.pulse(self.cfg.cycle_pulse_s):
                action = f"Relay pulsed {self.cfg.cycle_pulse_s:g} s for an open cycle"
            else:
                action = "Pulse refused by relay interlock"
            self.tracker.movement_started(now)
            if self.cfg.open_reed_pin is None and self.position != "open":
                detail = f"{action}. No open-position reed is fitted, so the open cannot be confirmed."
                self.journal.finish(command_id, "failed", detail)
                self.pending_acks.append({"id": command_id, "state": "failed", "detail": detail})
                return
            self.job = Job(command_id, "open", source, now + self.cfg.travel_timeout_s, action)
        else:
            released = self.relay.release(f"portal close command ({source})")
            action = "Hold released; operator auto-closes" if released else "No hold active; waiting for auto-close"
            self.tracker.movement_started(now)
            self.job = Job(command_id, "closed", source, now + self.cfg.auto_close_timeout_s, action)
        self._follow_job(now)

    # ---------------------------------------------------------------- stop
    def shutdown(self) -> None:
        """Relay off and GPIO released. Called on SIGTERM, SIGINT and any fatal error."""
        try:
            self.relay.release("controller stopping")
        finally:
            self.io.shutdown()
            self.journal.audit("controller_stopped", {})
