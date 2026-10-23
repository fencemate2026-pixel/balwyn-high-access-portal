// Audit 24 Oct 2026 (gate logic F5): a manual CLOSE was refused for any gate whose
// controller reported a fault or an unhealthy safety input, with the message
// "offline". CLOSE only releases the relay and the controller accepts it in those
// states, so it must be allowed. OPEN stays blocked. Also: when an all-clear
// CLOSE has failed, pressing Clear again re-sends it.
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
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

async function setup(t) {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  const cookie = (await auth.createSessionCookie(admin)).split(";")[0];
  const press = (body) => portal.POST(new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  await store.ensurePortalSeeded();
  return { pg, press };
}

for (const [label, state, safety] of [["a reported fault", "fault", true], ["an unhealthy safety input", "fault", false]]) {
  test(`manual CLOSE is accepted for a controller with ${label}; OPEN is refused`, async (t) => {
    const { pg, press } = await setup(t);
    await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = $1, safety_ok = $2, last_seen = $3, last_command_state = 'acknowledged', last_error = 'Fire / evacuation hold has been on for 4.1 h.' WHERE gate_id = 'TF-ENTRY'", [state, safety ? 1 : 0, new Date().toISOString()]);
    const close = await press({ action: "gate_command", gateId: "TF-ENTRY", position: "closed" });
    assert.equal(close.status, 200, JSON.stringify(await close.clone().json()));
    const queued = (await pg.query("SELECT command FROM command_queue WHERE gate_id = 'TF-ENTRY' AND state = 'queued'")).rows;
    assert.deepEqual(queued.map((row) => row.command), ["closed"]);
    await pg.query("UPDATE command_queue SET state = 'acknowledged'");
    await pg.query("UPDATE gate_states SET last_command_state = 'acknowledged' WHERE gate_id = 'TF-ENTRY'");
    const open = await press({ action: "gate_command", gateId: "TF-ENTRY", position: "open" });
    assert.equal(open.status, 400);
    assert.doesNotMatch((await open.json()).error, /offline/, "an online controller is not described as offline");
  });
}

test("manual CLOSE is still refused for a controller not seen for over 90 s", async (t) => {
  const { pg, press } = await setup(t);
  await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = 'online', safety_ok = 1, last_seen = $1 WHERE gate_id = 'TF-ENTRY'", [new Date(Date.now() - 5 * 60_000).toISOString()]);
  const close = await press({ action: "gate_command", gateId: "TF-ENTRY", position: "closed" });
  assert.equal(close.status, 400);
  assert.match((await close.json()).error, /offline/);
});

test("Clear re-sends an all-clear CLOSE that failed", async (t) => {
  const { pg, press } = await setup(t);
  assert.equal((await press({ action: "emergency", mode: "fire" })).status, 200);
  await pg.query("UPDATE command_queue SET state = 'acknowledged' WHERE command = 'open'");
  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  await pg.query("UPDATE command_queue SET state = 'failed', detail = 'Command expired before controller confirmation.' WHERE command = 'closed'");
  assert.equal((await press({ action: "clear_emergency" })).status, 200);
  const queued = (await pg.query("SELECT gate_id FROM command_queue WHERE command = 'closed' AND state = 'queued'")).rows;
  assert.ok(queued.length >= 2, `a new CLOSE was queued for each gate: ${JSON.stringify(queued)}`);
});
