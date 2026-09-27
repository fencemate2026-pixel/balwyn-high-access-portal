"""Entry point.

  python -m balwyn_gate_controller               run (systemd service)
  python -m balwyn_gate_controller check-config  validate settings, touch nothing
  python -m balwyn_gate_controller read-inputs   print reeds + safety for 30 s.
                                                 The relay is claimed OFF and never energised.
"""

from __future__ import annotations

import logging
import signal
import sys
import time

from . import __version__
from .config import Config, ConfigError
from .controller import GateController
from .hardware import GateIO, LgpioBackend
from .journal import Journal
from .portal import PortalClient
from .sdnotify import notify

LOG = logging.getLogger("balwyn-gate")
TICK_S = 0.05


def _io(config: Config) -> GateIO:
    return GateIO(LgpioBackend(), config.relay_pin, config.relay_active_low, config.closed_reed_pin,
                  config.open_reed_pin, config.safety_pin, config.input_active_low, config.input_pull)


def read_inputs(config: Config) -> int:
    io = _io(config)
    try:
        end = time.monotonic() + 30
        while time.monotonic() < end:
            print(f"closed_reed={io.closed_reed()} open_reed={io.open_reed()} safety={io.safety_healthy()} relay=OFF", flush=True)
            time.sleep(1)
    finally:
        io.shutdown()
    return 0


def run(config: Config) -> int:
    journal = Journal(config.state_dir)
    io = _io(config)
    portal = PortalClient(config.portal_url, config.gate_id, config.token, config.ca_file)
    controller = GateController(config, io, portal, journal)
    stopping = False

    def stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        LOG.info("signal %s received: stopping", signum)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    watchdog = controller.relay.start_watchdog()
    journal.audit("controller_started", {"version": __version__, "gate": config.gate_id,
                                         "monitor_only": config.monitor_only, "dry_run": config.dry_run,
                                         "open_reed": config.open_reed_pin is not None})
    LOG.info("gate %s controller %s started%s%s", config.gate_id, __version__,
             " (MONITOR ONLY)" if config.monitor_only else "", " (DRY RUN)" if config.dry_run else "")
    notify("READY=1")
    try:
        while not stopping:
            controller.tick()
            notify("WATCHDOG=1")
            time.sleep(TICK_S)
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
    try:
        config = Config.from_env()
    except ConfigError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2
    command = argv[1] if len(argv) > 1 else "run"
    if command == "check-config":
        print(f"OK: gate {config.gate_id}, relay GPIO{config.relay_pin}, closed reed GPIO{config.closed_reed_pin}, "
              f"open reed {('GPIO' + str(config.open_reed_pin)) if config.open_reed_pin is not None else 'not fitted'}, "
              f"safety {('GPIO' + str(config.safety_pin)) if config.safety_pin is not None else 'NOT FITTED (monitor-only)'}, "
              f"pulse {config.cycle_pulse_s:g} s, schedule control {'on' if config.schedule_control else 'off'}"
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
