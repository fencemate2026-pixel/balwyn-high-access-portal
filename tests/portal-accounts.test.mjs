// Per-person email + password accounts (24 Sep 2026).
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
const emailRoute = await vite.ssrLoadModule("/app/api/auth/email/route.ts");
const providers = await vite.ssrLoadModule("/app/api/auth/providers/route.ts");
const setupRoute = await vite.ssrLoadModule("/app/api/auth/setup-password/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

async function setup(t) {
  const { fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  // No site (Render/Azure) password accounts: only per-person accounts exist.
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test" });
  env.fetchDatabase = fetchDatabase;
}
const signIn = (email, password) => emailRoute.POST(new Request(`${origin}/api/auth/email`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
}));
const setPassword = (token, password) => setupRoute.POST(new Request(`${origin}/api/auth/setup-password`, {
  method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
  body: JSON.stringify({ token, password }),
}));
const cookieFrom = (response) => response.headers.getSetCookie().find((c) => c.startsWith("balwyn_operator_session="))?.split(";")[0];
const asRequest = (cookie) => new Request(`${origin}/api/portal`, { headers: { Cookie: cookie } });

test("an administrator-created viewer sets a password once and signs in without a code", async (t) => {
  await setup(t);
  assert.equal((await (await providers.GET()).json()).email, false, "no accounts yet: email form hidden");
  const created = await auth.createPortalAccount({ email: "Office.Staff@Example.test", displayName: "Office Staff", role: "viewer" }, "admin@example.test");
  assert.equal((await (await providers.GET()).json()).email, true, "an account exists: email form shown");

  assert.equal((await setPassword(created.token, "short")).status, 400, "short passwords refused");
  assert.equal((await setPassword(created.token, "correct horse battery 7")).status, 200);
  assert.equal((await setPassword(created.token, "another password 12345")).status, 400, "setup link works only once");

  assert.equal((await signIn("office.staff@example.test", "wrong password 000")).status, 401);
  assert.equal((await signIn("nobody@example.test", "correct horse battery 7")).status, 401);
  const response = await signIn("OFFICE.STAFF@example.test", "correct horse battery 7");
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.ok((await response.json()).snapshot, "viewer goes straight in");
  const session = cookieFrom(response);
  const user = await auth.getSessionUser(asRequest(session));
  assert.equal(user?.role, "viewer");
  assert.equal(user?.accountId, created.id);

  // Disabling the account ends the live session immediately.
  await auth.updatePortalAccount(created.id, { active: false });
  assert.equal(await auth.getSessionUser(asRequest(session)), null);
  assert.equal((await signIn("office.staff@example.test", "correct horse battery 7")).status, 401);
});

test("operators and administrators must also pass the authenticator step", async (t) => {
  await setup(t);
  for (const role of ["operator", "administrator"]) {
    const created = await auth.createPortalAccount({ email: `${role}@example.test`, displayName: `Test ${role}`, role }, "admin@example.test");
    assert.equal((await setPassword(created.token, "a long enough password 1")).status, 200);
    const response = await signIn(`${role}@example.test`, "a long enough password 1");
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const body = await response.json();
    assert.equal(body.requiresAuthenticator, true);
    assert.equal(body.snapshot, undefined, "no session before the code");
    assert.equal(cookieFrom(response), undefined, "no session cookie before the code");
    assert.ok(body.enrollment?.secret, "first sign-in shows the authenticator setup key");
  }
});

test("a new setup link revokes the old password and every session", async (t) => {
  await setup(t);
  const created = await auth.createPortalAccount({ email: "reset@example.test", displayName: "Reset Me", role: "viewer" }, "admin@example.test");
  await setPassword(created.token, "first password 123456");
  const session = cookieFrom(await signIn("reset@example.test", "first password 123456"));
  assert.ok(await auth.getSessionUser(asRequest(session)));
  const reset = await auth.resetPortalAccount(created.id);
  assert.equal(await auth.getSessionUser(asRequest(session)), null, "old session ended");
  assert.equal((await signIn("reset@example.test", "first password 123456")).status, 401, "old password refused");
  assert.equal((await setPassword(reset.token, "second password 654321")).status, 200);
  assert.equal((await signIn("reset@example.test", "second password 654321")).status, 200);
});

test("changing an account's role ends its sessions and duplicate emails are refused", async (t) => {
  await setup(t);
  const created = await auth.createPortalAccount({ email: "role@example.test", displayName: "Role Change", role: "viewer" }, "admin@example.test");
  await setPassword(created.token, "role change password 1");
  const session = cookieFrom(await signIn("role@example.test", "role change password 1"));
  await auth.updatePortalAccount(created.id, { role: "operator" });
  assert.equal(await auth.getSessionUser(asRequest(session)), null);
  await assert.rejects(auth.createPortalAccount({ email: "ROLE@example.test", displayName: "Duplicate", role: "viewer" }, "x"), /already exists/);
});

// Owner takeover guard (3 Nov 2026 audit). The owner is whoever signs in as an
// administrator with PORTAL_OWNER_EMAIL, so a school administrator must never be able to
// create, reset, demote or disable an account that carries that email.
test("only the owner can create or manage an account that carries the owner's email", async (t) => {
  await setup(t);
  env.PORTAL_OWNER_EMAIL = "Owner@Example.test";
  const input = { email: " owner@example.TEST ", displayName: "Not The Owner", role: "administrator" };

  // A school administrator (not the owner) cannot claim the owner's email, whatever its case or spacing.
  await assert.rejects(auth.createPortalAccount(input, "admin@example.test"), /owner/i);
  await assert.rejects(auth.createPortalAccount(input, "admin@example.test", false), /owner/i);

  // The owner can create their own per-person account.
  const ownerAccount = await auth.createPortalAccount(input, "owner@example.test", true);
  assert.ok(ownerAccount.id);

  // A school administrator cannot reset it (that would hand out a setup link and take the account over),
  // change its role, or disable it.
  await assert.rejects(auth.resetPortalAccount(ownerAccount.id), /owner/i);
  await assert.rejects(auth.updatePortalAccount(ownerAccount.id, { role: "viewer" }), /owner/i);
  await assert.rejects(auth.updatePortalAccount(ownerAccount.id, { active: false }), /owner/i);

  // The owner can manage it.
  assert.ok((await auth.resetPortalAccount(ownerAccount.id, true)).token);
  await auth.updatePortalAccount(ownerAccount.id, { active: true }, true);

  // Ordinary accounts are unaffected, and so is a site with no owner configured.
  assert.ok((await auth.createPortalAccount({ email: "staff@example.test", displayName: "Staff", role: "viewer" }, "admin@example.test")).id);
  delete env.PORTAL_OWNER_EMAIL;
  await assert.rejects(auth.createPortalAccount({ email: "staff@example.test", displayName: "Dup", role: "viewer" }, "x"), /already exists/);
});
