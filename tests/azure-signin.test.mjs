// Azure (Easy Auth) sign-in bridge, 6 Nov 2026. Header values are built here to
// the documented X-MS-CLIENT-PRINCIPAL shape; they are NOT yet observed from the
// live Azure app (see deploy/azure/ENTRA-LOGINS.md).
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const azure = await vite.ssrLoadModule("/lib/azure-auth.ts");
const complete = await vite.ssrLoadModule("/app/api/auth/azure/complete/route.ts");
const emailRoute = await vite.ssrLoadModule("/app/api/auth/email/route.ts");
const providers = await vite.ssrLoadModule("/app/api/auth/providers/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const OWNER = "owner@example.test";

async function setup(t, extra = {}) {
  const { fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: `${OWNER}|administrator,ops@example.test|operator`,
    PORTAL_OWNER_EMAIL: OWNER, PORTAL_AZURE_AUTH: "on", AZURE_STAFF_IDP: "staffidp", ...extra,
  });
  env.fetchDatabase = fetchDatabase;
}
const nowSec = () => Math.floor(Date.now() / 1000);
function principal({ idp = "google", email, iat = nowSec(), verified = "true", name = "Test Person" }) {
  const claims = [{ typ: "email", val: email }, { typ: "iat", val: String(iat) }, { typ: "sub", val: "subject-1" }, { typ: "name", val: name }];
  if (verified !== null) claims.push({ typ: "email_verified", val: verified });
  const encoded = Buffer.from(JSON.stringify({ auth_typ: idp, claims })).toString("base64");
  return new Headers({ "x-ms-client-principal": encoded, "x-ms-client-principal-idp": idp });
}
const land = (headers) => complete.GET(new Request(`${origin}/api/auth/azure/complete`, { headers }));
const sessionOf = (response) => response.headers.getSetCookie().find((c) => c.startsWith("balwyn_operator_session="))?.split(";")[0];
const asRequest = (cookie) => new Request(`${origin}/api/portal`, { headers: { Cookie: cookie } });

test("nothing is read unless PORTAL_AZURE_AUTH is on", async (t) => {
  await setup(t, { PORTAL_AZURE_AUTH: "" });
  assert.deepEqual(azure.readAzureIdentity(principal({ email: OWNER })), { denied: "disabled" });
  const response = await land(principal({ email: OWNER }));
  assert.equal(response.headers.get("location"), "/login?signin=azure_failed");
  assert.equal(sessionOf(response), undefined);
  assert.equal((await (await providers.GET()).json()).azure, false);
});

test("the owner signs in with Google through Azure and gets the owner view; switching Azure off ends the session", async (t) => {
  await setup(t);
  const response = await land(principal({ email: "Owner@Example.test" }));
  assert.equal(response.headers.get("location"), "/login");
  const cookie = sessionOf(response);
  assert.ok(cookie);
  const user = await auth.getSessionUser(asRequest(cookie));
  assert.equal(user?.role, "administrator");
  assert.equal(user?.isOwner, true);
  assert.equal(await auth.getSessionAccountKey(asRequest(cookie)), `google:${OWNER}`);
  env.PORTAL_AZURE_AUTH = "off";
  assert.equal(await auth.getSessionUser(asRequest(cookie)), null, "rollback ends Azure sessions");
});

test("refused: stale login, unverified email, email not on the approved list, unknown provider, missing or forged headers", async (t) => {
  await setup(t);
  const denied = async (headers) => (await land(headers)).headers.get("location") === "/login?signin=azure_failed";
  assert.ok(await denied(principal({ email: OWNER, iat: nowSec() - 600 })), "login older than 3 minutes");
  assert.ok(await denied(principal({ email: OWNER, iat: nowSec() + 3600 })), "issue time in the future");
  assert.ok(await denied(principal({ email: OWNER, verified: "false" })), "Google says unverified");
  assert.ok(await denied(principal({ email: OWNER, verified: null })), "Google must state verification");
  assert.ok(await denied(principal({ email: "stranger@example.test" })), "not approved");
  assert.ok(await denied(principal({ idp: "aad", email: OWNER })), "other Microsoft tenants are not accepted");
  assert.ok(await denied(new Headers()), "no Azure headers");
  assert.ok(await denied(new Headers({ "x-ms-client-principal": "not-base64-json" })), "garbage header");
  assert.deepEqual(azure.readAzureIdentity(principal({ email: OWNER, iat: 12 })), { denied: "no_issue_time" });
});

test("Azure staff: invited view-only accounts sign in without a password setup link; changes end the session", async (t) => {
  await setup(t);
  const created = await auth.createPortalAccount({ email: "Office.Staff@Example.test", displayName: "Office Staff", role: "viewer", azureOnly: true }, OWNER, true);
  assert.equal(created.token, "");
  assert.equal((await emailRoute.POST(new Request(`${origin}/api/auth/email`, { method: "POST",
    headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "office.staff@example.test", password: "correct horse battery 7" }) }))).status, 401, "no password sign-in exists for an Azure-only account");
  assert.equal((await auth.listPortalAccounts()).find((a) => a.id === created.id)?.azure_only, true);

  const response = await land(principal({ idp: "staffidp", email: "office.staff@example.test", verified: null }));
  assert.equal(response.headers.get("location"), "/login");
  const cookie = sessionOf(response);
  const user = await auth.getSessionUser(asRequest(cookie));
  assert.equal(user?.role, "viewer");
  assert.equal(user?.isOwner, undefined);
  assert.equal(user?.accountId, created.id);

  await auth.updatePortalAccount(created.id, { active: false });
  assert.equal(await auth.getSessionUser(asRequest(cookie)), null, "disabling ends the session");
  await auth.updatePortalAccount(created.id, { active: true });
  assert.equal(await auth.getSessionUser(asRequest(cookie)), null, "re-enabling does not revive the old session");
});

test("Azure staff cannot be operators, administrators or the owner", async (t) => {
  await setup(t);
  await assert.rejects(() => auth.createPortalAccount({ email: "op@example.test", displayName: "Op", role: "operator", azureOnly: true }, OWNER, true), /view-only/);
  await auth.createPortalAccount({ email: "op@example.test", displayName: "Op", role: "operator" }, OWNER, true);
  assert.equal(sessionOf(await land(principal({ idp: "staffidp", email: "op@example.test", verified: null }))), undefined, "operator accounts stay on password + authenticator");
  // The owner's address through the staff provider is refused, whatever the database holds.
  assert.equal(sessionOf(await land(principal({ idp: "staffidp", email: OWNER, verified: null }))), undefined);
  // A non-owner administrator cannot create an account on the owner's email.
  await assert.rejects(() => auth.createPortalAccount({ email: OWNER, displayName: "X", role: "viewer", azureOnly: true }, "ops@example.test", false), /owner/);
  // No staff provider configured: the staff route is closed.
  env.AZURE_STAFF_IDP = "";
  await auth.createPortalAccount({ email: "v@example.test", displayName: "V", role: "viewer", azureOnly: true }, OWNER, true);
  assert.equal(sessionOf(await land(principal({ idp: "staffidp", email: "v@example.test", verified: null }))), undefined);
});
