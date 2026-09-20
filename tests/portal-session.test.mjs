import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
  plugins: [serverFixturePlugin],
});
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const { createSessionCookie, createAdminSettingsCookie, getSessionUser, requireOperator, assertSameOrigin, requestFingerprint } = await vite.ssrLoadModule("/lib/portal-auth.ts");
const { getPortalPlan, assertPlanAllowsModules, planAllowsModule, PlanUpgradeRequiredError } = await vite.ssrLoadModule("/lib/portal-plan.ts");
const { POST: portalPost } = await vite.ssrLoadModule("/app/api/portal/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const user = { displayName: "Test Operator", email: "operator@example.test", role: "administrator" };
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  env.PORTAL_SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  env.GOOGLE_ALLOWED_EMAILS = user.email;
});
function request(cookie, headers = {}, method = "POST", url = origin) {
  return new Request(`${url}/api/portal`, { method, headers: { Cookie: cookie, Origin: origin, "Sec-Fetch-Site": "same-origin", ...headers } });
}
async function sessionCookie() { return (await createSessionCookie(user)).split(";")[0]; }

test("Google operator sessions work without legacy password configuration", async () => {
  const cookie = await createSessionCookie(user);
  assert.match(cookie, /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.deepEqual(await getSessionUser(request(cookie.split(";")[0])), user);
});

test("removing an approved email immediately denies an existing session", async () => {
  const req = request(await sessionCookie());
  assert.equal((await requireOperator(req, "administrator")).response, null);
  env.GOOGLE_ALLOWED_EMAILS = "another-operator@example.test";
  assert.equal(await getSessionUser(req), null);
  const result = await requireOperator(req, "administrator");
  assert.equal(result.user, null);
  assert.equal(result.response.status, 401);
  env.GOOGLE_ALLOWED_EMAILS = "";
  assert.equal(await getSessionUser(req), null);
});

test("tampered, ambiguous and expired sessions are rejected", async (t) => {
  const cookie = await sessionCookie();
  assert.equal(await getSessionUser(request(`${cookie}.extra`)), null);
  assert.equal(await getSessionUser(request(`${cookie}; ${cookie}`)), null);
  const [name, signed] = cookie.split("=");
  const [payload, signature] = signed.split(".");
  const modified = Buffer.from(JSON.stringify({ user: { ...user, email: "attacker@example.test" }, expiresAt: Date.now() + 1000 })).toString("base64url");
  assert.equal(await getSessionUser(request(`${name}=${modified}.${signature}`)), null);
  assert.ok(await getSessionUser(request(`${name}=${payload}.${signature}`)));
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 8 * 60 * 60 * 1000 + 1000 });
  assert.equal(await getSessionUser(request(cookie)), null);
});

test("operator mutations require a POST from the exact HTTPS origin", () => {
  assert.equal(assertSameOrigin(request("")), true);
  for (const headers of [
    { Origin: "" }, { Origin: "null" }, { Origin: "http://magickeys-balwyn-portal.com" },
    { Origin: "https://attacker.example" }, { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": "none" },
  ]) assert.equal(assertSameOrigin(request("", headers)), false);
  assert.equal(assertSameOrigin(request("", {}, "GET")), false);
  assert.equal(assertSameOrigin(request("", { Origin: "http://magickeys-balwyn-portal.com" }, "POST", "http://magickeys-balwyn-portal.com")), false);
});

test("advanced features require an explicit hosted plan and lock again after downgrade", () => {
  for (const value of [undefined, "core", "premium", "true", "ADVANCED"]) {
    env.PORTAL_PLAN = value;
    assert.equal(getPortalPlan().advancedFeatures, false);
    assert.equal(planAllowsModule("video"), false);
    assert.equal(planAllowsModule("mobile"), true);
    assert.throws(() => assertPlanAllowsModules(["mobile", "video"]), PlanUpgradeRequiredError);
  }
  env.PORTAL_PLAN = "advanced";
  assert.equal(getPortalPlan().advancedFeatures, true);
  assert.doesNotThrow(() => assertPlanAllowsModules(["mobile", "video"]));
  env.PORTAL_PLAN = "core";
  assert.equal(planAllowsModule("video"), false);
});

test("an administrator cannot bypass the plan lock through the settings API", async () => {
  env.PORTAL_USERNAME = "test-admin";
  env.PORTAL_PASSWORD_HASH = "test-only-hash";
  env.PORTAL_PASSWORD_SALT = "test-only-salt";
  const baseCookie = await sessionCookie();
  const adminCookie = (await createAdminSettingsCookie(request(baseCookie))).cookie.split(";")[0];
  const req = new Request(`${origin}/api/portal`, {
    method: "POST",
    headers: { Cookie: `${baseCookie}; ${adminCookie}`, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update_settings", plan: "advanced", patch: { enabledModules: ["mobile", "video"], advancedFeatures: true } }),
  });
  const response = await portalPost(req);
  assert.equal(response.status, 402);
  assert.equal((await response.json()).code, "plan_upgrade_required");
  assert.equal(getPortalPlan().advancedFeatures, false);
});

test('configured viewer and operator roles are enforced and old-role sessions revoked', async () => {
  for (const role of ['viewer', 'operator', 'administrator']) {
    env.GOOGLE_ALLOWED_EMAILS = `${user.email}|${role}`;
    const cookie = (await createSessionCookie({ ...user, role })).split(';')[0];
    const req = request(cookie);
    assert.equal((await requireOperator(req, 'viewer')).response, null);
    assert.equal((await requireOperator(req, 'operator')).response?.status ?? 200, role === 'viewer' ? 403 : 200);
    assert.equal((await requireOperator(req, 'administrator')).response?.status ?? 200, role === 'administrator' ? 200 : 403);
    env.GOOGLE_ALLOWED_EMAILS = `${user.email}|${role === 'viewer' ? 'operator' : 'viewer'}`;
    assert.equal(await getSessionUser(req), null);
  }
});

test('Microsoft session role is checked against the current immutable assignment', async () => {
  const subject = '9188040d-6c67-4c5b-b112-36a304b66dad:00000000-1111-2222-3333-444444444444';
  env.MICROSOFT_ALLOWED_ACCOUNTS = `${subject}|viewer`;
  const cookie = (await createSessionCookie({ ...user, role: 'viewer' }, { provider: 'microsoft', subject })).split(';')[0];
  assert.equal((await requireOperator(request(cookie), 'operator')).response.status, 403);
  env.MICROSOFT_ALLOWED_ACCOUNTS = `${subject}|administrator`;
  assert.equal(await getSessionUser(request(cookie)), null);
});

test('site email restriction revokes every non-listed identity and confines owner access', async () => {
  env.PORTAL_ALLOWED_EMAILS = 'owner@example.test,school@example.test';
  env.PORTAL_OWNER_EMAIL = 'owner@example.test';
  env.GOOGLE_ALLOWED_EMAILS = 'owner@example.test|administrator,school@example.test|operator,removed@example.test|administrator';
  for (const [email, role, allowed, owner] of [
    ['owner@example.test', 'administrator', true, true],
    ['school@example.test', 'operator', true, false],
    ['removed@example.test', 'administrator', false, false],
  ]) {
    const cookie = (await createSessionCookie({ displayName: 'Test', email, role, isOwner: true })).split(';')[0];
    const session = await getSessionUser(request(cookie));
    assert.equal(Boolean(session), allowed);
    if (!allowed) continue;
    assert.equal(Boolean(session.isOwner), owner);
    assert.equal(getPortalPlan(session).advancedFeatures, owner);
    if (owner) assert.doesNotThrow(() => assertPlanAllowsModules(['video'], session));
    else {
      assert.throws(() => assertPlanAllowsModules(['video'], session), PlanUpgradeRequiredError);
      assert.equal((await requireOperator(request(cookie), 'administrator')).response.status, 403);
    }
  }
  const subject = '9188040d-6c67-4c5b-b112-36a304b66dad:00000000-1111-2222-3333-444444444444';
  env.MICROSOFT_ALLOWED_ACCOUNTS = `${subject}|administrator`;
  const cookie = (await createSessionCookie({ ...user, email: 'owner@example.test', isOwner: true }, { provider: 'microsoft', subject })).split(';')[0];
  assert.equal(Boolean((await getSessionUser(request(cookie))).isOwner), false);
  assert.equal(getPortalPlan(await getSessionUser(request(cookie))).advancedFeatures, false);
});

test('request fingerprints use the Render edge client address and ignore retired host headers', async () => {
  const make = headers => new Request(origin, { headers: { 'user-agent': 'test-browser', ...headers } });
  const first = await requestFingerprint(make({ 'cf-connecting-ip': '192.0.2.1' }));
  const second = await requestFingerprint(make({ 'cf-connecting-ip': '192.0.2.2' }));
  assert.notEqual(first, second);
  assert.equal(first, await requestFingerprint(make({ 'cf-connecting-ip': '192.0.2.1', 'x-nf-client-connection-ip': '203.0.113.2' })));
});
