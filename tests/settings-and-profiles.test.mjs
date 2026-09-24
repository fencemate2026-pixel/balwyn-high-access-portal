import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture, passwordHash } from "./auth-fixture.mjs";
import { reserveSignInAttempt } from "../lib/signin-rate-limit.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false },
  plugins: [serverFixturePlugin],
});
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const admin = await vite.ssrLoadModule("/app/api/auth/admin/route.ts");
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");
const profiles = await vite.ssrLoadModule("/app/api/profile/route.ts");
const photo = await vite.ssrLoadModule("/app/api/profile/photo/route.ts");
const imageRoute = await vite.ssrLoadModule("/app/api/profile/image/[id]/route.ts");
const email = await vite.ssrLoadModule("/app/api/auth/email/route.ts");
const emailVerify = await vite.ssrLoadModule("/app/api/auth/email/verify/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const user = { displayName: "Test Operator", email: "operator@example.test", role: "administrator" };
const password = "A-test-password-934!";
const hash = await passwordHash(password, "test-password-salt");
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: user.email,
    PORTAL_USERNAME: user.displayName, PORTAL_OPERATOR_EMAIL: user.email, PORTAL_PASSWORD_SALT: "test-password-salt", PORTAL_PASSWORD_HASH: hash });
});
function request(path, body, cookie = "", overrides = {}) {
  return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie, ...overrides }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture(t) {
  const { db, pg, fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  const cookie = (await auth.createSessionCookie(user)).split(";")[0];
  return { db, pg, cookie };
}
async function unlock(cookie) {
  const response = await admin.POST(request("/api/auth/admin", { password }, cookie));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return `${cookie}; ${response.headers.getSetCookie()[0].split(";")[0]}`;
}

test("sensitive configuration mutations reject a valid administrator session without password unlock", async (t) => {
  const { cookie } = await fixture(t);
  for (const action of ["add_automation", "toggle_automation", "delete_automation", "update_settings", "provision_controller", "reset_auth_lockouts"]) {
    const response = await portal.POST(request("/api/portal", { action }, cookie));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "admin_password_required");
  }
  assert.equal((await admin.POST(request("/api/auth/admin", { password: "wrong-password" }, cookie))).status, 403);
});

test("password unlock is session-bound, time-limited, tamper resistant and revoked by password rotation", async (t) => {
  const { cookie } = await fixture(t);
  const unlocked = await unlock(cookie);
  assert.ok(await auth.getAdminSettingsAccess(request("/api/auth/admin", undefined, unlocked)));
  const otherSession = (await auth.createSessionCookie(user)).split(";")[0];
  assert.equal(await auth.getAdminSettingsAccess(request("/api/auth/admin", undefined, unlocked.replace(cookie, otherSession))), null);
  assert.equal(await auth.getAdminSettingsAccess(request("/api/auth/admin", undefined, `${unlocked}.extra`)), null);
  env.PORTAL_PASSWORD_HASH = "rotated-hash";
  assert.equal(await auth.getAdminSettingsAccess(request("/api/auth/admin", undefined, unlocked)), null);
  env.PORTAL_PASSWORD_HASH = hash;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 600001 });
  assert.equal(await auth.getAdminSettingsAccess(request("/api/auth/admin", undefined, unlocked)), null);
});

test("non-administrators and cross-origin requests cannot unlock configuration even with a correct password", async (t) => {
  await fixture(t);
  env.GOOGLE_ALLOWED_EMAILS = `${user.email}|operator`;
  const cookie = (await auth.createSessionCookie({ ...user, role: "operator" })).split(";")[0];
  assert.equal((await admin.POST(request("/api/auth/admin", { password }, cookie))).status, 403);
  env.GOOGLE_ALLOWED_EMAILS = `${user.email}|administrator`;
  const adminCookie = (await auth.createSessionCookie(user)).split(";")[0];
  assert.equal((await admin.POST(request("/api/auth/admin", { password }, adminCookie, { Origin: "https://evil.example" }))).status, 403);
});

test("an unlocked administrator can persist settings and immediately lock them again", async (t) => {
  const { cookie, pg } = await fixture(t);
  assert.equal((await portal.GET(request("/api/portal", undefined, cookie))).status, 200);
  const unlocked = await unlock(cookie);
  const response = await portal.POST(request("/api/portal", { action: "update_settings", patch: { faultAlerts: false, voiceAnnouncements: false } }, unlocked));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).snapshot.settings.faultAlerts, false);
  assert.equal((await pg.query("SELECT voice_announcements FROM portal_settings WHERE id = 1")).rows[0].voice_announcements, 0);
  const locked = await admin.POST(request("/api/auth/admin", { action: "lock" }, unlocked));
  assert.equal(locked.status, 200);
  assert.match(locked.headers.getSetCookie()[0], /Max-Age=0$/);
  assert.equal((await portal.POST(request("/api/portal", { action: "update_settings", patch: { faultAlerts: true } }, cookie))).status, 403);
});

test("concurrent password attempts cannot exceed the database rate limit", async (t) => {
  const { db } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => reserveSignInAttempt(db, "test-rate-key", 8)));
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 8);
});

test("email sign-in requires the second factor, consumes codes once and preserves approval revocation", async (t) => {
  const { pg } = await fixture(t);
  const response = await email.POST(request("/api/auth/email", { email: user.email, password }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.requiresAuthenticator, true);
  assert.equal(response.headers.getSetCookie().some((value) => value.startsWith("balwyn_operator_session=")), false);
  const mfaCookie = response.headers.getSetCookie()[0].split(";")[0];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...body.enrollment.secret].map((value) => alphabet.indexOf(value).toString(2).padStart(5, "0")).join("");
  const secret = Uint8Array.from(bits.match(/.{8}/g).map((value) => parseInt(value, 2)));
  const counter = Math.floor(Date.now() / 30000);
  const input = new ArrayBuffer(8); new DataView(input).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  const offset = digest.at(-1) & 15;
  const value = ((digest[offset] & 127) << 24) | (digest[offset+1] << 16) | (digest[offset+2] << 8) | digest[offset+3];
  const code = String(value % 1000000).padStart(6, "0");
  const verified = await emailVerify.POST(request("/api/auth/email/verify", { code }, mfaCookie));
  assert.equal(verified.status, 200, JSON.stringify(await verified.clone().json()));
  assert.equal((await emailVerify.POST(request("/api/auth/email/verify", { code }, mfaCookie))).status, 401);
  const cookie = verified.headers.getSetCookie().find((value) => value.startsWith("balwyn_operator_session=")).split(";")[0];
  assert.equal((await auth.getSessionUser(request("/api/portal", undefined, cookie))).role, "administrator");
  const profile = (await (await profiles.GET(request("/api/profile", undefined, cookie))).json()).profile;
  assert.equal((await profiles.POST(request("/api/profile", { ...profile, username: "custom.operator" }, cookie))).status, 200);
  assert.equal((await auth.verifyOperatorCredentials("custom.operator", password)).email, user.email);
  env.PORTAL_PASSWORD_HASH = "rotated-hash";
  assert.equal(await auth.getSessionUser(request("/api/portal", undefined, cookie)), null);
  assert.equal((await pg.query("SELECT last_used_counter FROM operator_totp")).rows[0].last_used_counter, counter);
});

test("own profiles persist; other users require password unlock; profile fields cannot grant permissions", async (t) => {
  const { cookie } = await fixture(t);
  const own = (await (await profiles.GET(request("/api/profile", undefined, cookie))).json()).profile;
  const input = { id: own.id, displayName: "Updated Name", username: "new.operator", contactEmail: "contact@example.test", phone: "+61 400 000 000", jobTitle: "Facilities", role: "administrator" };
  const saved = await profiles.POST(request("/api/profile", input, cookie));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).profile.username, "new.operator");
  assert.equal((await auth.getSessionUser(request("/api/portal", undefined, cookie))).email, user.email);
  env.GOOGLE_ALLOWED_EMAILS += ",second@example.test|operator";
  const secondCookie = (await auth.createSessionCookie({ displayName: "Second Operator", email: "second@example.test", role: "operator" })).split(";")[0];
  const second = (await (await profiles.GET(request("/api/profile", undefined, secondCookie))).json()).profile;
  assert.equal((await profiles.POST(request("/api/profile", { ...input, id: second.id }, cookie))).status, 403);
  assert.equal((await profiles.POST(request("/api/profile", input, secondCookie))).status, 403);
  const unlocked = await unlock(cookie);
  assert.equal((await profiles.POST(request("/api/profile", { ...input, id: second.id, username: "second.operator" }, unlocked))).status, 200);
  assert.equal((await auth.getSessionUser(request("/api/portal", undefined, secondCookie))).role, "operator");
  const duplicate = await profiles.POST(request("/api/profile", { ...input, id: second.id }, unlocked));
  assert.equal(duplicate.status, 409);
  assert.equal((await profiles.GET(request("/api/profile?scope=all", undefined, cookie))).status, 403);
  assert.equal((await (await profiles.GET(request("/api/profile?scope=all", undefined, unlocked))).json()).profiles.length, 2);
});

test("profile photos persist in object storage, require authentication and reject script uploads", async (t) => {
  const { cookie } = await fixture(t);
  const objects = new Map();
  env.BUCKET = { async put(key, bytes, options) { objects.set(key, { body: bytes, httpMetadata: options.httpMetadata }); }, async get(key) { return objects.get(key); }, async delete(key) { objects.delete(key); } };
  const own = (await (await profiles.GET(request("/api/profile", undefined, cookie))).json()).profile;
  const send = (bytes) => photo.POST(new Request(`${origin}/api/profile/photo?id=${own.id}`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "image/png" }, body: bytes }));
  assert.equal((await send("<svg onload='alert(1)' />")).status, 400);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=", "base64");
  const uploaded = await send(png);
  assert.equal(uploaded.status, 200);
  assert.equal(objects.size, 1);
  const path = (await uploaded.json()).profile.avatarUrl;
  const response = await imageRoute.GET(request(path, undefined, cookie), { params: Promise.resolve({ id: own.id }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal((await imageRoute.GET(request(path), { params: Promise.resolve({ id: own.id }) })).status, 401);
});

test("Microsoft sessions recheck immutable account approval instead of a matching email", async (t) => {
  await fixture(t);
  const subject = "9188040d-6c67-4c5b-b112-36a304b66dad:00000000-1111-2222-3333-444444444444";
  env.MICROSOFT_ALLOWED_ACCOUNTS = subject;
  const cookie = (await auth.createSessionCookie(user, { provider: "microsoft", subject })).split(";")[0];
  assert.ok(await auth.getSessionUser(request("/api/portal", undefined, cookie)));
  env.MICROSOFT_ALLOWED_ACCOUNTS = "";
  assert.equal(await auth.getSessionUser(request("/api/portal", undefined, cookie)), null);
});

test('password roles flow through MFA and revoke pending challenges on role change', async t => {
  await fixture(t);
  for (const role of ['viewer', 'operator', 'administrator']) {
    env.PORTAL_ROLE = role;
    const account = await auth.verifyOperatorCredentials(user.email, password);
    assert.equal(account.role, role);
    const cookie = (await auth.createMfaChallengeCookie(account, 'test-fingerprint')).split(';')[0];
    assert.equal((await auth.getMfaChallenge(request('/api/auth/email/verify', undefined, cookie))).user.role, role);
    const identity = await auth.passwordSessionIdentity(account);
    const session = (await auth.createSessionCookie(account, identity)).split(';')[0];
    assert.equal((await auth.requireOperator(request('/api/portal', undefined, session), 'administrator')).response?.status ?? 200, role === 'administrator' ? 200 : 403);
    if (role !== 'administrator') assert.equal(await auth.verifyAdministratorPassword(password), false);
    env.PORTAL_ROLE = role === 'viewer' ? 'operator' : 'viewer';
    assert.equal(await auth.getMfaChallenge(request('/api/auth/email/verify', undefined, cookie)), null);
    assert.equal(await auth.getSessionUser(request('/api/portal', undefined, session)), null);
  }
});

test('password credentials and existing sessions cannot bypass the site email restriction', async t => {
  await fixture(t);
  env.PORTAL_ALLOWED_EMAILS = user.email;
  env.PORTAL_OWNER_EMAIL = user.email;
  const account = await auth.verifyOperatorCredentials(user.email, password);
  assert.equal(account.isOwner, true);
  const cookie = (await auth.createSessionCookie(account, await auth.passwordSessionIdentity(account))).split(';')[0];
  assert.equal((await auth.getSessionUser(request('/api/portal', undefined, cookie))).isOwner, true);
  env.PORTAL_ALLOWED_EMAILS = 'different@example.test';
  assert.equal(await auth.verifyOperatorCredentials(user.email, password), null);
  assert.equal(await auth.verifyOperatorCredentials(user.displayName, password), null);
  assert.equal(await auth.getSessionUser(request('/api/portal', undefined, cookie)), null);
});

test("schedules save with an operator session without password unlock, but reject viewers and cross-origin requests", async (t) => {
  const { pg } = await fixture(t);
  const week = Object.fromEntries(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => [day, { enabled: true, open: "06:00", close: "18:00" }]));
  env.GOOGLE_ALLOWED_EMAILS = `${user.email}|operator`;
  const cookie = (await auth.createSessionCookie({ ...user, role: "operator" })).split(";")[0];
  const body = { action: "save_schedule", gateId: "TF-ENTRY", week };
  const response = await portal.POST(request("/api/portal", body, cookie));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await pg.query("SELECT open_time FROM gate_schedules WHERE gate_id = 'TF-ENTRY' AND day = 'Monday'")).rows[0].open_time, "06:00");
  assert.equal((await portal.POST(request("/api/portal", body, cookie, { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await portal.POST(request("/api/portal", { ...body, week: { ...week, Monday: { enabled: true, open: "25:00", close: "26:00" } } }, cookie))).status, 400);
  env.GOOGLE_ALLOWED_EMAILS = `${user.email}|viewer`;
  const viewer = (await auth.createSessionCookie({ ...user, role: "viewer" })).split(";")[0];
  assert.equal((await portal.POST(request("/api/portal", body, viewer))).status, 403);
  assert.equal((await portal.POST(request("/api/portal", body))).status, 401);
});
