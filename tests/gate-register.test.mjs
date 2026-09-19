import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_GATES, GATES, gateVisualState, isGateActive } from "../lib/portal-model.ts";

const activeGate = GATES.find((gate) => gate.id === "TF-ENTRY");
const inactiveGate = GATES.find((gate) => gate.id === "TF-EXIT");
const runtime = (patch = {}) => ({
  gateId: activeGate.id, commandedPosition: "closed", reportedPosition: "closed",
  controllerState: "online", safetyOk: true, lastSeen: new Date().toISOString(),
  lastCommandState: "acknowledged", lastCommandId: 1, lastError: null,
  credentialIssued: true, commissioned: true, ...patch,
});

test("only the two specified swing entries are active within the nine-gate register", () => {
  assert.equal(GATES.length, 9);
  assert.equal(new Set(GATES.map((gate) => gate.id)).size, 9);
  assert.deepEqual(ACTIVE_GATES.map((gate) => [gate.name, gate.kind]), [
    ["Tony Frizza Stadium Entry", "single-swing"], ["Side Entry", "single-swing"],
  ]);
  assert.deepEqual(GATES.filter((gate) => !gate.active).map((gate) => gate.name), [
    "Tony Frizza Exit Single Gate", "Office Entry 1 Double Swing Gates",
    "Office Exit 1 Double Swing Gates", "Staff Car Park Entry Double Swing Gates",
    "Staff Entry Boom Gate", "Office Entry 1 Boom Gate", "Office Exit 1 Boom Gate",
  ]);
  for (const id of ["TF-EXIT", "SCP-B01", "SCP-B12", "FRONT-DG01", "missing", "__proto__"]) {
    assert.equal(isGateActive(id), false);
  }
});

test("indicators switch between open and closed only from current confirmed position", () => {
  assert.equal(gateVisualState(activeGate, runtime()), "closed");
  assert.equal(gateVisualState(activeGate, runtime({ reportedPosition: "open" })), "open");
  assert.equal(gateVisualState(activeGate, runtime({ commandedPosition: "open" })), "closed");
  assert.equal(gateVisualState(activeGate, runtime({ reportedPosition: "moving" })), "unknown");
});

test("inactive lights stay off even if old runtime data claims open or closed", () => {
  assert.equal(gateVisualState(inactiveGate, runtime()), "inactive");
  assert.equal(gateVisualState(inactiveGate, runtime({ reportedPosition: "open" })), "inactive");
  assert.equal(gateVisualState(inactiveGate, undefined, false), "inactive");
});

test("offline, stale, uncommissioned and pending gates do not falsely show open or closed", () => {
  for (const patch of [
    { controllerState: "offline" }, { controllerState: "fault" }, { commissioned: false },
    { lastSeen: null }, { lastSeen: "invalid" }, { lastSeen: new Date(Date.now() - 120_000).toISOString() },
    { lastCommandState: "queued" }, { lastCommandState: "dispatched" },
    { lastCommandState: "blocked" }, { lastCommandState: "failed" },
  ]) assert.equal(gateVisualState(activeGate, runtime(patch)), "unknown");
  assert.equal(gateVisualState(activeGate, undefined), "unknown");
  assert.equal(gateVisualState(activeGate, runtime(), false), "unknown");
});
