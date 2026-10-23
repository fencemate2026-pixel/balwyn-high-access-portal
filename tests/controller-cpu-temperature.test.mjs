// 24 Oct 2026: the gate Pi's CPU temperature reaches the gate panel.
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
const commands = await vite.ssrLoadModule("/app/api/controller/commands/route.ts");
const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };

async function setup(t) {
  const fixture = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fixture.fetchDatabase;
  await store.ensurePortalSeeded();
  return fixture;
}
const poll = (token, extra) => commands.POST(new Request("https://magickeys-balwyn-portal.com/api/controller/commands", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ gateId: "TF-ENTRY", position: "closed", safetyOk: true, faults: [], scheduleControl: false, ...extra }),
}));
const runtime = async () => (await store.getPortalSnapshot(admin)).gates.find((gate) => gate.gateId === "TF-ENTRY");

test("the controller's CPU temperature is stored and shown while it reports", async (t) => {
  await setup(t);
  const token = await store.issueControllerToken("TF-ENTRY", admin);
  assert.equal((await poll(token, { cpuTempC: 48.34 })).status, 200);
  assert.equal((await runtime()).cpuTempC, 48.3);
  // A poll without a reading clears it: an old figure is never shown as current.
  assert.equal((await poll(token, {})).status, 200);
  assert.equal((await runtime()).cpuTempC, null);
});

test("implausible or non-numeric readings are not stored", async (t) => {
  await setup(t);
  const token = await store.issueControllerToken("TF-ENTRY", admin);
  for (const bad of [500, -90, "hot", null]) {
    assert.equal((await poll(token, { cpuTempC: bad })).status, 200);
    assert.equal((await runtime()).cpuTempC, null, String(bad));
  }
  assert.equal(store.plausibleCpuTemp(Number.NaN), null);
});

test("an offline controller's last reading is not shown", async (t) => {
  const { pg } = await setup(t);
  const token = await store.issueControllerToken("TF-ENTRY", admin);
  await poll(token, { cpuTempC: 51 });
  await pg.query("UPDATE gate_states SET last_seen = $1 WHERE gate_id = 'TF-ENTRY'", [new Date(Date.now() - 10 * 60 * 1000).toISOString()]);
  assert.equal((await runtime()).cpuTempC, null);
});
