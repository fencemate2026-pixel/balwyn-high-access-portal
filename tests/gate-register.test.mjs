import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_GATES, GATES, gateVisualState, isGateActive } from "../lib/portal-model.ts";

const activeGate = GATES.find((gate) => gate.id === "TF-ENTRY");
// No inactive gate remains in the register; a synthetic one proves inactive gates still render as inactive.
const inactiveGate = { ...GATES.find((gate) => gate.id === "TF-ENTRY"), id: "RETIRED-GATE", name: "Retired gate", active: false };
const runtime = (patch = {}) => ({
  gateId: activeGate.id, commandedPosition: "closed", reportedPosition: "closed",
  controllerState: "online", safetyOk: true, lastSeen: new Date().toISOString(),
  lastCommandState: "acknowledged", lastCommandId: 1, lastError: null,
  credentialIssued: true, commissioned: true, ...patch,
});

test("the register holds only the two connected swing entries, both active", () => {
  assert.deepEqual(GATES.map((gate) => [gate.id, gate.name, gate.kind, gate.active]), [
    ["TF-ENTRY", "Tony Frizza Stadium Entry", "single-swing", true],
    ["SIDE-ENTRY", "Side Entry", "single-swing", true],
  ]);
  assert.equal(ACTIVE_GATES.length, 2);
  for (const id of ["TF-EXIT", "OFFICE-ENTRY-BOOM1", "STAFF-ENTRY-BOOM", "missing", "__proto__"]) {
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
