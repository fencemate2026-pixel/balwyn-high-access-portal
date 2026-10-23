// 24 Oct 2026: top-bar gate lights. The colour must come only from the
// controller's reported position, never from a requested command.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { headerGateLight } = await vite.ssrLoadModule("/app/header-gate-leds.tsx");
const { gateVisualState, GATES } = await vite.ssrLoadModule("/lib/portal-model.ts");

const gate = GATES.find((g) => g.id === "TF-ENTRY");
const now = Date.now();
const runtime = (over) => ({ gateId: "TF-ENTRY", commissioned: true, controllerState: "online", reportedPosition: "closed", commandedPosition: "closed", safetyOk: true, lastSeen: new Date(now - 2000).toISOString(), lastCommandId: null, lastCommandState: "acknowledged", lastError: null, ...over });
const light = (rt, monitoring = true) => headerGateLight(gateVisualState(gate, rt, monitoring), rt, monitoring, now);

test("confirmed positions show open (green) and closed (red)", () => {
  assert.equal(light(runtime({ reportedPosition: "open" })), "open");
  assert.equal(light(runtime({ reportedPosition: "closed" })), "closed");
});

test("a requested OPEN that is not yet confirmed shows moving, not open", () => {
  assert.equal(light(runtime({ commandedPosition: "open", lastCommandState: "dispatched" })), "moving");
  assert.equal(light(runtime({ reportedPosition: "moving" })), "moving");
});

test("offline, stale, uncommissioned and paused never show a position", () => {
  assert.equal(light(runtime({ controllerState: "offline", reportedPosition: "open" })), "offline");
  assert.equal(light(runtime({ lastSeen: new Date(now - 120000).toISOString(), reportedPosition: "open" })), "offline");
  assert.equal(light(runtime({ commissioned: false })), "offline");
  assert.equal(light(undefined), "offline");
  assert.equal(light(runtime({ reportedPosition: "open" }), false), "paused");
});

test("online with an unconfirmed position (failed command, reed fault) asks for a check", () => {
  assert.equal(light(runtime({ lastCommandState: "failed" })), "check");
  assert.equal(light(runtime({ reportedPosition: "unknown" })), "check");
});
