// Mildura on Azure (7 Nov 2026): the Pi's EXISTING mirror protocol served from the Azure `gd` schema.
// The real migrations (001 + 003) run on PostgreSQL semantics (PGlite); the real routes run against them; and one
// test drives the real Pi code (deploy/mildura/pi/mildura_mirror.py) over HTTP at the real route.
// NOT covered here (needs live infrastructure): the node-postgres pool/TLS in lib/gd-db.ts, the Pi's systemd unit.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const authLib = await vite.ssrLoadModule("/lib/portal-auth.ts");
const gddb = await vite.ssrLoadModule("/lib/gd-db.ts");
const cmdModel = await vite.ssrLoadModule("/lib/mildura-commands-model.ts");
const deviceRoute = await vite.ssrLoadModule("/app/api/device/mildura/route.ts");
const ownerRoute = await vite.ssrLoadModule("/app/api/owner/mildura/route.ts");
const sitesRoute = await vite.ssrLoadModule("/app/api/owner/sites/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const DEVICE = "mildura-001";
const SECRET = "m".repeat(48);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const SQL = ["001_thomastown_swing.sql", "003_mildura.sql"].map((f) => new URL(`../deploy/azure/gd/${f}`, import.meta.url));
const ROLLBACK = new URL("../deploy/azure/gd/003_mildura_rollback.sql", import.meta.url);
const sql = (u) => readFileSync(u, "utf8");
const KEY = "22222222-2222-4222-8222-222222222222";

// A real RSA keypair standing in for the Pi's command key.
const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
const pem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
const PUB = pem(await crypto.subtle.exportKey("spki", kp.publicKey), "PUBLIC KEY");

async function fixture(t, { secretHash = sha(SECRET), pubkey = null } = {}) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec("CREATE ROLE balwyn_app;");
  for (const f of SQL) await pg.exec(sql(f));
  if (secretHash) await pg.query("UPDATE gd.devices SET secret_sha256=$1, command_pubkey=$2 WHERE device_id=$3", [secretHash, pubkey, DEVICE]);
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
    PORTAL_OWNER_EMAIL: "owner@example.test", MILDURA_BACKEND: "azure",
  });
  return pg;
}
const post = (body, secret = SECRET) => deviceRoute.POST(new Request(`${origin}/api/device/mildura`, { method: "POST", body: JSON.stringify({ device_id: DEVICE, secret, ...body }) }));
async function cookie(email) { return (await authLib.createSessionCookie({ displayName: "Jarrod", email, role: "administrator" })).split(";")[0]; }
const ownerGet = async (email = "owner@example.test") => ownerRoute.GET(new Request(`${origin}/api/owner/mildura`, { headers: { Cookie: await cookie(email) } }));
const ownerPost = async (body, email = "owner@example.test") => ownerRoute.POST(new Request(`${origin}/api/owner/mildura`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: await cookie(email) }, body: JSON.stringify(body) }));
const mirror = async (email = "owner@example.test") => sitesRoute.GET(new Request(`${origin}/api/owner/sites?site=mildura&view=mirror`, { headers: { Cookie: await cookie(email) } }));

// The shape the Pi sends (mildura_mirror.build_payload): snapshots + streams keyed by the gate app's own tables.
const PUSH = { action: "push", fw_version: "mirror-2.3.0", status: { lockdown: false, mirror_caps: ["users", "schedules", "persons"], health: { cpu_percent: 3 } },
  snapshots: {
    users: [{ id: 1, name: "Alice Staff", enabled: 1, schedule_type: "always", schedule_data: null, created_at: "2026-11-01 09:00:00" },
      { id: 2, name: "Bob Staff", enabled: 0, schedule_type: "time_range", schedule_data: '{"days":[0],"start":"08:00","end":"17:00"}', created_at: "2026-11-01 09:01:00" }],
    auto_schedules: [{ id: 1, name: "Weekday", days: "0,1,2,3,4", open_time: "07:00", close_time: "17:00", enabled: 1 }],
    auth_persons: [{ id: 1, name: "Carol", role: "Manager" }] },
  streams: {
    access_log: [{ id: 10, user_name: "Alice Staff", method: "web", success: 1, timestamp: "2026-11-06 22:22:54", attempted_pin: "482913" },
      { id: 11, user_name: "—", method: "web", success: 0, timestamp: "2026-11-06 23:05:57", attempted_pin: "908172" },
      { id: 12, user_name: "—", method: "web", success: 0, timestamp: "2026-11-06 23:06:57", attempted_pin: "not-a-pin" }],
    changes_log: [{ id: 5, action: "ADD_USER", detail: "added", changed_by: "Admin", timestamp: "2026-11-06 21:00:00" }] } };

test("the Pi's request is refused (same bare 401) unless device id and secret both match the stored hash", async (t) => {
  const pg = await fixture(t);
  const bodies = [
    JSON.stringify({ device_id: DEVICE, secret: "w".repeat(48), action: "push" }),        // wrong secret
    JSON.stringify({ device_id: DEVICE, secret: "short", action: "push" }),               // too short
    JSON.stringify({ device_id: "thomastown-swing", secret: SECRET, action: "push" }),    // another device
    JSON.stringify({ action: "push" }),                                                   // nothing
  ];
  for (const body of bodies) {
    const r = await deviceRoute.POST(new Request(`${origin}/api/device/mildura`, { method: "POST", body }));
    assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: "auth" });
  }
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_users")).rows[0].n, 0);
  assert.equal((await deviceRoute.POST(new Request(`${origin}/api/device/mildura`, { method: "POST", body: "{not json" }))).status, 400);
  assert.equal((await deviceRoute.POST(new Request(`${origin}/api/device/mildura`, { method: "POST", body: "x".repeat(1_100_000) }))).status, 413);
});

test("with no secret hash stored, every request fails closed", async (t) => {
  await fixture(t, { secretHash: null });
  assert.equal((await post({ action: "push" })).status, 401);
});

test("push stores snapshots, history and the entered PIN in its own table; a resend changes nothing; deletions mirror", async (t) => {
  const pg = await fixture(t);
  const r = await post(PUSH);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_users")).rows[0].n, 2);
  assert.equal((await pg.query("SELECT enabled FROM gd.mildura_users WHERE local_id=2")).rows[0].enabled, false);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_access")).rows[0].n, 3);
  // Only well-formed digit strings are accepted as an entered PIN.
  assert.deepEqual((await pg.query("SELECT local_id::int AS id, attempted_pin FROM gd.mildura_access_pins ORDER BY local_id")).rows, [{ id: 10, attempted_pin: "482913" }, { id: 11, attempted_pin: "908172" }]);
  const dev = (await pg.query("SELECT last_seen, fw_version, last_status FROM gd.devices WHERE device_id=$1", [DEVICE])).rows[0];
  assert.ok(dev.last_seen); assert.equal(dev.fw_version, "mirror-2.3.0"); assert.deepEqual(dev.last_status.mirror_caps, ["users", "schedules", "persons"]);
  assert.equal((await post(PUSH)).status, 200);                                          // idempotent resend
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_access")).rows[0].n, 3);
  assert.equal((await post({ action: "push", snapshots: { users: [PUSH.snapshots.users[0]] } })).status, 200);
  assert.deepEqual((await pg.query("SELECT local_id::int AS id FROM gd.mildura_users")).rows, [{ id: 1 }]);   // Bob was deleted on the Pi
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_persons")).rows[0].n, 1);          // untouched: not in this push
  // A snapshot the Pi did not send is never treated as "delete everything".
  assert.equal((await post({ action: "push", snapshots: {} })).status, 200);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_users")).rows[0].n, 1);
});

test("a failed table write rolls the whole push back so the Pi (which advances its marks only on ok) retries", async (t) => {
  const pg = await fixture(t);
  await pg.exec("ALTER TABLE gd.mildura_changes ADD CONSTRAINT boom CHECK (action <> 'BOOM')");
  const bad = { ...PUSH, streams: { ...PUSH.streams, changes_log: [{ id: 6, action: "BOOM", detail: "x", changed_by: "A", timestamp: "2026-11-06 21:00:00" }] } };
  const r = await post(bad);
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "store" });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_users")).rows[0].n, 0);
  assert.equal((await pg.query("SELECT last_seen FROM gd.devices WHERE device_id=$1", [DEVICE])).rows[0].last_seen !== null, true);   // heartbeat still recorded
});

test("command key: first write wins, a different key is reported, junk is refused", async (t) => {
  const pg = await fixture(t);
  assert.deepEqual(await (await post({ action: "key", pubkey: PUB })).json(), { ok: true, registered: true });
  assert.deepEqual(await (await post({ action: "key", pubkey: PUB })).json(), { ok: true, registered: true });
  const other = PUB.replace("A", "B");
  assert.deepEqual(await (await post({ action: "key", pubkey: other })).json(), { ok: true, registered: false });
  assert.equal((await pg.query("SELECT command_pubkey FROM gd.devices WHERE device_id=$1", [DEVICE])).rows[0].command_pubkey, PUB);
  assert.equal((await post({ action: "key", pubkey: "not a key" })).status, 400);
});

test("owner queues a PIN command sealed to the Pi's key; the Pi collects, acks, and the ciphertext is wiped", async (t) => {
  const pg = await fixture(t, { pubkey: PUB });
  await post(PUSH);
  const queued = await ownerPost({ kind: "user.add", name: "Dave Staff", pin: "731946", clientKey: KEY });
  assert.equal(queued.status, 200);
  const q = await queued.json();
  assert.equal(q.ok, true); assert.equal(q.duplicate, false); assert.equal(q.command.status, "pending");
  assert.equal(JSON.stringify(q).includes("731946"), false);                              // never echoed
  assert.equal(JSON.stringify(q).includes("sealed"), false);
  const row = (await pg.query("SELECT args, sealed FROM gd.mildura_commands")).rows[0];
  assert.equal(JSON.stringify(row.args).includes("731946"), false);                       // never stored in plaintext
  assert.ok(row.sealed && row.sealed.length > 100);
  const plain = JSON.parse(Buffer.from(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, kp.privateKey, Buffer.from(row.sealed, "base64"))).toString());
  assert.deepEqual(plain, { pin: "731946", cmd: q.command.id });                          // only the Pi's private key opens it, bound to this command
  assert.equal((await ownerPost({ kind: "user.add", name: "Dave Staff", pin: "731946", clientKey: KEY })).status, 200);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_commands")).rows[0].n, 1);       // same click twice: one command

  const got = await (await post({ action: "commands" })).json();
  assert.equal(got.ok, true); assert.equal(got.commands.length, 1);
  const c = got.commands[0];
  assert.equal(c.id, q.command.id); assert.equal(c.kind, "user.add"); assert.equal(typeof c.seq, "number"); assert.ok(c.sealed); assert.ok(!Number.isNaN(Date.parse(c.created_at)));
  assert.equal((await post({ action: "commands" })).status, 200);                         // still delivered until acked
  assert.equal((await (await post({ action: "commands" })).json()).commands.length, 1);
  await post({ action: "ack", results: [{ id: c.id, ok: true, result: { local_id: 3 } }] });
  const done = (await pg.query("SELECT status, sealed, result FROM gd.mildura_commands")).rows[0];
  assert.equal(done.status, "applied"); assert.equal(done.sealed, null); assert.deepEqual(done.result, { local_id: 3 });
  assert.equal((await (await post({ action: "commands" })).json()).commands.length, 0);
  const view = await (await ownerGet()).json();
  assert.equal(view.commands[0].status, "applied"); assert.equal(view.keyRegistered, true); assert.equal(typeof view.keyFingerprint, "string");
  const audit = (await pg.query("SELECT local_id::int AS id, source, changed_by FROM gd.mildura_changes WHERE source='portal'")).rows;
  assert.equal(audit.length, 1); assert.ok(audit[0].id < 0); assert.equal(audit[0].changed_by, "portal:owner@example.test");
});

test("database rules: no plaintext PIN in args, no ciphertext on a finished row, an expired command is wiped", async (t) => {
  const pg = await fixture(t, { pubkey: PUB });
  const ins = (extra) => pg.query(`INSERT INTO gd.mildura_commands(id,device_id,client_key,kind,actor_email${extra.cols}) VALUES (gen_random_uuid(),$1,gen_random_uuid(),'user.add','a@b.c'${extra.vals})`, [DEVICE]);
  await assert.rejects(pg.query("INSERT INTO gd.mildura_commands(id,device_id,client_key,kind,args,actor_email) VALUES (gen_random_uuid(),$1,gen_random_uuid(),'user.add','{\"pin\":\"1234\"}','a@b.c')", [DEVICE]), /no_plain_secret/);
  await ins({ cols: ",status,sealed", vals: ",'applied','" + "x".repeat(40) + "'" });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_commands WHERE sealed IS NOT NULL")).rows[0].n, 0);   // trigger wiped it
  await ins({ cols: ",sealed,expires_at", vals: ",'" + "y".repeat(40) + "', now() - interval '1 minute'" });
  assert.equal((await (await post({ action: "commands" })).json()).commands.length, 0);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_commands WHERE status='expired' AND sealed IS NULL")).rows[0].n, 1);
});

test("owner screens: 404 for anyone else; mirror view carries the entered PIN; the sidebar lists Mildura from Azure even when Supabase is down", async (t) => {
  await fixture(t, { pubkey: PUB });
  await post(PUSH);
  assert.equal((await ownerGet("staff@example.test")).status, 404);
  assert.equal((await mirror("staff@example.test")).status, 404);
  const d = await (await mirror()).json();
  assert.deepEqual(d.site, { id: DEVICE, slug: "mildura", name: "Mildura Working Men's Club" });
  assert.equal(d.users.length, 2); assert.equal(d.users[0].local_id, 1); assert.equal(typeof d.users[0].local_id, "number");
  assert.equal(d.access[0].local_id, 12); assert.equal(d.access.find((a) => a.local_id === 10).entered_pin, "482913"); assert.equal(d.access.find((a) => a.local_id === 12).entered_pin, null);
  assert.equal(d.units[0].last_status.mirror_caps.includes("users"), true);
  assert.equal(d.access30.length >= 0, true); assert.equal(d.changes.length, 1);
  env.fetchDatabase = async () => new Response("payment required", { status: 402 });   // Supabase is down
  const list = await (await sitesRoute.GET(new Request(`${origin}/api/owner/sites`, { headers: { Cookie: await cookie("owner@example.test") } }))).json();
  assert.equal(list.sites.filter((s) => s.slug === "mildura").length, 1);
  assert.equal(list.sites[0].gd_units[0].last_seen !== null, true);
  assert.equal(list.sitesUnavailable, true);                                             // honest: the Supabase part is down
});

test("gate actions are offered only when the Pi advertises them; the 90 s Open Gate expiry is set", async (t) => {
  const pg = await fixture(t, { pubkey: PUB });
  await post({ action: "push", status: { mirror_caps: ["users"] } });
  assert.equal((await ownerPost({ kind: "gate.open", clientKey: KEY })).status, 400);   // not advertised
  await post({ action: "push", status: { mirror_caps: ["users", "gate.open"] } });
  assert.equal((await ownerPost({ kind: "gate.open", clientKey: KEY })).status, 200);
  const s = (await pg.query("SELECT extract(epoch FROM (expires_at - created_at))::int AS s FROM gd.mildura_commands")).rows[0].s;
  assert.ok(s >= 85 && s <= 95, `ttl ${s}`);
});

test("the school portal's role is shut out; the migration re-runs and rolls back cleanly", async (t) => {
  const pg = await fixture(t);
  await pg.exec("SET ROLE balwyn_app");
  await assert.rejects(pg.query("SELECT * FROM gd.mildura_users"), /permission denied/);
  await assert.rejects(pg.query("SELECT * FROM gd.mildura_access_pins"), /permission denied/);
  await pg.exec("RESET ROLE; SET ROLE gd_app");
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_commands")).rows[0].n, 0);
  await pg.exec("RESET ROLE");
  await pg.exec(sql(SQL[1]));                                                            // re-running is harmless
  assert.equal((await pg.query("SELECT secret_sha256 FROM gd.devices WHERE device_id=$1", [DEVICE])).rows[0].secret_sha256, sha(SECRET));
  await pg.exec(sql(ROLLBACK));
  await assert.rejects(pg.query("SELECT 1 FROM gd.mildura_users"), /does not exist/);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.devices WHERE device_id='thomastown-swing'")).rows[0].n, 1);   // Thomastown untouched
});

test("END TO END: the real Pi mirror code (mildura_mirror.py) syncs a real SQLite gate database through the real route", async (t) => {
  const pg = await fixture(t, { pubkey: null });
  // HTTP bridge: the Pi's urllib talks to this server, which hands each request to the real route handler.
  const srv = createHttp(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await deviceRoute.POST(new Request(`${origin}/api/device/mildura`, { method: "POST", body: Buffer.concat(chunks) }));
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(await r.text());
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok)); t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}/api/device/mildura`;
  const dir = mkdtempSync(join(tmpdir(), "mk-e2e-"));
  const py = join(dir, "run.py");
  writeFileSync(py, `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(root, "deploy/mildura/pi"))}); sys.path.insert(0, ${JSON.stringify(join(root, "deploy/mildura/tests"))})
import mildura_mirror as m, test_mirror as t
db, st, url = sys.argv[1:4]
t.make_db(db, True)
m.local_status = lambda u: {"lockdown": False}
creds = {"device_id": "mildura-001", "secret": ${JSON.stringify(SECRET)}}
state = {}
m.cycle(db, url, creds, state, st, "", ["users"])
print(json.dumps({"synced": True, "users_mark": bool(state.get("snap", {}).get("users"))}))
`);
  const run = promisify(execFile);
  let out;
  try { out = await run("python3", ["-I", py, join(dir, "gate.db"), join(dir, "state.json"), url], { timeout: 60_000 }); }
  catch (e) { throw new Error(`Pi code failed against the Azure route: ${e.stderr || e.message}`); }
  assert.match(out.stdout, /"synced": true/);
  assert.deepEqual((await pg.query("SELECT name FROM gd.mildura_users ORDER BY local_id")).rows.map((r) => r.name), ["Alice Staff", "Bob Staff"]);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.mildura_access")).rows[0].n, 2);
  assert.equal((await pg.query("SELECT attempted_pin FROM gd.mildura_access_pins")).rows[0].attempted_pin, "908172");
  assert.equal((await pg.query("SELECT fw_version FROM gd.devices WHERE device_id=$1", [DEVICE])).rows[0].fw_version, "mirror-2.3.0");
  // The gate database's own PINs (users.pin, auth_persons.pin) must never have reached Azure.
  const dump = JSON.stringify((await pg.query("SELECT * FROM gd.mildura_users")).rows) + JSON.stringify((await pg.query("SELECT * FROM gd.mildura_changes")).rows);
  assert.equal(dump.includes("482913") || dump.includes("775201"), false);
});
