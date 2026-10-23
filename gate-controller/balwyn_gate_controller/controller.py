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

Access-board unlock (added 11 Oct 2026, only when UNLOCK_RELAY_PIN is set):
  an open that needs the gate to move first gives the access board's exit-button
  input one short press, so the board releases the magnetic lock for its own
  unlock time. With UNLOCK_SENSE_PIN fitted, the gate relay is only driven once
  the board confirms the unlock; without it, after UNLOCK_LEAD_S. If the board
  never confirms, the command fails and the gate relay is NOT driven (the motor
  must not push against a locked magnet). A fire / evacuation command does not
  wait for confirmation: it presses, waits UNLOCK_LEAD_S and holds the gate
  (the fire panel's hardwired lock release is the life-safety path). This all
  runs as a staged action across ticks: tick() still never waits.

Network off the control loop (fixed 28 Sep 2026): every HTTPS call to the
portal runs in a PortalLink exchange. In the service the exchange runs on a
worker thread, so tick() never waits on the network. Before this, a
black-holed network blocked one tick for 24 s (8 s per call, acknowledgements
plus the poll), and name resolution is not bounded by the socket timeout at
all. That starved the systemd watchdog (WatchdogSec=15): systemd killed the
controller, which released the relay, including a fire / evacuation hold that
is meant to survive network loss. Tests run the same exchange inline.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .config import Config
from .hardware import GateIO
from .journal import Journal
from .portal import PortalClient, PortalError
from .position import PositionTracker
from .relay import PulseOutput, RelaySupervisor

LOG = logging.getLogger("balwyn-gate")
HOLD_SOURCES = {"schedule", "emergency"}
# Exactly the sources the portal can create (lib/portal-store.ts: queueGateCommands "manual" / "emergency",
# getOrCreateScheduledControllerCommand "schedule"). Anything else is refused, never guessed at.
VALID_SOURCES = {"manual", "schedule", "emergency"}
# Who may end a fire / evacuation hold. A schedule window ending during a fire must not.
EMERGENCY_RELEASE_SOURCES = {"emergency", "manual"}
# 4xx replies that mean "the portal will never accept this acknowledgement": drop it instead of retrying for ever.
# (401 / 403 / 408 / 429 are NOT here: those can be fixed by waiting or by correcting the credential.)
ACK_REJECTED_STATUSES = {400, 409, 410, 422}
# A 404 means "this command is unknown" ONLY when it carries the portal's own message ("Command not found.").
# A 404 from anything else (a proxy, a route that does not exist during a portal update) is retried.
MAX_PENDING_ACKS = 50
EXCHANGE_ABANDON_S = 60.0     # a portal exchange still unfinished after this long is abandoned and a new one started
ACK_RETRY_S = 2.0            # after a failed acknowledgement, retry no sooner than this
EXCHANGE_STALL_WARN_S = 30.0  # log once when one portal exchange has run this long


@dataclass
class Job:
    command_id: int
    target: str          # "open" | "closed"
    source: str
    deadline: float
    action: str          # what the relay did, for the acknowledgement text


@dataclass
class PendingOpen:
    """An open waiting for the access board to release the lock."""
    command_id: int
    source: str
    phase: str           # "confirm" (waiting for the board's unlock signal) | "lead" (short delay, then drive the gate)
    deadline: float


@dataclass
class Exchange:
    """The outcome of one portal exchange: acknowledgements first, then (if due) a poll."""
    delivered: List[Dict[str, Any]] = field(default_factory=list)  # acks the portal took, or no longer knows (404)
    ack_failed: bool = False
    rejected: int = 0
    polled: bool = False
    response: Optional[Dict[str, Any]] = None
    poll_error: Optional[PortalError] = None


class PortalLink:
    """Runs one portal exchange at a time.

    threaded=True (the service): the exchange runs on a daemon worker thread and
    tick() collects the result on a later tick, so no network delay of any kind
    can stall relay supervision, the safety interlock or the systemd watchdog.
    threaded=False (tests): the exchange runs inline, inside tick(), so tests
    driven by a simulated clock stay deterministic. Both run the same code.

    A worker that never returns (a name lookup that hangs, a server that sends
    one byte a minute) would otherwise hold the link busy for ever: no
    heartbeat, no acknowledgement, no remote release of a fire hold. check()
    abandons an exchange after EXCHANGE_ABANDON_S; if the stuck worker ever
    finishes, its result is discarded (generation number).
    """

    def __init__(self, threaded: bool) -> None:
        self.threaded = threaded
        self._lock = threading.Lock()
        self._busy = False
        self._result: Optional[Exchange] = None
        self._generation = 0
        self.started_at = 0.0
        self.stall_reported = False

    def busy(self) -> bool:
        with self._lock:
            return self._busy

    def start(self, job: Callable[[], Exchange], now: float) -> None:
        self.started_at = now
        self.stall_reported = False
        if not self.threaded:
            self._result = job()
            return

        with self._lock:
            self._generation += 1
            generation = self._generation
            self._busy = True
            self._result = None

        def run() -> None:
            try:
                result = job()
            except Exception as error:  # a bug here must never leave the link busy forever
                LOG.exception("portal exchange failed unexpectedly")
                result = Exchange(ack_failed=True, polled=True, poll_error=PortalError(f"internal error: {type(error).__name__}"))
            with self._lock:
                if generation == self._generation:  # not abandoned meanwhile
                    self._result = result
                    self._busy = False

        threading.Thread(target=run, name="portal-exchange", daemon=True).start()

    def take(self) -> Optional[Exchange]:
        with self._lock:
            result, self._result = self._result, None
            return result

    def check(self, now: float, abandon_after_s: float) -> Tuple[Optional[Exchange], bool, bool]:
        """(finished result or None, still busy, abandoned just now) read as ONE step.

        Reading the result and the busy flag in two separate steps lets a worker
        finish in between: the result is then missed, a new exchange starts, and
        the earlier reply (possibly holding a command) is overwritten and lost."""
        with self._lock:
            result, self._result = self._result, None
            busy = self._busy
            abandoned = False
            if busy and result is None and now - self.started_at > abandon_after_s:
                self._generation += 1
                self._busy = False
                busy = False
                abandoned = True
            return result, busy, abandoned


class GateController:
    def __init__(self, config: Config, io: GateIO, portal: PortalClient, journal: Journal,
                 clock: Callable[[], float] = time.monotonic, threaded_network: bool = True) -> None:
        self.cfg = config
        self.io = io
        self.portal = portal
        self.journal = journal
        self.clock = clock
        self.link = PortalLink(threaded_network)
        self.relay = RelaySupervisor(io.relay, config.hold_max_s, config.network_loss_release_s,
                                     config.loop_stall_s, journal.audit, clock)
        # Optional access-board exit-button press. Its deadline is enforced by the same watchdog.
        self.unlock: Optional[PulseOutput] = None
        if config.unlock_relay_pin is not None:
            self.unlock = PulseOutput(io.unlock_relay, journal.audit, clock)
            self.relay.add_companion(self.unlock.enforce)
        self.pending: Optional[PendingOpen] = None
        self.unlock_fault = ""          # last unlock problem, reported until the next confirmed unlock
        self._board_unlocked = False    # previous reading of the board's unlock signal (edge detection)
        self.tracker = PositionTracker(config.debounce_s, config.travel_timeout_s, config.open_reed_pin is not None)
        self.job: Optional[Job] = None
        self.pending_acks: List[Dict[str, Any]] = []
        self._open_times: "deque[float]" = deque()   # when recent non-emergency OPEN commands were started
        self._alarm_reported = False
        # No portal exchange at all (heartbeat OR acknowledgement) until the reeds have
        # been read stable for one debounce period after the FIRST tick, so a restart
        # never reports "unknown" for a gate that is shut. Counted from the first tick,
        # not construction, so slow start-up work cannot use the margin up.
        self._first_tick: Optional[float] = None
        self.next_poll = 0.0
        self.next_ack = 0.0
        self.poll_failures = 0
        self.position = "unknown"
        self.safety_ok = False
        self.faults: List[str] = []
        # The hold is restored first so the report about an interrupted command can say truthfully whether the
        # relay is on (audit controller F3: it said "the relay is off" and the next line switched a fire hold on).
        self._restore_emergency_hold()
        self._recover_interrupted()

    # ------------------------------------------------------------- start-up
    def _restore_emergency_hold(self) -> None:
        """A fire / evacuation hold that was on when the controller stopped (crash, update, power cut) is switched on
        again, unless it is older than EMERGENCY_RESTORE_MAX_S. Only an explicit close, or the process being stopped
        on purpose by an installer, ends it; a restart must not quietly end an evacuation."""
        since = self.journal.emergency_since
        if since is None:
            return
        age = time.time() - since
        # A Pi has no battery clock: after a power cut it boots with the time last saved (fake-hwclock), which can be
        # EARLIER than when the fire hold started, until NTP corrects it. A record "from the future" therefore means
        # the clock is behind, not that the record is bad. It is restored (and kept) rather than erased, so a power
        # cut during an evacuation does not silently end the hold (audit 24 Oct 2026, controller F1).
        clock_behind = age < 0
        if self.cfg.dry_run or self.cfg.monitor_only or self.cfg.emergency_restore_max_s <= 0 or age > self.cfg.emergency_restore_max_s:
            self.journal.audit("emergency_hold_not_restored", {"age_s": round(age)})
            self.journal.set_emergency_hold(False)
            return
        self.relay.hold("emergency")
        self.journal.audit("emergency_hold_restored", {"age_s": round(age), "clock_behind_record": clock_behind})

    def _recover_interrupted(self) -> None:
        flight = self.journal.interrupted()
        if not flight:
            return
        if self.relay.state.mode == "holding" and self.relay.state.hold_kind == "emergency":
            detail = "Controller restarted during this command. It was not repeated; the fire / evacuation hold was restored."
        else:
            detail = "Controller restarted during this command. It was not repeated; the relay is off."
        self.journal.finish(int(flight["id"]), "failed", detail)
        self._queue_ack(int(flight["id"]), "failed", detail, live=True)  # no reading exists yet: report at send time
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
        if self.unlock_fault:
            faults.append(self.unlock_fault)
        state = self.relay.state
        if state.mode == "holding" and state.hold_kind == "emergency" and now - state.hold_since > self.cfg.emergency_alarm_s:
            hours = (now - state.hold_since) / 3600.0
            faults.append(f"Fire / evacuation hold has been on for {hours:.1f} h. Send the all-clear close when it is over")
            if not self._alarm_reported:
                self._alarm_reported = True
                self.journal.audit("emergency_hold_long", {"hours": round(hours, 1)})
        elif state.mode != "holding" or state.hold_kind != "emergency":
            self._alarm_reported = False
        self._watch_board(now)
        self.position = reading.position
        self.safety_ok = safety is True and not reading.faults
        self.faults = faults[:8]
        # Interlock: an unhealthy safety input ends pulses and schedule/manual holds.
        # A fire hold is kept: the operator's own safety devices still govern motion.
        if not self.safety_ok and self.relay.state.mode != "idle" and self.relay.state.hold_kind != "emergency":
            self.relay.release("safety input not healthy")
        if not self.safety_ok and self.pending and self.pending.source != "emergency":
            self._fail_pending(self.pending, "Local safety circuit became unhealthy while waiting for the unlock. Gate relay not operated.")

    def _watch_board(self, now: float) -> None:
        """Log each unlock the access board makes by itself (card, QR code, exit button, its software)."""
        sensed = self.io.unlock_sensed()
        if sensed is None:
            return
        if sensed and not self._board_unlocked and not (self.unlock and self.unlock.active) and not self.pending:
            self.journal.audit("board_unlock_seen", {"note": "access board unlocked this door itself"})
        self._board_unlocked = bool(sensed)

    # ------------------------------------------------------------------ tick
    def _inputs_settled(self, now: float) -> bool:
        if self._first_tick is None:
            self._first_tick = now
        return now - self._first_tick >= self.cfg.debounce_s + 0.2

    def tick(self) -> None:
        now = self.clock()
        self.relay.feed()
        self.relay.enforce(now)
        self._sense(now)
        self._advance_pending(now)
        self._follow_job(now)
        if self._inputs_settled(now):
            self._network(now)

    # ------------------------------------------------------- access-board unlock
    def _needs_unlock(self) -> bool:
        """Press the board's exit button only when the gate actually has to move off the lock."""
        return self.unlock is not None and self.relay.state.mode != "holding" and self.position != "open"

    def _begin_unlock(self, command_id: int, source: str, now: float) -> None:
        assert self.unlock is not None
        if source == "emergency":
            # A press left over from the command this one superseded must not make a fire command fail.
            self.unlock.off("superseded by fire / evacuation command")
        if not self.unlock.pulse(self.cfg.unlock_pulse_s):
            self._fail_pending(PendingOpen(command_id, source, "confirm", now), "Unlock relay busy. Gate relay not operated.")
            return
        if self.cfg.unlock_sense_pin is not None and source != "emergency":
            self.pending = PendingOpen(command_id, source, "confirm", now + self.cfg.unlock_confirm_timeout_s)
        else:
            self.pending = PendingOpen(command_id, source, "lead", now + self.cfg.unlock_lead_s)

    def _advance_pending(self, now: float) -> None:
        pending = self.pending
        if not pending:
            return
        if pending.phase == "confirm":
            if self.io.unlock_sensed():
                self.unlock_fault = ""
                self.journal.audit("unlock_confirmed", {"id": pending.command_id})
                pending.phase, pending.deadline = "lead", now + self.cfg.unlock_lead_s
            elif now >= pending.deadline:
                self.unlock_fault = "Access board did not confirm the last unlock"
                self.journal.audit("unlock_not_confirmed", {"id": pending.command_id})
                self._fail_pending(pending, f"Access board did not confirm the unlock within {self.cfg.unlock_confirm_timeout_s:g} s. "
                                            "Gate relay NOT operated: the magnetic lock may still be locked.")
                return
        if pending.phase == "lead" and now >= pending.deadline:
            self.pending = None
            self._start_open(pending.command_id, pending.source, now, "Access board unlock requested; ")

    def _fail_pending(self, pending: PendingOpen, detail: str) -> None:
        if self.pending is pending:
            self.pending = None
        self.journal.finish(pending.command_id, "failed", detail)
        self.journal.audit("command_result", {"id": pending.command_id, "state": "failed", "position": self.position})
        self._queue_ack(pending.command_id, "failed", detail)
        self.next_poll = 0.0

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
        if state == "failed" and job.target == "open":
            self._drop_unconfirmed_hold(job.source)
        self.journal.finish(job.command_id, state, detail)
        self.journal.audit("command_result", {"id": job.command_id, "state": state, "position": self.position})
        self._queue_ack(job.command_id, state, detail)
        self.job = None
        self.next_poll = 0.0  # report the outcome promptly

    # ------------------------------------------------------------------ portal
    def _network(self, now: float) -> None:
        """Start, or collect, one portal exchange. Never waits on the network."""
        finished, busy, abandoned = self.link.check(now, EXCHANGE_ABANDON_S)
        if finished is not None:
            self._absorb(finished, now)
        if abandoned:
            LOG.warning("portal exchange abandoned after %.0f s; starting a new one", now - self.link.started_at)
            self.journal.audit("portal_exchange_abandoned", {"seconds": round(now - self.link.started_at)})
        if busy:
            if not self.link.stall_reported and now - self.link.started_at > EXCHANGE_STALL_WARN_S:
                self.link.stall_reported = True
                LOG.warning("portal exchange still waiting after %.0f s; relay supervision continues", now - self.link.started_at)
                self.journal.audit("portal_exchange_stalled", {"seconds": round(now - self.link.started_at)})
            return
        acks_due = bool(self.pending_acks) and now >= self.next_ack
        # Acknowledgements always travel with a poll, so the heartbeat that
        # follows them leaves the portal holding the CURRENT position.
        poll_due = now >= self.next_poll or acks_due
        if not poll_due:
            return
        if acks_due:
            for ack in self.pending_acks:
                if ack.get("live"):
                    ack["position"], ack["safety_ok"], ack["live"] = self.position, self.safety_ok, False
        acks = list(self.pending_acks) if acks_due else []
        status = (self.position, self.safety_ok, list(self.faults), self.cfg.schedule_control)
        self.link.start(lambda: self._exchange(acks, status), now)
        if not self.link.threaded:
            finished = self.link.take()
            if finished is not None:
                self._absorb(finished, now)

    def _exchange(self, acks: List[Dict[str, Any]], status: Optional[Tuple[str, bool, List[str], bool]]) -> Exchange:
        """Runs on the worker thread in the service: touches only the portal client, never controller state."""
        result = Exchange()
        for ack in acks:
            try:
                self.portal.ack(ack["id"], ack["state"], ack["position"], ack["safety_ok"], ack["detail"])
                result.delivered.append(ack)
            except PortalError as error:
                unknown_command = error.status == 404 and "command not found" in str(error).lower()
                if error.status in ACK_REJECTED_STATUSES or unknown_command:
                    result.delivered.append(ack)  # the portal will never take this one (unknown / already closed): stop retrying
                    result.rejected += 1
                else:
                    result.ack_failed = True
                    break  # the ack route is failing: don't spend a timeout on every queued ack before the poll
        if status is not None:
            result.polled = True
            try:
                result.response = self.portal.poll(*status)
            except PortalError as error:
                result.poll_error = error
        return result

    def _absorb(self, exchange: Exchange, now: float) -> None:
        """Apply an exchange's outcome. Always on the control-loop thread."""
        if exchange.delivered:
            sent = {id(ack) for ack in exchange.delivered}
            self.pending_acks = [ack for ack in self.pending_acks if id(ack) not in sent]
        if exchange.rejected:
            self.journal.audit("ack_rejected_by_portal", {"count": exchange.rejected})
        self._absorb_poll(exchange, now)
        if exchange.ack_failed:
            # Retry undelivered acknowledgements no sooner than the poll back-off.
            self.next_ack = max(now + ACK_RETRY_S, self.next_poll)

    def _absorb_poll(self, exchange: Exchange, now: float) -> None:
        if not exchange.polled:
            return
        if exchange.poll_error is not None or exchange.response is None:
            error = exchange.poll_error or PortalError("empty response")
            self.poll_failures += 1
            backoff = min(30.0, 2.0 ** min(self.poll_failures, 5))
            self.next_poll = now + backoff
            if self.poll_failures in (1, 5) or self.poll_failures % 20 == 0:
                LOG.warning("portal poll failed (%s); retry in %.0f s", error, backoff)
                self.journal.audit("portal_unreachable", {"failures": self.poll_failures, "status": error.status})
            return
        response = exchange.response
        self.relay.portal_ok()
        if self.poll_failures:
            self.journal.audit("portal_reachable", {"after_failures": self.poll_failures})
        self.poll_failures = 0
        try:
            wait_ms = float(response.get("pollAfterMs", 1500))
        except (TypeError, ValueError, OverflowError):
            wait_ms = 1500.0
        if not math.isfinite(wait_ms):
            # NaN would make next_poll NaN: "now >= NaN" is never true, so polling would stop for ever.
            wait_ms = 1500.0
        self.next_poll = now + min(max(wait_ms / 1000.0, 0.5), 5.0)
        command = response.get("command")
        if isinstance(command, dict):
            try:
                self._handle(command, now)
            except Exception:  # noqa: BLE001 - a bad command must never end the process (that would drop a fire hold)
                LOG.exception("command handling failed")
                self.journal.audit("command_handler_error", {})
                self._recover_failed_handler(command)

    def _recover_failed_handler(self, command: Dict[str, Any]) -> None:
        """If handling raised after the command was journalled but before it became a job, finish it as failed."""
        try:
            command_id = command["id"]
            if isinstance(command_id, bool) or not isinstance(command_id, int):
                return
            if (self.job and self.job.command_id == command_id) or (self.pending and self.pending.command_id == command_id):
                return
            flight = self.journal.in_flight
            if flight and flight.get("id") == command_id:
                detail = "Controller error while starting this command. The relay was not left on."
                if self.relay.state.hold_kind != "emergency":
                    self.relay.release("command handling error")
                self.journal.finish(command_id, "failed", detail)
                self._queue_ack(command_id, "failed", detail)
        except Exception:  # noqa: BLE001
            LOG.exception("could not clean up after a failed command")

    def _queue_ack(self, command_id: int, state: str, detail: str, live: bool = False) -> None:
        # Position and safety are captured when the result is known, so an
        # acknowledgement sent later (after a network delay) still reports the
        # reading that the result was based on. live=True (a command interrupted
        # by a restart, queued before any reading) takes the reading at send time.
        if any(ack["id"] == command_id for ack in self.pending_acks):
            return  # one answer per command is enough: a portal that keeps re-sending it must not grow the queue
        self.pending_acks.append({"id": command_id, "state": state, "detail": detail,
                                  "position": self.position, "safety_ok": self.safety_ok, "live": live})
        if len(self.pending_acks) > MAX_PENDING_ACKS:
            dropped = self.pending_acks.pop(0)
            self.journal.audit("ack_dropped_queue_full", {"id": dropped["id"]})

    # ------------------------------------------------------------- commands
    def _refuse(self, command_id: int, state: str, detail: str) -> None:
        """Record and report a command that was deliberately not carried out (relay untouched)."""
        self.journal.finish(command_id, state, detail)
        self.journal.audit("command_refused", {"id": command_id, "state": state, "detail": detail})
        self._queue_ack(command_id, state, detail)

    def _handle(self, command: Dict[str, Any], now: float) -> None:
        raw_id, raw_target, raw_source = command.get("id"), command.get("command"), command.get("source", "manual")
        # The id must be a real positive integer. int() would accept 12.0 and "12", and raises OverflowError on the
        # JSON value Infinity, which used to end the process.
        if (isinstance(raw_id, bool) or not isinstance(raw_id, int) or not 0 < raw_id < 2 ** 53
                or not isinstance(raw_target, str) or not isinstance(raw_source, str)):
            self.journal.audit("command_malformed", {})
            return
        command_id, target, source = raw_id, raw_target, raw_source
        if target not in {"open", "closed"}:
            self.journal.audit("command_unsupported", {"id": command_id, "command": target})
            self._queue_ack(command_id, "failed", f"Unsupported command {target[:40]!r}.")
            return
        if source not in VALID_SOURCES:
            self.journal.audit("command_unsupported", {"id": command_id, "source": source})
            self._queue_ack(command_id, "failed", f"Unsupported command source {source[:40]!r}.")
            return

        if self.journal.seen(command_id):
            if (self.job and self.job.command_id == command_id) or (self.pending and self.pending.command_id == command_id):
                return  # still working on it; the portal re-sent it after its lease
            outcome = self.journal.done.get(str(command_id), {})
            recorded = outcome.get("outcome", "unknown")
            # Report what really happened the first time. A command that was refused or failed is never turned into a
            # success because the gate happens to be in the right place now (someone opened it by hand, say).
            if recorded == "acknowledged":
                state = "acknowledged" if self.position == target else "failed"
            elif recorded == "blocked":
                state = "blocked"
            else:
                state = "failed"
            self._queue_ack(command_id, state, f"Already handled ({recorded}); not repeated.")
            return

        if source == "schedule" and target == "open" and not self.cfg.schedule_control:
            # SCHEDULE_CONTROL=false is the commissioning stage where the portal's schedules must not move the gate.
            # The flag is also sent in every heartbeat, but a command already queued would otherwise still run.
            self._refuse(command_id, "blocked", "Schedule control is off on this controller. Relay not operated.")
            return

        if self.job or self.pending:
            if source != "emergency":
                return  # busy; the portal re-dispatches after its 30 s lease
            if self.job:
                self._complete(self.job, "failed", "Superseded by fire / evacuation command.")
            if self.pending:
                self._fail_pending(self.pending, "Superseded by fire / evacuation command.")

        # Releasing a hold is the safe direction, so a CLOSE is not stopped by an unhealthy safety input (otherwise
        # a fire hold could never be ended while a safety device is tripped). Everything else needs a healthy gate.
        if self.cfg.monitor_only or (target == "open" and not self.safety_ok):
            detail = ("Monitor-only controller: no safety input fitted. Relay not operated."
                      if self.cfg.monitor_only else "Local safety circuit not healthy. Relay not operated.")
            self._refuse(command_id, "blocked", detail)
            return
        if self.cfg.dry_run:
            self._refuse(command_id, "failed", "Dry run: relay not operated.")
            return
        if (target == "closed" and self.relay.state.mode == "holding" and self.relay.state.hold_kind == "emergency"
                and source not in EMERGENCY_RELEASE_SOURCES):
            # A schedule window ending must not end an evacuation hold. Only the emergency all-clear or a staff
            # member's manual close may.
            self._refuse(command_id, "blocked", f"Fire / evacuation hold kept: a {source} close cannot end it.")
            return

        if target == "open" and source != "emergency":
            window = self.cfg.open_rate_window_s
            while self._open_times and now - self._open_times[0] > window:
                self._open_times.popleft()
            if len(self._open_times) >= self.cfg.open_rate_max:
                self._refuse(command_id, "blocked", f"More than {self.cfg.open_rate_max} open commands in {window / 60:g} minutes. "
                                                    "Relay not operated.")
                return
            self._open_times.append(now)

        try:
            ends_hold = target == "closed" and source in EMERGENCY_RELEASE_SOURCES and self.journal.emergency_since is not None
            self.journal.begin({"id": command_id, "command": target, "source": source}, ends_emergency_hold=ends_hold)
        except OSError as error:
            detail = f"Execution journal could not be written ({error.strerror}). Relay not operated."
            self._queue_ack(command_id, "failed", detail)
            return
        self.journal.audit("command_start", {"id": command_id, "command": target, "source": source})

        if target == "open":
            if self._needs_unlock():
                self._begin_unlock(command_id, source, now)  # the gate is driven on a later tick
                return
            self._start_open(command_id, source, now)
            return
        was_emergency = self.relay.state.mode == "holding" and self.relay.state.hold_kind == "emergency"
        released = self.relay.release(f"portal close command ({source})")
        if was_emergency or self.journal.emergency_since is not None:
            self.journal.set_emergency_hold(False)
        action = "Hold released; operator auto-closes" if released else "No hold active; waiting for auto-close"
        self.tracker.movement_started(now)
        self.job = Job(command_id, "closed", source, now + self.cfg.auto_close_timeout_s, action)
        self._follow_job(now)

    def _start_open(self, command_id: int, source: str, now: float, prefix: str = "") -> None:
        """Drive the gate relay for an open (unchanged behaviour, now also reached after an unlock)."""
        if source in HOLD_SOURCES:
            self.relay.hold(source)
            if source == "emergency":
                self.journal.set_emergency_hold(True)
            action = f"{prefix}Relay held for {source} open"
        elif self.relay.state.mode == "holding":
            action = f"{prefix}Gate already held open; no pulse sent"
        elif self.relay.pulse(self.cfg.cycle_pulse_s):
            action = f"{prefix}Relay pulsed {self.cfg.cycle_pulse_s:g} s for an open cycle"
        else:
            action = f"{prefix}Pulse refused by relay interlock"
        self.tracker.movement_started(now)
        if self.cfg.open_reed_pin is None and self.position != "open":
            self._drop_unconfirmed_hold(source)
            detail = f"{action}. No open-position reed is fitted, so the open cannot be confirmed."
            self.journal.finish(command_id, "failed", detail)
            self._queue_ack(command_id, "failed", detail)
            return
        self.job = Job(command_id, "open", source, now + self.cfg.travel_timeout_s, action)
        self._follow_job(now)

    def _drop_unconfirmed_hold(self, source: str) -> None:
        """An open that could not be confirmed is reported failed, so the relay must not stay on for hours behind that
        report. A schedule hold is released (the portal retries with a new command). A fire hold is kept: for
        life safety the gate stays open until someone ends it."""
        if source != "emergency" and self.relay.state.mode == "holding" and self.relay.state.hold_kind != "emergency":
            self.relay.release("open not confirmed")

    # ---------------------------------------------------------------- stop
    def shutdown(self) -> None:
        """Both relays off and GPIO released. Called on SIGTERM, SIGINT and any fatal error."""
        try:
            self.relay.release("controller stopping")
            if self.unlock is not None:
                self.unlock.off("controller stopping")
        finally:
            self.io.shutdown()
            self.journal.audit("controller_stopped", {})
