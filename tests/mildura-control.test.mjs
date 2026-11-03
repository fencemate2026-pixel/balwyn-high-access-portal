// Mildura Phase 2 (4 Nov 2026): owner-only command queue. Owner + same-origin + admin unlock,
// validation, PIN sealed to the Pi key and NEVER persisted/echoed in plaintext, idempotent clicks,
// gate actuation blocked, audit rows. The sealed value is decrypted with the exact openssl command the Pi runs.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const route = await vite.ssrLoadModule("/app/api/owner/mildura/route.ts");
const model = await vite.ssrLoadModule("/lib/mildura-commands-model.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SITE = { id: "55555555-5555-4555-8555-555555555555", slug: "mildura", name: "Mildura Working Men's Club" };
const UNIT = "66666666-6666-4666-8666-666666666666";
const PIN = "731946";

// A real RSA keypair standing in for the Pi's; private key written as PEM for the openssl decrypt.
const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
const pem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
const PUB = pem(await crypto.subtle.exportKey("spki", kp.publicKey), "PUBLIC KEY");
const dir = mkdtempSync(join(tmpdir(), "mk-"));
const PRIV = join(dir, "k.pem");
writeFileSync(PRIV, pem(await crypto.subtle.exportKey("pkcs8", kp.privateKey), "PRIVATE KEY"));
const piDecrypt = (b64) => JSON.parse(execFileSync("openssl", ["pkeyutl", "-decrypt", "-inkey", PRIV, "-pkeyopt", "rsa_padding_mode:oaep",
  "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256"], { input: Buffer.from(b64, "base64") }).toString());

function fake({ pubkey = PUB, existing = [], caps = ["users", "schedules", "persons"] } = {}) {
  const calls = [];
  env.fetchDatabase = async (path, init = {}) => {
    const u = new URL(String(path), "https://example.supabase.co");
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: decodeURIComponent(u.search), body: init.body ? String(init.body) : "" });
    const j = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/gd_sites")) return j([SITE]);
    if (u.pathname.endsWith("/gd_units")) return j([{ id: UNIT, command_pubkey: pubkey, last_status: { lockdown: false, mirror_caps: caps } }]);
    if (u.pathname.endsWith("/gd_mirror_commands") && (init.method ?? "GET") === "GET") return j(u.search.includes("client_key") ? existing : [{ id: "c1", kind: "user.add", status: "applied" }]);
    if (u.pathname.endsWith("/gd_mirror_commands")) { const b = JSON.parse(init.body); return j([{ id: b.id, kind: b.kind, status: "pending" }]); }
    return j([]);
  };
  return calls;
}

async function as(email, { unlocked = true, ...opts } = {}) {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: "owner@example.test|administrator,staff@example.test|administrator", PORTAL_OWNER_EMAIL: "owner@example.test",
    PORTAL_SETTINGS_PASSWORD_SALT: "test-salt", PORTAL_SETTINGS_PASSWORD_HASH: "test-hash" });
  const calls = fake(opts);
  const session = (await auth.createSessionCookie({ displayName: "Jarrod", email, role: "administrator" })).split(";")[0];
  let cookie = session;
  if (unlocked) cookie += "; " + (await auth.createAdminSettingsCookie(new Request(origin, { headers: { Cookie: session } }))).cookie.split(";")[0];
  const post = (body, extra = {}) => route.POST(new Request(`${origin}/api/owner/mildura`, { method: "POST",
    headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie, ...extra }, body: JSON.stringify(body) }));
  const get = () => route.GET(new Request(`${origin}/api/owner/mildura`, { headers: { Cookie: cookie } }));
  return { calls, post, get };
}
const key = () => crypto.randomUUID();
const writes = (calls) => calls.filter((c) => c.method !== "GET");

test("non-owners get 404 and touch nothing", async () => {
  const { post, get, calls } = await as("staff@example.test");
  assert.equal((await get()).status, 404);
  assert.equal((await post({ kind: "users.enable_all", enabled: false, clientKey: key() })).status, 404);
  assert.equal(calls.length, 0);
});

test("cross-origin and locked-settings requests are refused before any write", async () => {
  let s = await as("owner@example.test");
  assert.equal((await s.post({ kind: "user.delete", local_id: 3, clientKey: key() }, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal(s.calls.length, 0);
  s = await as("owner@example.test", { unlocked: false });
  const r = await s.post({ kind: "user.delete", local_id: 3, clientKey: key() });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "admin_password_required");
  assert.equal(writes(s.calls).length, 0);
});

test("adding a user: PIN is sealed to the Pi key, bound to the command, and never stored or echoed in plaintext", async () => {
  const { post, calls } = await as("owner@example.test");
  const res = await post({ kind: "user.add", name: "Sam Smith", pin: PIN, clientKey: key() });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(PIN), "response never echoes the PIN");
  for (const c of calls) assert.ok(!c.body.includes(PIN) && !c.search.includes(PIN), `PIN leaked to ${c.method} ${c.path}`);
  const insert = calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_commands"));
  const row = JSON.parse(insert.body);
  assert.equal(row.kind, "user.add");
  assert.equal(row.unit_id, UNIT);
  assert.equal(row.actor_email, "owner@example.test");
  assert.deepEqual(row.args, { name: "Sam Smith", enabled: true, schedule_type: "always", schedule_data: null });
  assert.ok(!("pin" in row.args));
  assert.deepEqual(piDecrypt(row.sealed), { pin: PIN, cmd: row.id }, "the Pi's openssl decrypt recovers PIN + command id");
  assert.ok(!insert.search.includes("sealed"), "ciphertext is never selected back");
  const audit = calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_changes"));
  const a = JSON.parse(audit.body);
  assert.equal(a.changed_by, "portal:owner@example.test");
  assert.equal(a.source, "portal");
  assert.equal(a.action, "portal.user.add");
  assert.match(a.occurred_at_local, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test("GET lists commands without ciphertext and reports the key fingerprint and gate block", async () => {
  const { get, calls } = await as("owner@example.test");
  const body = await (await get()).json();
  assert.equal(body.unlocked, true);
  assert.equal(body.keyRegistered, true);
  assert.match(body.keyFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(body.gate, { ...body.gate, open: false, lockdown: false, lockdownOn: false, hold: false });
  assert.ok(calls.filter((c) => c.path.endsWith("/gd_mirror_commands")).every((c) => !c.search.includes("sealed")));
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("every non-secret kind queues with plain args and no ciphertext", async () => {
  const cases = [
    [{ kind: "user.update", local_id: 4, name: "New Name" }, { local_id: 4, name: "New Name" }],
    [{ kind: "user.update", local_id: 4, schedule_type: "time_range", schedule_days: [4, 1], schedule_start: "18:00", schedule_end: "01:00" }, { local_id: 4, schedule_type: "time_range", schedule_data: '{"days":[1,4],"start":"18:00","end":"01:00"}' }],
    [{ kind: "user.update", local_id: 4, schedule_type: "always" }, { local_id: 4, schedule_type: "always", schedule_data: null }],
    [{ kind: "user.delete", local_id: 4 }, { local_id: 4 }],
    [{ kind: "user.enable", local_id: 4, enabled: false }, { local_id: 4, enabled: false }],
    [{ kind: "users.enable_all", enabled: true }, { enabled: true }],
    [{ kind: "schedule.add", name: "Weekend", days: [6, 5], open_time: "09:00", close_time: "23:30" }, { name: "Weekend", days: [5, 6], open_time: "09:00", close_time: "23:30" }],
    [{ kind: "schedule.enable", local_id: 2, enabled: true }, { local_id: 2, enabled: true }],
    [{ kind: "schedule.delete", local_id: 2 }, { local_id: 2 }],
    [{ kind: "person.add", name: "Eve", role: "Treasurer" }, { name: "Eve", role: "Treasurer" }],
    [{ kind: "person.delete", local_id: 1 }, { local_id: 1 }],
  ];
  for (const [req, args] of cases) {
    const { post, calls } = await as("owner@example.test");
    assert.equal((await post({ ...req, clientKey: key() })).status, 200, req.kind);
    const row = JSON.parse(calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_commands")).body);
    assert.deepEqual(row.args, args, req.kind);
    assert.equal(row.sealed, null, req.kind);
  }
});

test("person with phone + PIN, and user PIN change: both sealed, neither in args", async () => {
  for (const req of [{ kind: "person.add", name: "Eve", role: "Treasurer", phone: "0411 222 333", pin: "246813" }, { kind: "user.update", local_id: 7, pin: "246813" }]) {
    const { post, calls } = await as("owner@example.test");
    assert.equal((await post({ ...req, clientKey: key() })).status, 200);
    for (const c of calls) assert.ok(!c.body.includes("246813") && !c.body.includes("0411 222 333"), req.kind);
    const row = JSON.parse(calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_commands")).body);
    const s = piDecrypt(row.sealed);
    assert.equal(s.pin, "246813"); assert.equal(s.cmd, row.id);
    if (req.kind === "person.add") assert.equal(s.phone, "0411 222 333");
  }
});

test("bad commands are rejected with no write", async () => {
  const bad = [
    { kind: "user.add", name: "X", pin: "12" }, { kind: "user.add", name: "X", pin: "1234567" }, { kind: "user.add", name: "X", pin: "12ab" },
    { kind: "user.add", name: "", pin: "1234" }, { kind: "user.add", name: "Call 0400123456", pin: "1234" }, { kind: "user.add", name: "X" },
    { kind: "user.update", local_id: 4 }, { kind: "user.delete", local_id: "4" }, { kind: "user.delete", local_id: -1 },
    { kind: "user.enable", local_id: 4, enabled: "yes" }, { kind: "schedule.add", name: "S", days: [], open_time: "09:00", close_time: "10:00" },
    { kind: "schedule.add", name: "S", days: [9], open_time: "09:00", close_time: "10:00" }, { kind: "schedule.add", name: "S", days: [1], open_time: "9am", close_time: "10:00" },
    { kind: "schedule.add", name: "S", days: [1], open_time: "10:00", close_time: "10:00" }, { kind: "person.add", name: "P", phone: "call me" },
    { kind: "user.add", name: "X", pin: "1234", schedule_type: "Bad Type" }, { kind: "drop.tables" },
    { kind: "user.add", name: "X", pin: "0123" }, { kind: "user.add", name: "X", pin: "1234", schedule_type: "business_hours" },
    { kind: "user.update", local_id: 4, schedule_type: "time_range", schedule_days: [1], schedule_start: "08:00", schedule_end: "08:00" },
    { kind: "user.update", local_id: 4, schedule_type: "time_range", schedule_days: [], schedule_start: "08:00", schedule_end: "09:00" },
    { kind: "gate.hold" }, { kind: "gate.lockdown", on: "yes" },
  ];
  for (const b of bad) {
    const { post, calls } = await as("owner@example.test");
    const r = await post({ ...b, clientKey: key() });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(writes(calls).length, 0, JSON.stringify(b));
  }
  const { post, calls } = await as("owner@example.test");
  assert.equal((await post({ kind: "users.enable_all", enabled: true })).status, 400, "clientKey required");
  assert.equal(writes(calls).length, 0);
});

test("a PIN cannot be sent before the Pi has registered its key", async () => {
  const { post, calls } = await as("owner@example.test", { pubkey: null });
  const r = await post({ kind: "user.add", name: "Sam", pin: PIN, clientKey: key() });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /command key/);
  assert.equal(writes(calls).length, 0);
});

test("the same click twice queues once (idempotent client key)", async () => {
  const k = key();
  const { post, calls } = await as("owner@example.test", { existing: [{ id: "first", kind: "users.enable_all", status: "pending" }] });
  const body = await (await post({ kind: "users.enable_all", enabled: false, clientKey: k })).json();
  assert.equal(body.duplicate, true);
  assert.equal(body.command.id, "first");
  assert.equal(writes(calls).length, 0, "no second insert, no second audit row");
});

test("model: secrets are split out of args", () => {
  const c = model.mirrorCommandInput({ kind: "person.add", name: "A", phone: "0400 111 222", pin: "4321", clientKey: key() });
  assert.deepEqual(c.args, { name: "A", role: "" });
  assert.deepEqual(c.secrets, { phone: "0400 111 222", pin: "4321" });
  assert.ok(!JSON.stringify([c.args, c.summary]).includes("4321"));
});

test("Open Gate / Lockdown are refused unless the Pi advertises them", async () => {
  for (const b of [{ kind: "gate.open" }, { kind: "gate.lockdown", on: true }]) {
    const { post, calls } = await as("owner@example.test");
    const r = await post({ ...b, clientKey: key() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /not enabled on the Mildura Pi/);
    assert.equal(writes(calls).length, 0);
  }
});

test("Open Gate queues one short-lived command; Lockdown carries on/off; both audited", async () => {
  const caps = ["users", "gate.open", "gate.lockdown"];
  let s = await as("owner@example.test", { caps });
  const t0 = Date.now();
  assert.equal((await s.post({ kind: "gate.open", clientKey: key() })).status, 200);
  const row = JSON.parse(s.calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_commands")).body);
  assert.deepEqual(row.args, {});
  assert.equal(row.sealed, null);
  const ttl = Date.parse(row.expires_at) - t0;
  assert.ok(ttl > 60_000 && ttl <= 91_000, `open expires in ~90 s (got ${ttl})`);
  assert.equal(JSON.parse(s.calls.find((c) => c.path.endsWith("/gd_mirror_changes")).body).action, "portal.gate.open");
  s = await as("owner@example.test", { caps });
  assert.equal((await s.post({ kind: "gate.lockdown", on: true, clientKey: key() })).status, 200);
  const lrow = JSON.parse(s.calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_mirror_commands")).body);
  assert.deepEqual(lrow.args, { on: true });
  assert.equal(lrow.expires_at, undefined, "lockdown uses the normal 15 min expiry");
  const g = await (await s.get()).json();
  assert.equal(g.gate.open, true); assert.equal(g.gate.lockdown, true); assert.equal(g.gate.hold, false);
  s = await as("owner@example.test", { caps, unlocked: false });
  assert.equal((await s.post({ kind: "gate.open", clientKey: key() })).status, 403, "admin unlock still required");
});
