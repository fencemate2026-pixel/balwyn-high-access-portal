// Thomastown SLIDING gate (7 Nov 2026): second Azure-backed device beside the swing gate.
// Real migrations 001 + 002 run on PostgreSQL semantics (PGlite); the real routes run against them.
// NOT covered here (needs a live server): the node-postgres pool/TLS in lib/gd-db.ts.
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
const swingDevice = await vite.ssrLoadModule("/app/api/device/thomastown-swing/route.ts");
const slidingDevice = await vite.ssrLoadModule("/app/api/device/thomastown-sliding/route.ts");
const swingOwner = await vite.ssrLoadModule("/app/api/owner/thomastown-swing/route.ts");
const slidingOwner = await vite.ssrLoadModule("/app/api/owner/thomastown-sliding/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SWING_SECRET = "t".repeat(48);
const SLIDING_SECRET = "s".repeat(48);
const SQL = readFileSync(new URL("../deploy/azure/gd/001_thomastown_swing.sql", import.meta.url), "utf8");
const SQL2 = readFileSync(new URL("../deploy/azure/gd/002_thomastown_sliding.sql", import.meta.url), "utf8");
const ROLLBACK2 = readFileSync(new URL("../deploy/azure/gd/002_thomastown_sliding_rollback.sql", import.meta.url), "utf8");

async function fixture(t) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");
  await pg.exec(SQL); await pg.exec(SQL2);
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
    PORTAL_OWNER_EMAIL: "owner@example.test", GD_THOMASTOWN_SWING_SECRET: SWING_SECRET, GD_THOMASTOWN_SLIDING_SECRET: SLIDING_SECRET,
  });
  return pg;
}
let n = 0;
async function signed(body, { site = "thomastown-sliding", secret = site === "thomastown-sliding" ? SLIDING_SECRET : SWING_SECRET, device = site, ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body); const nonce = `nonce-${Date.now()}-${++n}-abcdefgh`;
  const sig = await dev.signDeviceRequest(secret, device, ts, nonce, raw);
  return new Request(`${origin}/api/device/${site}`, { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-gd-device": device, "x-gd-ts": String(ts), "x-gd-nonce": nonce, "x-gd-sig": sig } });
}
const post = (site, req) => (site === "thomastown-sliding" ? slidingDevice : swingDevice).POST(req);
async function cookie(email) { return (await authLib.createSessionCookie({ displayName: "Jarrod", email, role: "administrator" })).split(";")[0]; }
const get = async (route, site, email = "owner@example.test") => route.GET(new Request(`${origin}/api/owner/${site}`, { headers: { Cookie: await cookie(email) } }));
const ownerPost = async (route, site, body, email = "owner@example.test") => route.POST(new Request(`${origin}/api/owner/${site}`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: await cookie(email) }, body: JSON.stringify(body) }));
const USER = (id, name, phone) => ({ local_id: id, name, phone, enabled: 1, schedule_type: "always", schedule_data: null, created_at_local: "2026-11-07 10:00:00" });
const PUSH = (tag) => ({ action: "push", fw_version: "1.0.0", status: { uptime_s: 5 },
  users: [USER(1, `${tag} Caller`, "0412345678")], access: [{ local_id: 10, occurred_at_local: "2026-11-07 09:00:00", user_name: "+61400000000", method: "gsm-denied", success: 0 }], changes: [] });
const KEY = "55555555-5555-4555-8555-555555555555";

test("002 adds only the sliding device, is repeatable, and its rollback leaves the swing gate alone", async (t) => {
  const pg = await fixture(t);
  assert.deepEqual((await pg.query("SELECT device_id FROM gd.devices ORDER BY 1")).rows.map((r) => r.device_id), ["thomastown-sliding", "thomastown-swing"]);
  await pg.exec(SQL2);                                                          // re-running is harmless
  await post("thomastown-swing", await signed(PUSH("Swing"), { site: "thomastown-swing" }));
  await post("thomastown-sliding", await signed(PUSH("Slide")));
  await pg.exec(ROLLBACK2);
  assert.deepEqual((await pg.query("SELECT device_id FROM gd.devices")).rows.map((r) => r.device_id), ["thomastown-swing"]);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.users")).rows[0].n, 1);                      // swing caller kept
  await pg.exec("SET ROLE balwyn_app");
  await assert.rejects(pg.query("SELECT 1 FROM gd.devices"), /permission denied/);                               // school role still shut out
});

test("each gate's secret acts only as that gate; no secret configured fails closed", async (t) => {
  await fixture(t);
  assert.equal((await post("thomastown-sliding", await signed(PUSH("Slide")))).status, 200);
  assert.equal((await post("thomastown-sliding", await signed(PUSH("Slide"), { secret: SWING_SECRET }))).status, 401);   // swing's secret on sliding
  assert.equal((await post("thomastown-swing", await signed(PUSH("Swing"), { site: "thomastown-swing", secret: SLIDING_SECRET }))).status, 401);
  // A sliding-signed request aimed at the swing route (device header says sliding) is refused: the route fixes the device.
  assert.equal((await post("thomastown-swing", await signed(PUSH("X"), { site: "thomastown-swing", device: "thomastown-sliding", secret: SLIDING_SECRET }))).status, 401);
  delete env.GD_THOMASTOWN_SLIDING_SECRET;
  const r = await post("thomastown-sliding", await signed(PUSH("Slide"))); assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: "Unauthorised." });
  assert.equal((await post("thomastown-swing", await signed(PUSH("Swing"), { site: "thomastown-swing" }))).status, 200);   // swing unaffected
});

test("the two gates' callers and calls never mix, and only the owner sees them", async (t) => {
  await fixture(t);
  await post("thomastown-swing", await signed(PUSH("Swing"), { site: "thomastown-swing" }));
  await post("thomastown-sliding", await signed(PUSH("Slide")));
  const s = await (await get(slidingOwner, "thomastown-sliding")).json();
  const w = await (await get(swingOwner, "thomastown-swing")).json();
  assert.deepEqual(s.users.map((u) => u.name), ["Slide Caller"]); assert.deepEqual(w.users.map((u) => u.name), ["Swing Caller"]);
  assert.equal(s.device.device_id, "thomastown-sliding"); assert.equal(s.online, true);
  assert.equal(s.access[0].user_name, "+61400000000");                          // an unlisted number is kept
  assert.equal((await get(slidingOwner, "thomastown-sliding", "staff@example.test")).status, 404);
  assert.equal((await slidingOwner.GET(new Request(`${origin}/api/owner/thomastown-sliding`))).status, 404);
});

test("a change queued for the sliding gate reaches only the sliding Pi", async (t) => {
  const pg = await fixture(t);
  const q = await ownerPost(slidingOwner, "thomastown-sliding", { kind: "user.add", name: "New Person", phone: "0455 111 222", clientKey: KEY });
  assert.equal((await q.json()).command.status, "pending");
  assert.equal((await pg.query("SELECT device_id FROM gd.commands")).rows[0].device_id, "thomastown-sliding");
  assert.deepEqual((await (await post("thomastown-swing", await signed({ action: "commands" }, { site: "thomastown-swing" }))).json()).commands, []);
  const got = await (await post("thomastown-sliding", await signed({ action: "commands" }))).json();
  assert.deepEqual(got.commands.map((c) => c.kind), ["user.add"]);
  // The swing Pi cannot finish the sliding Pi's command.
  assert.equal((await (await post("thomastown-swing", await signed({ action: "ack", id: got.commands[0].id, ok: true }, { site: "thomastown-swing" }))).json()).recorded, false);
  assert.equal((await (await post("thomastown-sliding", await signed({ action: "ack", id: got.commands[0].id, ok: true }))).json()).recorded, true);
  assert.equal((await ownerPost(slidingOwner, "thomastown-sliding", { kind: "user.add", name: "x", phone: "bad", clientKey: KEY }, "owner@example.test")).status, 400);
  assert.equal((await ownerPost(slidingOwner, "thomastown-sliding", { kind: "user.add", name: "x", phone: "0455111222", clientKey: KEY }, "staff@example.test")).status, 404);
  const pulse = await ownerPost(slidingOwner, "thomastown-sliding", { kind: "gate.pulse", clientKey: "44444444-4444-4444-8444-444444444444" });
  assert.equal(pulse.status, 400);
  assert.match((await pulse.json()).error ?? "", /cannot be opened from the portal/);
});

test("the owner list carries both Azure gate sites", () => {
  assert.deepEqual(model.GD_SITES["thomastown-sliding"], { name: model.SLIDING_SITE_NAME, secretEnv: "GD_THOMASTOWN_SLIDING_SECRET" });
  assert.equal(model.isGdSiteId("thomastown-sliding"), true); assert.equal(model.isGdSiteId("mildura"), false); assert.equal(model.isGdSiteId("__proto__"), false);
});
