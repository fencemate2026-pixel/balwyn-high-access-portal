// Hold-open windows (7 Nov 2026) on the Azure-backed Thomastown gates. Real migrations 001 + 003 on PGlite.
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
const HOLD_SQL = readFileSync(new URL("../deploy/azure/gd/003_hold_windows.sql", import.meta.url), "utf8");
const HOLD_ROLLBACK = readFileSync(new URL("../deploy/azure/gd/003_hold_windows_rollback.sql", import.meta.url), "utf8");
const KEY = "11111111-1111-4111-8111-111111111111";

async function fixture(t, withHolds = true) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");                       // exists in production; the migration must shut it out
  await pg.exec(SQL);
  if (withHolds) await pg.exec(HOLD_SQL);
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
const key = () => `22222222-2222-4222-8222-${String(++k).padStart(12, "0")}`;
const WIN = { kind: "hold.add", name: "Business hours", days: [6, 0, 1, 2, 3, 4, 5], open_time: "06:00", close_time: "18:00" };

test("hold commands are validated and use the Pi's field names", () => {
  const add = model.swingCommandInput({ ...WIN, clientKey: KEY });
  assert.deepEqual(add.args, { name: "Business hours", days: [0, 1, 2, 3, 4, 5, 6], open_time: "06:00", close_time: "18:00" });
  assert.equal(model.swingCommandInput({ ...WIN, open_time: "22:00", close_time: "06:00", clientKey: KEY }).args.close_time, "06:00");   // overnight allowed
  for (const bad of [{ name: "" }, { days: [] }, { days: [7] }, { days: [1, 1] }, { days: "all" }, { open_time: "6:00" }, { close_time: "24:00" }, { open_time: "06:00", close_time: "06:00" }, { kind: "hold.nuke" }]) {
    assert.throws(() => model.swingCommandInput({ ...WIN, clientKey: KEY, ...bad }), undefined, JSON.stringify(bad));
  }
  assert.throws(() => model.swingCommandInput({ kind: "hold.update", local_id: 1, clientKey: KEY }), /Nothing to change/);
  assert.deepEqual(model.swingCommandInput({ kind: "hold.update", local_id: 2, close_time: "19:30", clientKey: KEY }).args, { local_id: 2, close_time: "19:30" });
  assert.equal(model.swingCommandInput({ kind: "hold.enable", local_id: 2, enabled: false, clientKey: KEY }).summary, "Disable hold window #2");
  assert.throws(() => model.swingCommandInput({ kind: "hold.enable", local_id: 2, enabled: "no", clientKey: KEY }));
});

test("pushed hold windows are typed and bounded", () => {
  const p = model.pushInput({ holds: [{ local_id: 1, name: "A", days: [0, 0, 9, 3], open_time: "06:00", close_time: "18:00", enabled: 1, evil: "x" },
    { local_id: 2, name: "bad time", days: [1], open_time: "6am", close_time: "18:00" }, { local_id: 3, name: "no days", days: [], open_time: "06:00", close_time: "07:00" }, null] });
  assert.deepEqual(p.holds, [{ local_id: 1, name: "A", days: [0, 3], open_time: "06:00", close_time: "18:00", enabled: true }]);
  assert.equal(model.pushInput({ action: "push" }).holds, null);                 // no holds key = leave the mirror alone
});

test("owner queues a hold change, the Pi collects it, mirrors the result, and the owner sees it", async (t) => {
  await fixture(t);
  const queued = await ownerPost({ ...WIN, clientKey: key() });
  assert.equal(queued.status, 200);
  const got = await (await deviceRoute.POST(await signed({ action: "commands" }))).json();
  assert.equal(got.commands.length, 1);
  assert.equal(got.commands[0].kind, "hold.add");
  assert.deepEqual(got.commands[0].args, { name: "Business hours", days: [0, 1, 2, 3, 4, 5, 6], open_time: "06:00", close_time: "18:00" });
  assert.equal((await (await deviceRoute.POST(await signed({ action: "ack", id: got.commands[0].id, ok: true, result: { local_id: 1 } }))).json()).recorded, true);
  const push = await (await deviceRoute.POST(await signed({ action: "push", holds: [{ local_id: 1, name: "Business hours", days: [0, 1, 2, 3, 4, 5, 6], open_time: "06:00", close_time: "18:00", enabled: true }] }))).json();
  assert.equal(push.stored.holds, 1);
  const seen = await (await ownerGet()).json();
  assert.equal(seen.holdsReady, true);
  assert.deepEqual(seen.holds.map((h) => [h.local_id, h.name, h.open_time, h.close_time, h.enabled, h.days]), [[1, "Business hours", "06:00", "18:00", true, [0, 1, 2, 3, 4, 5, 6]]]);
  // a later push without the window removes it from the mirror (the Pi is the authority)
  await deviceRoute.POST(await signed({ action: "push", holds: [] }));
  assert.equal((await (await ownerGet()).json()).holds.length, 0);
});

test("only the owner can queue hold changes; double click queues once", async (t) => {
  await fixture(t);
  assert.equal((await ownerPost({ ...WIN, clientKey: key() }, { email: "staff@example.test" })).status, 404);
  assert.equal((await ownerPost({ ...WIN, clientKey: key() }, { headers: { Origin: "https://evil.example" } })).status, 403);
  const same = key();
  const a = await (await ownerPost({ ...WIN, clientKey: same })).json();
  const b = await (await ownerPost({ ...WIN, clientKey: same })).json();
  assert.equal(b.duplicate, true);
  assert.equal(a.command.id, b.command.id);
});

test("before migration 003 the page still loads and a hold change is refused plainly", async (t) => {
  await fixture(t, false);
  const seen = await ownerGet();
  assert.equal(seen.status, 200);
  const body = await seen.json();
  assert.equal(body.holdsReady, false);
  assert.deepEqual(body.holds, []);
  const refused = await ownerPost({ ...WIN, clientKey: key() });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /not set up/);
  assert.equal((await ownerPost({ kind: "user.delete", local_id: 1, clientKey: key() })).status, 200);   // callers unaffected
  const push = await (await deviceRoute.POST(await signed({ action: "push", holds: [{ local_id: 1, name: "A", days: [1], open_time: "06:00", close_time: "07:00", enabled: true }] }))).json();
  assert.equal(push.ok, true);                                                                           // old table absent: skipped, not an error
});

test("migration 003 is re-runnable, keeps balwyn_app out, and its rollback restores the original kinds", async (t) => {
  const pg = await fixture(t);
  await pg.exec(HOLD_SQL);                                                                               // second run
  const priv = await pg.query("SELECT has_table_privilege('balwyn_app','gd.hold_windows','SELECT') AS p");
  assert.equal(priv.rows[0].p, false);
  await ownerPost({ ...WIN, clientKey: key() });
  await ownerPost({ kind: "user.delete", local_id: 1, clientKey: key() });
  await pg.exec(HOLD_ROLLBACK);
  const left = await pg.query("SELECT kind FROM gd.commands");
  assert.deepEqual(left.rows.map((r) => r.kind), ["user.delete"]);
  await assert.rejects(pg.query("INSERT INTO gd.commands(id,device_id,client_key,kind,actor_email) VALUES (gen_random_uuid(),'thomastown-swing',gen_random_uuid(),'hold.add','x')"));
});
