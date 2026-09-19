import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
  plugins: [{
    name: "test-worker-environment",
    resolveId(id) { if (id === "cloudflare:workers") return "\0test-worker-environment"; },
    load(id) { if (id === "\0test-worker-environment") return "export const env = {};"; },
  }],
});
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const { createSessionCookie, createAdminSettingsCookie, getSessionUser, requireOperator, assertSameOrigin } = await vite.ssrLoadModule("/lib/portal-auth.ts");
const { getPortalPlan, assertPlanAllowsModules, planAllowsModule, PlanUpgradeRequiredError } = await vite.ssrLoadModule("/lib/portal-plan.ts");
const { POST: portalPost } = await vite.ssrLoadModule("/app/api/portal/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const user = { displayName: "Test Operator", email: "operator@example.test", role: "administrator" };
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  env.PORTAL_SESSION_SECRET = "REDACTED";
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
  env.PORTAL_PASSWORD_HASH = "REDACTED";
  env.PORTAL_PASSWORD_SALT = "REDACTED";
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
