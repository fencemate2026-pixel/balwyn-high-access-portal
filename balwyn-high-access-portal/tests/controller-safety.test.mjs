import assert from "node:assert/strict";
import test from "node:test";

import {
  commandIsInFlight,
  heartbeatCompletesCommissioning,
  validateControllerAcknowledgement,
} from "../lib/controller-safety.ts";

test("commissioning requires healthy safety and a confirmed physical position", () => {
  assert.equal(heartbeatCompletesCommissioning("open", true), true);
  assert.equal(heartbeatCompletesCommissioning("closed", true), true);
  assert.equal(heartbeatCompletesCommissioning("unknown", true), false);
  assert.equal(heartbeatCompletesCommissioning("moving", true), false);
  assert.equal(heartbeatCompletesCommissioning("closed", false), false);
});

test("only queued and dispatched command packets are in flight", () => {
  assert.equal(commandIsInFlight("queued"), true);
  assert.equal(commandIsInFlight("dispatched"), true);
  assert.equal(commandIsInFlight("acknowledged"), false);
  assert.equal(commandIsInFlight("failed"), false);
  assert.equal(commandIsInFlight("blocked"), false);
});

test("a matching healthy physical acknowledgement is accepted", () => {
  assert.deepEqual(validateControllerAcknowledgement({
    expected: "open",
    state: "acknowledged",
    position: "open",
    safetyOk: true,
    detail: "Open limit confirmed.",
  }), { state: "acknowledged", detail: "Open limit confirmed." });
});

test("mismatched or unsafe acknowledgements are recorded as failures", () => {
  const wrongPosition = validateControllerAcknowledgement({
    expected: "closed",
    state: "acknowledged",
    position: "open",
    safetyOk: true,
    detail: null,
  });
  assert.equal(wrongPosition.state, "failed");
  assert.match(wrongPosition.detail, /expected closed/);

  const unsafe = validateControllerAcknowledgement({
    expected: "open",
    state: "acknowledged",
    position: "open",
    safetyOk: false,
    detail: null,
  });
  assert.equal(unsafe.state, "failed");
  assert.match(unsafe.detail, /not healthy/);
});
