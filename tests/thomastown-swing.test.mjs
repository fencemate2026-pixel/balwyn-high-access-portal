// Thomastown swing gate (6 Nov 2026): Azure mirror + signed command queue.
// The real migration (deploy/azure/gd/001_*.sql) runs on PostgreSQL semantics (PGlite); the real routes run
// against it. NOT covered here (needs a live server): the node-postgres pool/TLS in lib/gd-db.ts.
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
const model = await vite.ssrLoadModule("/lib/gd-swing-model.ts");
const dev = await vite.ssrLoadModule("/lib/gd-device-auth.ts");
const gddb = await vite.ssrLoadModule("/lib/gd-db.ts");
const deviceRoute = await vite.ssrLoadModule("/app/api/device/thomastown-swing/route.ts");
const ownerRoute = await vite.ssrLoadModule("/app/api/owner/thomastown-swing/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SECRET = "t".repeat(48);
const SQL = readFileSync(new URL("../deploy/azure/gd/001_thomastown_swing.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../deploy/azure/gd/001_thomastown_swing_rollback.sql", import.meta.url), "utf8");
const KEY = "11111111-1111-4111-8111-111111111111";

async function fixture(t) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");                       // exists in production; the migration must shut it out
  await pg.exec(SQL);
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
async function signed(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000), nonce = `nonce-${Date.now()}-${++n}-abcdefgh`, device = "thomastown-swing" } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const sig = await dev.signDeviceRequest(secret, device, ts, nonce, raw);
  return new Request(`${origin}/api/device/thomastown-swing`, { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-gd-device": device, "x-gd-ts": String(ts), "x-gd-nonce": nonce, "x-gd-sig": sig } });
}
async function ownerCookie(email) { return (await authLib.createSessionCookie({ displayName: "Jarrod", email, role: "administrator" })).split(";")[0]; }
const ownerGet = async (email = "owner@example.test") => ownerRoute.GET(new Request(`${origin}/api/owner/thomastown-swing`, { headers: { Cookie: await ownerCookie(email) } }));
const ownerPost = async (body, { email = "owner@example.test", headers = {} } = {}) => ownerRoute.POST(new Request(`${origin}/api/owner/thomastown-swing`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: await ownerCookie(email), ...headers }, body: JSON.stringify(body) }));

const PUSH = { action: "push", fw_version: "1.0.0", status: { throttled: "0x0", uptime_s: 99, nested: { x: 1 } },
  users: [{ local_id: 1, name: "Pat Example", phone: "0412345678", enabled: 1, schedule_type: "always", schedule_data: null, created_at_local: "2026-11-06 10:00:00" },
    { local_id: 2, name: "Sam Example", phone: "0398765432", enabled: 0, schedule_type: "time_range", schedule_data: '{"days":[0,1],"start":"08:00","end":"17:00"}', created_at_local: "2026-11-06 10:01:00" }],
  access: [{ local_id: 10, occurred_at_local: "2026-11-06 22:22:54", user_name: "Pat Example", method: "gsm", success: 1 },
    { local_id: 11, occurred_at_local: "2026-11-06 23:05:57", user_name: "+61400000000", method: "gsm-denied", success: 0 }],
  changes: [{ local_id: 5, occurred_at_local: "2026-11-06 21:00:00", action: "ADD_USER", detail: "added", changed_by: "Admin" }] };

test("owner commands are validated: Australian numbers only, schedules in the Pi's format, no junk", () => {
  const add = model.swingCommandInput({ kind: "user.add", name: " Pat ", phone: "+61 412 345 678", clientKey: KEY });
  assert.deepEqual(add.args, { name: "Pat", phone: "0412345678", schedule_type: "always", schedule_data: null });
  const sched = model.swingCommandInput({ kind: "user.add", name: "A", phone: "03 9876 5432", schedule_type: "time_range", schedule_days: [4, 0], schedule_start: "22:00", schedule_end: "06:00", clientKey: KEY });
  assert.equal(sched.args.schedule_data, '{"days":[0,4],"start":"22:00","end":"06:00"}');
  for (const bad of [{ phone: "12345" }, { phone: "" }, { name: "" }, { name: "x".repeat(61) }, { kind: "user.nuke" }, { clientKey: "no" }, { schedule_type: "sometimes" },
    { schedule_type: "time_range", schedule_days: [], schedule_start: "08:00", schedule_end: "17:00" }, { schedule_type: "time_range", schedule_days: [7], schedule_start: "08:00", schedule_end: "17:00" },
    { schedule_type: "time_range", schedule_days: [1], schedule_start: "08:00", schedule_end: "08:00" }]) {
    assert.throws(() => model.swingCommandInput({ kind: "user.add", name: "A", phone: "0412345678", clientKey: KEY, ...bad }));
  }
  assert.throws(() => model.swingCommandInput({ kind: "user.update", local_id: 3, clientKey: KEY }), /Nothing to change/);
  assert.throws(() => model.swingCommandInput({ kind: "user.delete", local_id: -1, clientKey: KEY }), /Unknown entry/);
  assert.equal(model.swingCommandInput({ kind: "user.enable", local_id: 3, enabled: false, clientKey: KEY }).summary, "Disable caller #3");
  const pulse = model.swingCommandInput({ kind: "gate.pulse", clientKey: KEY });
  assert.deepEqual(pulse.args, {});
  assert.equal(pulse.summary, "Open the gate (one pulse)");
  assert.equal(model.displayPhone("0412345678"), "0412 345 678");
});

test("call results are labelled from the gate app's own method names", () => {
  assert.equal(model.callResult("gsm", true).label, "Opened");
  assert.equal(model.callResult("gsm-denied", false).label, "Refused – not allowed");
  assert.equal(model.callResult("gsm-lockdown", false).tone, "warn");
  assert.equal(model.callResult("gsm-hardware-failed", false).label, "RELAY FAULT");
});

test("what the Pi pushes is typed, bounded and scrubbed", () => {
  const p = model.pushInput({ ...PUSH, users: [...PUSH.users, { local_id: "x", name: "bad", phone: "1" }, null, { local_id: 3, name: "n", phone: "0411111111", enabled: true, evil: "<script>" }], access: [{ local_id: 0 }, ...PUSH.access] });
  assert.equal(p.users.length, 3); assert.equal(p.access.length, 2);
  assert.deepEqual(p.status, { throttled: "0x0", uptime_s: 99 });             // nested objects dropped
  assert.equal(p.users[2].enabled, true); assert.equal("evil" in p.users[2], false);
  assert.equal(model.pushInput({ action: "push" }).users, null);               // no users key = leave the mirror alone
});

test("device signatures: valid passes; any change to body, key, device or time fails", async () => {
  const headers = async (req) => req.headers;
  const ok = await dev.verifyDeviceRequest({ headers: await headers(await signed({ a: 1 })), body: JSON.stringify({ a: 1 }), secrets: { "thomastown-swing": SECRET } });
  assert.equal(ok.ok, true);
  const body = JSON.stringify({ a: 1 });
  const h = await headers(await signed(body));
  assert.equal((await dev.verifyDeviceRequest({ headers: h, body: JSON.stringify({ a: 2 }), secrets: { "thomastown-swing": SECRET } })).reason, "signature");
  assert.equal((await dev.verifyDeviceRequest({ headers: h, body, secrets: { "thomastown-swing": "u".repeat(48) } })).reason, "signature");
  assert.equal((await dev.verifyDeviceRequest({ headers: h, body, secrets: {} })).reason, "secret_missing");
  assert.equal((await dev.verifyDeviceRequest({ headers: h, body, secrets: { "thomastown-swing": "short" } })).reason, "secret_missing");
  assert.equal((await dev.verifyDeviceRequest({ headers: h, body, secrets: { "thomastown-swing": SECRET }, nowMs: Date.now() + 200_000 })).reason, "stale");
  assert.equal((await dev.verifyDeviceRequest({ headers: new Headers(), body, secrets: { "thomastown-swing": SECRET } })).reason, "headers");
});

test("the migration shuts the school portal's role out of the gd schema, and rolls back cleanly", async (t) => {
  const pg = await fixture(t);
  await pg.exec("SET ROLE balwyn_app");
  await assert.rejects(pg.query("SELECT * FROM gd.users"), /permission denied/);
  await assert.rejects(pg.query("SELECT 1 FROM gd.devices"), /permission denied/);
  await pg.exec("RESET ROLE; SET ROLE gd_app");
  assert.equal((await pg.query("SELECT device_id FROM gd.devices")).rows[0].device_id, "thomastown-swing");
  assert.equal((await pg.query("SELECT site_name FROM gd.devices")).rows[0].site_name, "Macquarie Drive Thomastown");
  await pg.exec("RESET ROLE");
  await pg.exec(SQL);                                                           // re-running is harmless
  await pg.exec(ROLLBACK);
  await assert.rejects(pg.query("SELECT 1 FROM gd.devices"), /does not exist/);
});

test("device route: unsigned, mis-signed, stale, replayed or wrong-device requests are all the same bare 401", async (t) => {
  await fixture(t);
  const bare = new Request(`${origin}/api/device/thomastown-swing`, { method: "POST", body: "{}" });
  for (const req of [bare, await signed(PUSH, { secret: "w".repeat(48) }), await signed(PUSH, { ts: Math.floor(Date.now() / 1000) - 600 }), await signed(PUSH, { device: "someone-else" })]) {
    const r = await deviceRoute.POST(req); assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: "Unauthorised." });
  }
  const first = await signed(PUSH, { nonce: "replay-nonce-0123456789" });
  assert.equal((await deviceRoute.POST(first.clone())).status, 200);
  assert.equal((await deviceRoute.POST(first.clone())).status, 401);            // same bytes, same nonce: a replay
  delete env.GD_THOMASTOWN_SWING_SECRET;
  assert.equal((await deviceRoute.POST(await signed(PUSH))).status, 401);       // no secret configured: fails closed
});

test("push mirrors users (full snapshot), calls and changes; resends and shrinking snapshots behave", async (t) => {
  const pg = await fixture(t);
  assert.deepEqual((await (await deviceRoute.POST(await signed(PUSH))).json()).stored, { users: 2, holds: 0, access: 2, changes: 1 });
  assert.equal((await deviceRoute.POST(await signed(PUSH))).status, 200);       // resend: same rows, no duplicates
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.access_log")).rows[0].n, 2);
  assert.equal((await pg.query("SELECT enabled FROM gd.users WHERE local_id=2")).rows[0].enabled, false);
  await deviceRoute.POST(await signed({ action: "push", users: [PUSH.users[0]] }));   // Sam deleted on the Pi
  assert.deepEqual((await pg.query("SELECT local_id FROM gd.users ORDER BY 1")).rows.map((r) => r.local_id), [1]);
  await deviceRoute.POST(await signed({ action: "push", access: [] }));         // no users key: mirror untouched
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.users")).rows[0].n, 1);
  const dev1 = (await pg.query("SELECT last_status, fw_version, last_seen FROM gd.devices")).rows[0];
  assert.equal(dev1.fw_version, "1.0.0"); assert.deepEqual(dev1.last_status, { throttled: "0x0", uptime_s: 99 }); assert.ok(dev1.last_seen);
});

test("owner sees callers, EVERY call (including an unlisted number) and changes; others get 404", async (t) => {
  await fixture(t);
  await deviceRoute.POST(await signed(PUSH));
  for (const email of ["staff@example.test"]) assert.equal((await ownerGet(email)).status, 404);
  assert.equal((await ownerRoute.GET(new Request(`${origin}/api/owner/thomastown-swing`))).status, 404);   // signed out: same 404, existence not disclosed
  const d = await (await ownerGet()).json();
  assert.equal(d.users.length, 2); assert.equal(d.online, true);
  assert.deepEqual(d.access.map((a) => a.user_name), ["+61400000000", "Pat Example"]);       // newest first, unlisted number kept
  assert.equal(d.changes[0].action, "ADD_USER");
  assert.equal("secret" in d, false);
});

test("owner changes: queued once per click, delivered to the Pi in order, confirmed by the Pi, never late", async (t) => {
  const pg = await fixture(t);
  assert.equal((await ownerPost({ kind: "user.add", name: "New Person", phone: "0455 111 222", clientKey: KEY }, { email: "staff@example.test" })).status, 404);
  assert.equal((await ownerPost({ kind: "user.add", name: "x", phone: "0455111222", clientKey: KEY }, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await ownerPost({ kind: "user.add", name: "x", phone: "bad", clientKey: KEY })).status, 400);
  const a = await (await ownerPost({ kind: "user.add", name: "New Person", phone: "0455 111 222", clientKey: KEY })).json();
  assert.equal(a.duplicate, false); assert.equal(a.command.status, "pending");
  assert.equal((await (await ownerPost({ kind: "user.add", name: "New Person", phone: "0455 111 222", clientKey: KEY })).json()).duplicate, true);   // double click
  await ownerPost({ kind: "user.delete", local_id: 2, clientKey: "22222222-2222-4222-8222-222222222222" });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.commands")).rows[0].n, 2);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.changes WHERE source='portal'")).rows[0].n, 2);   // audit rows, one per queued change
  const got = await (await deviceRoute.POST(await signed({ action: "commands" }))).json();
  assert.deepEqual(got.commands.map((c) => c.kind), ["user.add", "user.delete"]);
  assert.deepEqual(got.commands[0].args, { name: "New Person", phone: "0455111222", schedule_type: "always", schedule_data: null });
  const ack = (id, ok, error) => signed({ action: "ack", id, ok, error, result: { local_id: 9 } });
  assert.equal((await (await deviceRoute.POST(await ack(got.commands[0].id, true))).json()).recorded, true);
  assert.equal((await (await deviceRoute.POST(await ack(got.commands[0].id, false, "late"))).json()).recorded, false);     // a result can be recorded once
  await deviceRoute.POST(await ack(got.commands[1].id, false, "That caller no longer exists."));
  const d = await (await ownerGet()).json();
  assert.deepEqual(d.commands.map((c) => [c.kind, c.status]).sort(), [["user.add", "applied"], ["user.delete", "failed"]]);
  assert.equal(d.commands.find((c) => c.kind === "user.delete").error, "That caller no longer exists.");
  // A command the Pi never collected in time is dropped, never delivered late.
  await ownerPost({ kind: "user.enable", local_id: 1, enabled: false, clientKey: "33333333-3333-4333-8333-333333333333" });
  await pg.exec("UPDATE gd.commands SET expires_at = now() - interval '1 minute' WHERE kind='user.enable'");
  assert.deepEqual((await (await deviceRoute.POST(await signed({ action: "commands" }))).json()).commands, []);
  assert.equal((await pg.query("SELECT status FROM gd.commands WHERE kind='user.enable'")).rows[0].status, "expired");
  // Another device's id can never ack this device's command (ack is scoped to the signed device).
  assert.equal((await deviceRoute.POST(await signed({ action: "ack", id: "44444444-4444-4444-8444-444444444444", ok: true }))).status, 200);
  assert.equal((await deviceRoute.POST(await signed({ action: "ack", id: "not-a-uuid", ok: true }))).status, 400);
  assert.equal((await deviceRoute.POST(await signed({ action: "bogus" }))).status, 400);
});

test("a command is handed out at most five times, then expires", async (t) => {
  const pg = await fixture(t);
  await ownerPost({ kind: "user.delete", local_id: 7, clientKey: KEY });
  for (let i = 0; i < 5; i++) assert.equal((await (await deviceRoute.POST(await signed({ action: "commands" }))).json()).commands.length, 1);
  assert.equal((await (await deviceRoute.POST(await signed({ action: "commands" }))).json()).commands.length, 0);
  assert.equal((await pg.query("SELECT status FROM gd.commands")).rows[0].status, "expired");
});

test("oversize bodies are refused before any parsing", async (t) => {
  await fixture(t);
  assert.equal((await deviceRoute.POST(new Request(`${origin}/api/device/thomastown-swing`, { method: "POST", body: "x".repeat(300_000) }))).status, 413);
});

test("dial-in number: swing gate shows its own number, sliding shows none, no secrets involved", () => {
  assert.equal(model.SWING_DEVICE_ID, "thomastown-swing");
  assert.equal(model.SWING_SITE_NAME, "Macquarie Drive Thomastown");
  assert.equal(model.SLIDING_SITE_NAME, "Thomastown Body Corp · sliding gate");
  assert.equal(model.SETTLEMENT_SITE_NAME, "Settlement Road Swing Gate");
  assert.equal(model.gdDialIn("thomastown-swing"), "0475184833");
  assert.equal(model.gdDialIn("settlement-road-swing"), null);
  assert.equal(model.gdDialIn("thomastown-sliding"), null);
  assert.equal(model.displayPhone(model.gdDialIn("thomastown-swing")), "0475 184 833");
});
