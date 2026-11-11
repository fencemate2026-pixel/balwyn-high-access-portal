// Portal open pulse (12 Nov 2026): one queued relay pulse for Macquarie Drive Thomastown.
// Real migrations 001 + 004 + 005 + 007 on PGlite. The Pi side is tests/test_portal_sync.py in the gate repo.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const authLib = await vite.ssrLoadModule("/lib/portal-auth.ts");
const dev = await vite.ssrLoadModule("/lib/gd-device-auth.ts");
const gddb = await vite.ssrLoadModule("/lib/gd-db.ts");
const deviceRoute = await vite.ssrLoadModule("/app/api/device/thomastown-swing/route.ts");
const ownerRoute = await vite.ssrLoadModule("/app/api/owner/thomastown-swing/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SECRET = "t".repeat(48);
const read = (name) => readFileSync(new URL(`../deploy/azure/gd/${name}`, import.meta.url), "utf8");
const SQL = read("001_thomastown_swing.sql");
const HOLD_SQL = read("004_hold_windows.sql");
const SIM_SQL = read("005_sim_number.sql");
const PULSE_SQL = read("007_gate_pulse.sql");
const PULSE_ROLLBACK = read("007_gate_pulse_rollback.sql");

async function fixture(t, withPulse = true) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");
  await pg.exec(SQL);
  await pg.exec(HOLD_SQL);
  await pg.exec(SIM_SQL);
  if (withPulse) await pg.exec(PULSE_SQL);
  gddb.setGdRunnerForTests(async (fn) => {
    await pg.query("BEGIN");
    try {
      const out = await fn({ query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) }; } });
      await pg.query("COMMIT"); return out;
    } catch (e) { await pg.query("ROLLBACK"); throw e; }
  });
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: "owner@example.test|administrator,staff@example.test|administrator",
    PORTAL_OWNER_EMAIL: "owner@example.test", GD_THOMASTOWN_SWING_SECRET: SECRET,
  });
  return pg;
}
let n = 0;
async function signed(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000), nonce = `nonce-${Date.now()}-${++n}-abcdefgh` } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const sig = await dev.signDeviceRequest(secret, "thomastown-swing", ts, nonce, raw);
  return new Request(`${origin}/api/device/thomastown-swing`, { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-gd-device": "thomastown-swing", "x-gd-ts": String(ts), "x-gd-nonce": nonce, "x-gd-sig": sig } });
}
async function ownerCookie(email) { return (await authLib.createSessionCookie({ displayName: "Owner", email, role: "administrator" })).split(";")[0]; }
const ownerGet = async (email = "owner@example.test") => ownerRoute.GET(new Request(`${origin}/api/owner/thomastown-swing`, { headers: { Cookie: await ownerCookie(email) } }));
const ownerPost = async (body, { email = "owner@example.test", headers = {} } = {}) => ownerRoute.POST(new Request(`${origin}/api/owner/thomastown-swing`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: await ownerCookie(email), ...headers }, body: JSON.stringify(body) }));

let k = 0;
const key = () => `22222222-2222-4222-8222-${String(++k).padStart(12, "0")}`;
const hold = () => ({ kind: "hold.add", name: "Day", days: [0], open_time: "06:00", close_time: "18:00", clientKey: key() });

test("the owner queues one open pulse and the Pi collects that command", async (t) => {
  await fixture(t);
  const queued = await ownerPost({ kind: "gate.pulse", clientKey: key() });
  assert.equal(queued.status, 200);
  const body = await queued.json();
  assert.equal(body.command.kind, "gate.pulse");
  assert.deepEqual(body.command.args, {});
  assert.equal(body.command.status, "pending");
  const got = await (await deviceRoute.POST(await signed({ action: "commands" }))).json();
  assert.equal(got.commands.length, 1);
  assert.equal(got.commands[0].kind, "gate.pulse");
  assert.deepEqual(got.commands[0].args, {});
  assert.equal((await (await deviceRoute.POST(await signed({ action: "ack", id: got.commands[0].id, ok: true, result: { pulsed: true } }))).json()).recorded, true);
  const seen = (await (await ownerGet()).json()).commands.find((c) => c.kind === "gate.pulse");
  assert.equal(seen.status, "applied");
  const changes = (await (await ownerGet()).json()).changes;
  assert.ok(changes.some((c) => c.action === "portal.gate.pulse" && String(c.detail).includes("Open the gate (one pulse)")));
});

test("the same click queues once, and only the owner can queue it", async (t) => {
  await fixture(t);
  const same = key();
  const a = await (await ownerPost({ kind: "gate.pulse", clientKey: same })).json();
  const b = await (await ownerPost({ kind: "gate.pulse", clientKey: same })).json();
  assert.equal(b.duplicate, true);
  assert.equal(a.command.id, b.command.id);
  assert.equal((await ownerPost({ kind: "gate.pulse", clientKey: key() }, { email: "staff@example.test" })).status, 404);
  assert.equal((await ownerPost({ kind: "gate.pulse", clientKey: key() }, { headers: { Origin: "https://evil.example" } })).status, 403);
});

test("before migration 007 the page loads and Open is refused plainly", async (t) => {
  await fixture(t, false);
  assert.equal((await ownerGet()).status, 200);
  const r = await ownerPost({ kind: "gate.pulse", clientKey: key() });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error ?? "", /not set up on the server yet/);
  assert.equal((await ownerPost(hold())).status, 200);
});

test("migration 007 is re-runnable and its rollback removes only gate.pulse", async (t) => {
  const pg = await fixture(t);
  await pg.exec(PULSE_SQL);
  await ownerPost({ kind: "gate.pulse", clientKey: key() });
  await ownerPost(hold());
  await pg.exec(PULSE_ROLLBACK);
  const kinds = (await pg.query("SELECT kind FROM gd.commands ORDER BY kind")).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["hold.add"]);
  await assert.rejects(() => pg.query("INSERT INTO gd.commands(id,device_id,client_key,kind,args,actor_email,expires_at) VALUES (gen_random_uuid(),'thomastown-swing',gen_random_uuid(),'gate.pulse','{}','x',now())"));
});
