import assert from "node:assert/strict";
import test from "node:test";
import { gateMotion } from "../lib/gate-motion.ts";
import { GATES, gateVisualState } from "../lib/portal-model.ts";
import { resolveEmergencyCommand } from "../lib/emergency-policy.ts";

const gate = GATES[0];
const runtime = (overrides = {}) => ({
  gateId: gate.id, commandedPosition: "open", reportedPosition: "closed",
  controllerState: "online", commissioned: true, safetyOk: true,
  lastSeen: new Date().toISOString(), lastCommandState: "queued",
  lastCommandId: 1, lastError: null, credentialIssued: true, ...overrides,
});

test("open and close commands animate their requested direction without claiming confirmation", () => {
  for (const commandedPosition of ["open", "closed"]) {
    for (const lastCommandState of ["queued", "dispatched"]) {
      const status = runtime({ commandedPosition, lastCommandState });
      assert.equal(gateMotion(gate, status).target, commandedPosition);
      assert.match(gateMotion(gate, status).label, /preview.*awaiting confirmation/);
      assert.equal(gateVisualState(gate, status), "unknown", "pending LEDs must remain amber");
    }
  }
});

test("fire commands preview opening, then use green only on fresh confirmed open feedback", () => {
  const command = resolveEmergencyCommand("fire");
  const pending = runtime({ commandedPosition: command.position });
  assert.equal(gateMotion(gate, pending).target, "open");
  assert.equal(gateVisualState(gate, pending), "unknown");
  const confirmed = { ...pending, lastCommandState: "acknowledged", reportedPosition: "open" };
  assert.equal(gateMotion(gate, confirmed).label, "Confirmed open");
  assert.equal(gateVisualState(gate, confirmed), "open");
});

test("closed feedback overrides the requested position and drives the red closed indication", () => {
  const status = runtime({ lastCommandState: "acknowledged", reportedPosition: "closed" });
  assert.deepEqual(gateMotion(gate, status), { target: "closed", label: "Confirmed closed" });
  assert.equal(gateVisualState(gate, status), "closed");
});

test("moving feedback uses the accepted command direction, without guessing external movement", () => {
  for (const commandedPosition of ["open", "closed"]) {
    const moving = runtime({ commandedPosition, reportedPosition: "moving", lastCommandState: "acknowledged" });
    assert.equal(gateMotion(gate, moving).target, commandedPosition);
    assert.equal(gateVisualState(gate, moving), "unknown");
    assert.equal(gateMotion(gate, { ...moving, lastCommandId: null }).target, null);
  }
});

test("stale, failed, blocked, offline and inactive gates never animate a presumed direction", () => {
  for (const overrides of [
    { lastCommandState: "failed" }, { lastCommandState: "blocked" },
    { controllerState: "offline" }, { controllerState: "fault" }, { commissioned: false },
    { lastSeen: new Date(Date.now() - 91_000).toISOString() }, { lastSeen: null },
    { reportedPosition: "unknown", lastCommandState: "acknowledged" },
  ]) assert.equal(gateMotion(gate, runtime(overrides)).target, null);
  assert.equal(gateMotion({ ...gate, active: false }, runtime()).target, null);
  assert.equal(gateMotion(gate, runtime(), false).target, null);
});
