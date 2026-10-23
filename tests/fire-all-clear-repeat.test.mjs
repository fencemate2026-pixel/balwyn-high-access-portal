// Audit 24 Oct 2026 (gate logic F1): pressing "Clear" a second time before the
// gate controllers have collected the all-clear CLOSE must not cancel it. Before
// the fix the second clear failed every queued emergency packet (including the
// all-clear CLOSE) and then found no gate whose latest command was the fire OPEN,
// so it queued nothing and the fire hold stayed on.
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
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const model = await vite.ssrLoadModule("/lib/portal-model.ts");
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

test("a second clear before collection keeps the all-clear CLOSE queued", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  const cookie = (await auth.createSessionCookie(admin)).split(";")[0];
  const press = (body) => portal.POST(new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  await store.ensurePortalSeeded();
  const gates = model.ACTIVE_GATES.map((gate) => gate.id).sort();

  assert.equal((await press({ action: "emergency", mode: "fire" })).status, 200);
  // Controllers collect and confirm the fire OPEN (simulated directly in the queue).
  await pg.query("UPDATE command_queue SET state = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP WHERE command = 'open'");

  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  const closes = async () => (await pg.query("SELECT gate_id, state FROM command_queue WHERE command = 'closed' ORDER BY id")).rows;
  assert.deepEqual((await closes()).map((row) => row.gate_id).sort(), gates);

  // Second press before any controller has polled.
  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  const after = await closes();
  const queued = after.filter((row) => row.state === "queued").map((row) => row.gate_id).sort();
  assert.deepEqual(queued, gates, `every gate still has a collectable all-clear CLOSE: ${JSON.stringify(after)}`);
  assert.equal(after.length, gates.length, "the second clear neither cancels nor duplicates the CLOSE");
  const states = (await pg.query("SELECT gate_id, last_command_state, commanded_position FROM gate_states WHERE gate_id = ANY($1)", [gates])).rows;
  for (const row of states) {
    assert.equal(row.last_command_state, "queued", `${row.gate_id} still shows the CLOSE as queued`);
    assert.equal(row.commanded_position, "closed");
  }
});

test("clear still cancels a fire OPEN that no controller has collected yet", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  const cookie = (await auth.createSessionCookie(admin)).split(";")[0];
  const press = (body) => portal.POST(new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  await store.ensurePortalSeeded();

  assert.equal((await press({ action: "emergency", mode: "fire" })).status, 200);
  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  const opens = (await pg.query("SELECT state FROM command_queue WHERE command = 'open'")).rows;
  assert.ok(opens.length > 0 && opens.every((row) => row.state === "failed"), "uncollected fire OPENs are cancelled");
});

test("fire OPEN and all-clear CLOSE stay collectable for the controller's 12 h hold window (audit F2)", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  const cookie = (await auth.createSessionCookie(admin)).split(";")[0];
  const press = (body) => portal.POST(new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  await store.ensurePortalSeeded();
  const elevenHours = 11 * 3600 * 1000;

  assert.equal((await press({ action: "emergency", mode: "fire" })).status, 200);
  for (const row of (await pg.query("SELECT gate_id, expires_at FROM command_queue WHERE command = 'open'")).rows) {
    assert.ok(Date.parse(row.expires_at) - Date.now() > elevenHours, `${row.gate_id} fire OPEN expires at ${row.expires_at}`);
  }
  await pg.query("UPDATE command_queue SET state = 'acknowledged' WHERE command = 'open'");
  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  for (const row of (await pg.query("SELECT gate_id, expires_at FROM command_queue WHERE command = 'closed'")).rows) {
    assert.ok(Date.parse(row.expires_at) - Date.now() > elevenHours, `${row.gate_id} all-clear CLOSE expires at ${row.expires_at}`);
  }
  assert.equal(store.MANUAL_COMMAND_EXPIRY_MS, 2 * 60 * 1000, "manual commands keep the short expiry");
});
