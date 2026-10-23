"""Entry point.

  python -m balwyn_gate_controller               run (systemd service)
  python -m balwyn_gate_controller check-config  validate settings, touch nothing
  python -m balwyn_gate_controller check-pin-plan [DIR]
                                                 compare every gate's env file in DIR (default /etc/balwyn-gate,
                                                 run with sudo) and refuse a GPIO pin used by two gates. Touches
                                                 no GPIO.
  python -m balwyn_gate_controller read-inputs   print reeds, safety and the access board's unlock
                                                 signal for 30 s. Both relays are claimed OFF and never energised.
  python -m balwyn_gate_controller relays-off    force this gate's relay outputs OFF and exit. Needs only
                                                 RELAY_PIN, UNLOCK_RELAY_PIN, RELAY_ACTIVE_LOW, RELAY_BOARD.
                                                 Run by systemd after EVERY stop (ExecStopPost), including a
                                                 crash or a watchdog kill, when the controller's own clean-up
                                                 never ran.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from typing import Callable

from . import __version__
from .config import Config, ConfigError, relay_outputs_from_env
from .controller import GateController
from .hardware import GateIO, GpioBusyError, LgpioBackend, force_relays_off, record_relay_outputs, recorded_relay_outputs
from .journal import Journal
from .portal import PortalClient
from .sdnotify import notify

LOG = logging.getLogger("balwyn-gate")
TICK_S = 0.05
# One bad tick (a transient GPIO read error, an odd portal reply) must not end the process: ending it releases
# every relay, including a fire / evacuation hold. A fault that persists for this many ticks in a row (~5 s) is
# real: stop, release, and let systemd restart cleanly.
MAX_CONSECUTIVE_TICK_FAILURES = 100


def _io(config: Config) -> GateIO:
    # lgpio needs a writable directory for its notification FIFO (see hardware.py).
    return GateIO(LgpioBackend(config.state_dir / "lgpio"), config.relay_pin, config.relay_active_low, config.closed_reed_pin,
                  config.open_reed_pin, config.safety_pin, config.input_active_low, config.input_pull,
                  unlock_relay_pin=config.unlock_relay_pin, unlock_sense_pin=config.unlock_sense_pin)


def relays_off() -> int:
    """systemd ExecStopPost: drive this gate's relays OFF whatever the rest of the configuration says."""
    import os
    from pathlib import Path
    state = Path(os.environ.get("STATE_DIRECTORY", "/var/lib/balwyn-gate").split(os.pathsep)[0])
    status = 0
    # 1. The pins the last controller process actually claimed (survives an edited env file).
    plans = []
    recorded = recorded_relay_outputs(state)
    if recorded is not None:
        plans.append(("recorded", recorded[0], recorded[1]))
    # 2. The pins the env file names now.
    try:
        pins, active_low = relay_outputs_from_env()
        plans.append(("settings", pins, active_low))
    except ConfigError as error:
        print(f"relays-off: settings not usable ({error}); using the recorded pins only", file=sys.stderr)
        status = 2
    if not plans:
        print("relays-off: no relay pins known: nothing driven", file=sys.stderr)
        return 2
    polarities = {active_low for _source, _pins, active_low in plans}
    if len(polarities) > 1:
        # The recorded polarity is what the dead process used; trust it over an edited file.
        print("relays-off: RELAY_ACTIVE_LOW differs from the recorded value; using the recorded value", file=sys.stderr)
        plans = [plans[0]]
        status = 2
    active_low = plans[0][2]
    pins = []
    for _source, plan_pins, _ in plans:
        pins += [p for p in plan_pins if p not in pins]
    try:
        backend = LgpioBackend(state / "lgpio")
    except Exception as error:  # noqa: BLE001 - this runs after a crash: report, never raise
        print(f"relays-off: GPIO chip could not be opened: {error}", file=sys.stderr)
        return 1
    done, failed = force_relays_off(backend, pins, active_low)
    if done:
        print(f"relays-off: GPIO {', '.join(str(p) for p in done)} driven OFF and released", flush=True)
    for pin, error in failed.items():
        print(f"relays-off: GPIO {pin} NOT driven: {error}", file=sys.stderr)
    return 1 if failed else status


def read_inputs(config: Config) -> int:
    try:
        io = _io(config)
    except GpioBusyError as error:
        print(f"{error} Stop this gate's service first: sudo systemctl stop balwyn-gate@{config.gate_id}", file=sys.stderr)
        return 3
    try:
        end = time.monotonic() + 30
        while time.monotonic() < end:
            print(f"closed_reed={io.closed_reed()} open_reed={io.open_reed()} safety={io.safety_healthy()} "
                  f"board_unlocked={io.unlock_sensed()} relays=OFF", flush=True)
            time.sleep(1)
    finally:
        io.shutdown()
    return 0


def tick_loop(controller: GateController, journal: Journal, should_stop: Callable[[], bool],
              sleep: Callable[[float], None] = time.sleep, heartbeat: Callable[[str], None] = notify) -> None:
    """Run controller.tick() until should_stop(). One bad tick is survived; a persistent fault is raised."""
    failures = 0
    while not should_stop():
        try:
            controller.tick()
        except Exception:  # noqa: BLE001 - see MAX_CONSECUTIVE_TICK_FAILURES
            failures += 1
            if failures == 1:
                LOG.exception("controller tick failed (relay supervision continues)")
                journal.audit("tick_failed", {})
            if failures >= MAX_CONSECUTIVE_TICK_FAILURES:
                raise
        else:
            failures = 0
            heartbeat("WATCHDOG=1")  # only a healthy tick feeds systemd: a loop that always fails is restarted
        sleep(TICK_S)


def run(config: Config) -> int:
    journal = Journal(config.state_dir)
    try:
        io = _io(config)
    except GpioBusyError as error:
        LOG.error("%s", error)
        journal.audit("gpio_busy", {"detail": str(error)[:200]})
        return 3
    # Before anything can switch a relay on: remember which pins this process owns (see relays-off).
    record_relay_outputs(config.state_dir, [p for p in (config.relay_pin, config.unlock_relay_pin) if p is not None],
                         config.relay_active_low)
    portal = PortalClient(config.portal_url, config.gate_id, config.token, config.ca_file)
    # threaded_network: portal calls never block the relay loop or the systemd watchdog.
    controller = GateController(config, io, portal, journal, threaded_network=True)
    stopping = False

    def stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        LOG.info("signal %s received: stopping", signum)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    watchdog = controller.relay.start_watchdog()
    if io.pull_fallback:
        LOG.warning("kernel refused the OFF pull on relay GPIO %s; relay is still claimed OFF", io.pull_fallback)
        journal.audit("relay_pull_not_applied", {"pins": io.pull_fallback})
    journal.audit("controller_started", {"version": __version__, "gate": config.gate_id,
                                         "monitor_only": config.monitor_only, "dry_run": config.dry_run,
                                         "open_reed": config.open_reed_pin is not None,
                                         "board_unlock_relay": config.unlock_relay_pin is not None,
                                         "board_unlock_sense": config.unlock_sense_pin is not None})
    LOG.info("gate %s controller %s started%s%s", config.gate_id, __version__,
             " (MONITOR ONLY)" if config.monitor_only else "", " (DRY RUN)" if config.dry_run else "")
    notify("READY=1")
    try:
        tick_loop(controller, journal, lambda: stopping)
    except Exception:
        LOG.exception("fatal controller error: relay released")
        return 1
    finally:
        watchdog.stop.set()  # type: ignore[attr-defined]
        controller.shutdown()
        notify("STOPPING=1")
    return 0


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command = argv[1] if len(argv) > 1 else "run"
    if command == "relays-off":
        return relays_off()  # must work even if the full configuration does not load
    if command == "check-pin-plan":
        from pathlib import Path
        from .config import pin_plan_clashes
        directory = Path(argv[2] if len(argv) > 2 else "/etc/balwyn-gate")
        files = sorted(directory.glob("*.env"))
        if not files:
            print(f"No gate env files found in {directory}", file=sys.stderr)
            return 2
        try:
            problems = pin_plan_clashes(files)
        except OSError as error:
            print(f"Could not read the env files ({error.strerror}). Run with sudo.", file=sys.stderr)
            return 2
        for problem in problems:
            print(f"Pin plan error: {problem}", file=sys.stderr)
        if not problems:
            print(f"OK: no GPIO pin is shared between {len(files)} gate env files in {directory}")
        return 1 if problems else 0
    try:
        config = Config.from_env(need_token=command != "read-inputs")
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2
    if command == "check-config":
        if "RELAY_BOARD" not in os.environ:
            print("WARNING: RELAY_BOARD is not set (treated as generic). For the Keyestudio KS0212 shield set "
                  "RELAY_BOARD=keyestudio-ks0212 so its pins are checked.", file=sys.stderr)
        print(f"OK: gate {config.gate_id}, relay board {config.relay_board}, relay ON when "
              f"{'LOW' if config.relay_active_low else 'HIGH'}, relay GPIO{config.relay_pin}, closed reed GPIO{config.closed_reed_pin}, "
              f"open reed {('GPIO' + str(config.open_reed_pin)) if config.open_reed_pin is not None else 'not fitted'}, "
              f"safety {('GPIO' + str(config.safety_pin)) if config.safety_pin is not None else 'NOT FITTED (monitor-only)'}, "
              f"pulse {config.cycle_pulse_s:g} s, schedule control {'on' if config.schedule_control else 'off'}, "
              f"board unlock relay {('GPIO' + str(config.unlock_relay_pin) + f' ({config.unlock_pulse_s:g} s press)') if config.unlock_relay_pin is not None else 'not fitted'}, "
              f"board unlock signal {('GPIO' + str(config.unlock_sense_pin)) if config.unlock_sense_pin is not None else 'not fitted'}"
              f"{', DRY RUN' if config.dry_run else ''}")
        return 0
    if command == "read-inputs":
        return read_inputs(config)
    if command == "run":
        return run(config)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
