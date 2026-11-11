import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLine, callersWritable, clickDetail, emailMaySignIn, holdNowWindow, isSeedEmail,
  isSlidingUnit, loginCodeMaterial, pickSlidingUnit, plannedHold, portalUserName, residentEmail,
  unitOnline, windowCoversNow, withinRate,
} from "../lib/macquarie-resident.ts";

const sliding = { id: "slide-1", name: "Macquarie Drive", gate_type: "sliding", device_id: "thomastown-slide" };
const swing = { id: "swing-1", name: "Macquarie Drive", gate_type: "swing", device_id: "thomastown-swing" };

test("picks the only sliding unit and leaves the swing unit alone", () => {
  assert.equal(pickSlidingUnit([swing, sliding])?.id, "slide-1");
  assert.equal(pickSlidingUnit([swing]), null);
  assert.equal(isSlidingUnit({ id: "a", name: "Sliding Swing", gate_type: "sliding", device_id: "x" }), false);
  assert.equal(isSlidingUnit({ id: "a", name: "Double slider", gate_type: "sliding", device_id: "x" }), false);
  assert.equal(pickSlidingUnit([sliding, { ...sliding, id: "slide-2" }]), null);
});

test("caller list writes only when the sliding gate is the only gate on the site", () => {
  assert.equal(callersWritable([sliding], sliding.id), true);
  assert.equal(callersWritable([sliding, swing], sliding.id), false);
  assert.equal(callersWritable([], "missing"), false);
});

test("the RJL address can sign in before any extra user is added, and cannot be treated as removable", () => {
  assert.equal(emailMaySignIn("info@rjlcommercialgroup.com", []), true);
  assert.equal(emailMaySignIn("neighbour@example.com", []), false);
  assert.equal(emailMaySignIn("neighbour@example.com", [{ email: "Neighbour@Example.com" }]), true);
  assert.equal(isSeedEmail("info@rjlcommercialgroup.com"), true);
  assert.equal(residentEmail("  Info@RJLCommercialGroup.com "), "info@rjlcommercialgroup.com");
  assert.equal(residentEmail("not an email"), null);
  assert.equal(portalUserName("  Ada  "), "Ada");
  assert.equal(portalUserName(""), null);
});

test("activity text names the site and never keeps a 6-digit code", () => {
  assert.equal(activityLine("Asked for a sign-in code 123456"), "Macquarie Drive Thomastown: Asked for a sign-in code [code]");
  assert.equal(clickDetail("info-fire", "header"), "Macquarie Drive Thomastown: Opened the fire evacuation information (header)");
  assert.equal(clickDetail("delete-everything", ""), null);
  assert.equal(clickDetail("day-select", "x".repeat(200)).endsWith(")"), true);
  assert.equal(clickDetail("day-select", "x".repeat(200)).includes("x".repeat(81)), false);
});

test("login material changes with the code and is not the code itself", () => {
  const one = loginCodeMaterial("secret-secret-secret-secret-secret", "info@rjlcommercialgroup.com", "123456");
  const two = loginCodeMaterial("secret-secret-secret-secret-secret", "info@rjlcommercialgroup.com", "654321");
  assert.notEqual(one, two);
  assert.equal(one.endsWith("\n123456"), true);
  assert.equal(one === "123456", false);
});

test("the 61st click in a minute is refused and older clicks drop out", () => {
  let stamps = [];
  for (let i = 0; i < 60; i += 1) {
    const step = withinRate(stamps, 1_000 + i, 60_000, 60);
    assert.equal(step.ok, true);
    stamps = step.next;
  }
  assert.equal(withinRate(stamps, 2_000, 60_000, 60).ok, false);
  assert.equal(withinRate(stamps, 1_000 + 60_001, 60_000, 60).ok, true);
});

test("hold open now runs until 18:00 in the afternoon and refuses a time that has passed", () => {
  const afternoon = holdNowWindow(new Date("2026-11-11T02:00:00Z"), "");
  assert.equal(afternoon.ok, true);
  if (afternoon.ok) {
    assert.equal(afternoon.row.open_time, "13:00");
    assert.equal(afternoon.row.close_time, "18:00");
    assert.deepEqual(afternoon.row.days, [3]);
  }
  const evening = holdNowWindow(new Date("2026-11-11T08:00:00Z"), "");
  assert.equal(evening.ok, true);
  if (evening.ok) assert.equal(evening.row.close_time, "23:59");
  const early = holdNowWindow(new Date("2026-11-11T02:00:00Z"), "12:00");
  assert.equal(early.ok, false);
});

test("a planned hold needs a name, a real time, and at least one day", () => {
  const ok = plannedHold({ name: "Delivery", openTime: "09:00", closeTime: "11:00", days: [1, 3] });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.row.days, [1, 3]);
  assert.equal(plannedHold({ name: "", openTime: "09:00", closeTime: "11:00", days: [1] }).ok, false);
  assert.equal(plannedHold({ name: "Delivery", openTime: "09:00", closeTime: "09:00", days: [1] }).ok, false);
});

test("a sliding unit is online only from a recent last-seen time", () => {
  const now = Date.parse("2026-11-11T02:00:00Z");
  assert.equal(unitOnline("2026-11-11T01:59:00Z", now), true);
  assert.equal(unitOnline("2026-11-11T01:50:00Z", now), false);
  assert.equal(unitOnline(null, now), false);
});

test("an enabled same-day window covers the current minute and a disabled one does not", () => {
  const now = new Date("2026-11-11T02:30:00Z");
  const row = { days: [3], open_time: "13:00", close_time: "18:00", span_days: 0, enabled: true };
  assert.equal(windowCoversNow(now, row), true);
  assert.equal(windowCoversNow(now, { ...row, enabled: false }), false);
  assert.equal(windowCoversNow(now, { ...row, days: [4] }), false);
});
