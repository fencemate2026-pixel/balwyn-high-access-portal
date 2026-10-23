// 24 Oct 2026 (Jarrod: "Gate cycles since service" does not count). A cycle is now
// counted each time the controller reports the gate leaving its closed reed,
// whatever opened it (portal, keypad / Compass, exit button, schedule).
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const service = await vite.ssrLoadModule("/lib/gate-service.ts");

const beat = (position) => store.recordHeartbeat({ gateId: "TF-ENTRY", position, safetyOk: true, faults: [] });
const count = async (pg) => Number((await pg.query("SELECT operations_since_service FROM gate_service_counters WHERE gate_id = 'TF-ENTRY'")).rows[0]?.operations_since_service ?? 0);

test("a keypad opening seen on the reeds is counted once per cycle", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters" });
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();

  await beat("closed");
  assert.equal(await count(pg), 0, "a closed gate is not a cycle");
  // Keypad opens the gate: no portal command at all.
  // Keypad opening: the controller did not start it, so between the reeds it reports "unknown".
  for (const position of ["unknown", "unknown", "open", "open", "unknown", "closed"]) await beat(position);
  assert.equal(await count(pg), 1, "one full cycle = one count, however many reports it spans");
  await beat("open"); await beat("closed");
  assert.equal(await count(pg), 2);
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "unknown", safetyOk: true, faults: ["Both open and closed reeds are made: check reed wiring and magnets"] });
  await beat("closed");
  assert.equal(await count(pg), 2, "a reading that carries a reed fault is never a cycle");
});

test("a portal OPEN acknowledged by the controller is counted once, not twice", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  await beat("closed");
  await pg.query("INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) VALUES ($1, 'TF-ENTRY', 'open', 'manual', 'dispatched', 'Staff', $2)", [crypto.randomUUID(), new Date(Date.now() + 60000).toISOString()]);
  const id = (await pg.query("SELECT id FROM command_queue ORDER BY id DESC LIMIT 1")).rows[0].id;
  await beat("moving");
  await store.acknowledgeControllerCommand({ gateId: "TF-ENTRY", commandId: Number(id), state: "acknowledged", position: "open", safetyOk: true, detail: "Relay pulsed 1 s for an open cycle; open confirmed by reed switch." });
  await beat("open"); await beat("closed");
  assert.equal(await count(pg), 1);
});

test("a door-service pulse on a gate counted by its reeds is not counted again", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  await beat("closed"); // commissions the controller
  assert.equal(await service.recordGateOperation("TF-ENTRY", { runtime: {}, unlessReedCounted: true }), null);
  assert.equal(await count(pg), 0);
});
