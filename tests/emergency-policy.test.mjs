import assert from "node:assert/strict";
import test from "node:test";
import { EmergencyCommandError, resolveEmergencyCommand } from "../lib/emergency-policy.ts";

test("fire evacuation is the only emergency command and only asks gates to open", () => {
  assert.deepEqual(resolveEmergencyCommand("fire"), { mode: "fire", position: "open" });
});

test("lockdown is refused server-side on this site", () => {
  assert.throws(() => resolveEmergencyCommand("lockdown"), (error) =>
    error instanceof EmergencyCommandError && /Lockdown is not available on this site/.test(error.message));
});

test("unknown, empty and non-string emergency modes are refused", () => {
  for (const mode of ["", "FIRE", "evacuate", "close", null, undefined, 1, {}]) {
    assert.throws(() => resolveEmergencyCommand(mode), EmergencyCommandError);
  }
});
