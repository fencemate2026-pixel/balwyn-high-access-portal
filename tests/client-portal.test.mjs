import test from "node:test";
import assert from "node:assert/strict";
import { clientAppKind, clientPageHref, deviceClientHref } from "../lib/client-portal.ts";

test("macquarie aliases open the one connected resident app", () => {
  assert.equal(clientAppKind("macquarie"), "macquarie");
  assert.equal(clientAppKind("macquarie-drive"), "macquarie");
  assert.equal(clientAppKind("thomastown"), "macquarie");
});

test("any other valid slug is that client's own page", () => {
  assert.equal(clientAppKind("hertz"), "site");
  assert.equal(clientAppKind("ab"), "site");
});

test("a desktop portal link stays on this portal", () => {
  assert.equal(clientPageHref("thomastown"), "/macquarie");
  assert.equal(clientPageHref("macquarie-drive"), "/macquarie");
  assert.equal(clientPageHref("hertz"), "/c/hertz");
  assert.equal(clientPageHref("Hertz"), null);
  assert.equal(deviceClientHref("thomastown-swing"), "/macquarie");
  assert.equal(deviceClientHref("thomastown-sliding"), "/macquarie");
  assert.equal(deviceClientHref("settlement-road-swing"), null);
});

test("a slug that is not a site id is rejected", () => {
  assert.equal(clientAppKind(""), "invalid");
  assert.equal(clientAppKind("x"), "invalid");
  assert.equal(clientAppKind("Hertz"), "invalid");
  assert.equal(clientAppKind("has space"), "invalid");
  assert.equal(clientAppKind("../macquarie"), "invalid");
});
