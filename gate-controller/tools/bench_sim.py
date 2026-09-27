#!/usr/bin/env python3
"""Bench simulator: runs the REAL controller against a portal, with a SIMULATED
gate instead of GPIO. Nothing here can drive a relay (FakeBackend only).

  PORTAL_URL=... GATE_ID=... CONTROLLER_TOKEN=... python3 tools/bench_sim.py SECONDS

Used by the portal end-to-end test and for rehearsing commissioning off site.
Gate: travel SIM_TRAVEL_S (default 3), auto-close after SIM_AUTO_CLOSE_S (default 5).
Pins are fixed: relay 17, closed reed 22, open reed 23, safety 24 (all simulated).
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from balwyn_gate_controller.config import Config  # noqa: E402
from balwyn_gate_controller.controller import GateController  # noqa: E402
from balwyn_gate_controller.hardware import FakeBackend, GateIO  # noqa: E402
from balwyn_gate_controller.journal import Journal  # noqa: E402
from balwyn_gate_controller.portal import PortalClient  # noqa: E402
from test_controller import SimGate  # noqa: E402

env = {**os.environ, "RELAY_PIN": "17", "RELAY_ACTIVE_LOW": "true", "CLOSED_REED_PIN": "22", "OPEN_REED_PIN": "23",
       "SAFETY_INPUT": "24", "INPUT_ACTIVE_LOW": "true", "INPUT_PULL": "up"}
config = Config.from_env(env)
backend = FakeBackend()
gate = SimGate(backend, travel=float(os.environ.get("SIM_TRAVEL_S", "3")), auto_close=float(os.environ.get("SIM_AUTO_CLOSE_S", "5")))
io = GateIO(backend, config.relay_pin, config.relay_active_low, config.closed_reed_pin, config.open_reed_pin,
            config.safety_pin, config.input_active_low, config.input_pull)
controller = GateController(config, io, PortalClient(config.portal_url, config.gate_id, config.token), Journal(config.state_dir))
end = time.monotonic() + float(sys.argv[1] if len(sys.argv) > 1 else 20)
last = time.monotonic()
try:
    while time.monotonic() < end:
        now = time.monotonic()
        gate.step(now - last)
        last = now
        controller.tick()
        time.sleep(0.05)
finally:
    controller.shutdown()
print(f"SIM_DONE angle={gate.angle:.2f} relay_on_writes={sum(1 for p, l in backend.writes if p == 17 and l == 0)}", flush=True)
