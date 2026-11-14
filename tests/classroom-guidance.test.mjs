import assert from "node:assert/strict";
import test from "node:test";
import { classroomDisplay, classroomPayload, SCHOOL_FIRE_ROUTE } from "../lib/classroom-guidance.ts";

test("fire evacuation shows the same oval route on every classroom screen", () => {
  const display = classroomDisplay("fire");
  assert.equal(display.showing, true);
  assert.equal(display.route, SCHOOL_FIRE_ROUTE);
  assert.equal(display.route?.destination, "School oval");
  assert.equal(display.route?.origin, "Whole school");
  assert.match(display.route?.avoid ?? "", /central path/);
});

test("any other portal mode leaves the classroom screen on standby", () => {
  for (const mode of ["normal", "lockdown", "", null, undefined]) {
    assert.deepEqual(classroomDisplay(mode), { showing: false, route: null });
    assert.deepEqual(classroomPayload(mode, "2026-11-14T00:00:00.000Z"), { showing: false });
  }
});

test("the public fire payload is only the route and the time it changed", () => {
  const body = classroomPayload("fire", "2026-11-14T00:00:00.000Z");
  assert.deepEqual(Object.keys(body).sort(), ["route", "showing", "updatedAt"]);
  assert.equal(body.showing, true);
  assert.equal(body.route, SCHOOL_FIRE_ROUTE);
  assert.equal(JSON.stringify(body).includes("updated_by"), false);
});
