// Gate SIM number (8 Nov 2026): the Pi reports the fitted SIM in its heartbeat; if the SIM stores no number the owner types it once.
// Real migrations 001 + 004 + 005 on PGlite. NOT covered: the Pi side (tests/test_sim_identity.py in the Thomastown repo) and the browser form.
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
const HOLD_SQL = readFileSync(new URL("../deploy/azure/gd/004_hold_windows.sql", import.meta.url), "utf8");
const HOLD_ROLLBACK = readFileSync(new URL("../deploy/azure/gd/004_hold_windows_rollback.sql", import.meta.url), "utf8");
const SIM_SQL = readFileSync(new URL("../deploy/azure/gd/005_sim_number.sql", import.meta.url), "utf8");
const SIM_ROLLBACK = readFileSync(new URL("../deploy/azure/gd/005_sim_number_rollback.sql", import.meta.url), "utf8");
const KEY = "11111111-1111-4111-8111-111111111111";
const ICCID = "89610185001234567890";

async function fixture(t, withSim = true) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");                       // exists in production; the migration must shut it out
  await pg.exec(SQL);
  await pg.exec(HOLD_SQL);
  if (withSim) await pg.exec(SIM_SQL);
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


let k = 0;
const key = () => `33333333-3333-4333-8333-${String(++k).padStart(12, "0")}`;

test("simInfo reads the heartbeat: old Pi, not read, no SIM, needs a number, ok", () => {
  assert.equal(model.simInfo(null).state, "unsupported");
  assert.equal(model.simInfo({ sync_alive: true }).state, "unsupported");            // Pi software older than SIM reporting
  assert.equal(model.simInfo({ sim_read: false, sim_iccid: "" }).state, "unread");
  assert.equal(model.simInfo({ sim_read: true, sim_iccid: "" }).state, "nosim");
  assert.equal(model.simInfo({ sim_read: true, sim_iccid: "abc" }).state, "nosim");  // not a real ICCID: treated as no readable SIM
  assert.deepEqual(model.simInfo({ sim_read: true, sim_iccid: ICCID, sim_number: "" }), { state: "needs_number", iccid: ICCID });
  assert.deepEqual(model.simInfo({ sim_read: true, sim_iccid: ICCID, sim_number: "0475184833", sim_number_source: "sim" }), { state: "ok", iccid: ICCID, number: "0475184833", source: "sim" });
  assert.equal(model.simInfo({ sim_read: true, sim_iccid: ICCID, sim_number: "0400101132", sim_number_source: "owner" }).source, "owner");
  assert.equal(model.simInfo({ sim_read: true, sim_iccid: ICCID, sim_number: "123" }).state, "needs_number");
});

test("sim.number is validated: real ICCID, any Australian format in, local form out", () => {
  const ok = model.swingCommandInput({ kind: "sim.number", iccid: ICCID, number: "+61 475 184 833", clientKey: KEY });
  assert.deepEqual(ok.args, { iccid: ICCID, number: "0475184833" });
  assert.equal(ok.summary, "Set the gate's dial-in number to 0475 184 833");
  for (const bad of [{ number: "12345" }, { number: "" }, { number: "+14155550100" }, { iccid: "123" }, { iccid: undefined }, { iccid: `${ICCID}9999` }]) {
    assert.throws(() => model.swingCommandInput({ kind: "sim.number", iccid: ICCID, number: "0475184833", clientKey: KEY, ...bad }), undefined, JSON.stringify(bad));
  }
});

test("heartbeat SIM keys survive the push filter and reach the owner", async (t) => {
  await fixture(t);
  const hb = { sync_alive: true, sim_read: true, sim_iccid: ICCID, sim_number: "", sim_number_source: "" };
  assert.equal((await deviceRoute.POST(await signed({ action: "push", status: hb }))).status, 200);
  const seen = await (await ownerGet()).json();
  assert.equal(seen.device.last_status.sim_iccid, ICCID);
  assert.equal(seen.device.last_status.sim_read, true);
  assert.equal(model.simInfo(seen.device.last_status).state, "needs_number");
});

test("owner types the number once: queued, collected by the Pi with its exact args, then shown from the next heartbeat", async (t) => {
  await fixture(t);
  await deviceRoute.POST(await signed({ action: "push", status: { sim_read: true, sim_iccid: ICCID, sim_number: "", sim_number_source: "" } }));
  const queued = await ownerPost({ kind: "sim.number", iccid: ICCID, number: "0400 101 132", clientKey: key() });
  assert.equal(queued.status, 200);
  const got = await (await deviceRoute.POST(await signed({ action: "commands" }))).json();
  assert.equal(got.commands.length, 1);
  assert.equal(got.commands[0].kind, "sim.number");
  assert.deepEqual(got.commands[0].args, { iccid: ICCID, number: "0400101132" });
  assert.equal((await (await deviceRoute.POST(await signed({ action: "ack", id: got.commands[0].id, ok: true, result: { number: "0400101132" } }))).json()).recorded, true);
  await deviceRoute.POST(await signed({ action: "push", status: { sim_read: true, sim_iccid: ICCID, sim_number: "0400101132", sim_number_source: "owner" } }));
  const info = model.simInfo((await (await ownerGet()).json()).device.last_status);
  assert.deepEqual(info, { state: "ok", iccid: ICCID, number: "0400101132", source: "owner" });
  const changes = (await (await ownerGet()).json()).changes;
  assert.ok(changes.some((c) => c.action === "portal.sim.number"));
});

test("a Pi that refuses (SIM swapped) is shown as failed with its reason", async (t) => {
  await fixture(t);
  await ownerPost({ kind: "sim.number", iccid: ICCID, number: "0400101132", clientKey: key() });
  const got = await (await deviceRoute.POST(await signed({ action: "commands" }))).json();
  await deviceRoute.POST(await signed({ action: "ack", id: got.commands[0].id, ok: false, error: "The SIM in the unit has changed. Reload the page." }));
  const c = (await (await ownerGet()).json()).commands.find((x) => x.kind === "sim.number");
  assert.equal(c.status, "failed");
  assert.match(c.error, /SIM in the unit has changed/);
});

test("only the owner can set it; same click queues once; bad input is a 400", async (t) => {
  await fixture(t);
  const body = { kind: "sim.number", iccid: ICCID, number: "0400101132" };
  assert.equal((await ownerPost({ ...body, clientKey: key() }, { email: "staff@example.test" })).status, 404);
  assert.equal((await ownerPost({ ...body, clientKey: key() }, { headers: { Origin: "https://evil.example" } })).status, 403);
  const same = key();
  const a = await (await ownerPost({ ...body, clientKey: same })).json();
  const b = await (await ownerPost({ ...body, clientKey: same })).json();
  assert.equal(b.duplicate, true); assert.equal(a.command.id, b.command.id);
  assert.equal((await ownerPost({ ...body, number: "nope", clientKey: key() })).status, 400);
});

test("before migration 005 the page loads and the save is refused plainly", async (t) => {
  await fixture(t, false);
  assert.equal((await ownerGet()).status, 200);
  const r = await ownerPost({ kind: "sim.number", iccid: ICCID, number: "0400101132", clientKey: key() });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error ?? "", /not set up on the server yet/);
  // hold commands are unaffected
  assert.equal((await ownerPost({ kind: "hold.add", name: "A", days: [0], open_time: "06:00", close_time: "18:00", clientKey: key() })).status, 200);
});

test("migration 005 is re-runnable and its rollback removes only sim.number", async (t) => {
  const pg = await fixture(t);
  await pg.exec(SIM_SQL);                                                            // twice: still fine
  await ownerPost({ kind: "sim.number", iccid: ICCID, number: "0400101132", clientKey: key() });
  await ownerPost({ kind: "hold.add", name: "A", days: [0], open_time: "06:00", close_time: "18:00", clientKey: key() });
  await pg.exec(SIM_ROLLBACK);
  const kinds = (await pg.query("SELECT kind FROM gd.commands")).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["hold.add"]);
  await assert.rejects(() => pg.query("INSERT INTO gd.commands(id,device_id,client_key,kind,args,actor_email,expires_at) VALUES (gen_random_uuid(),'thomastown-swing',gen_random_uuid(),'sim.number','{}','x',now())"));
});
