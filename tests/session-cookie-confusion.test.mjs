// Audit 24 Oct 2026 (SEC-1): the MFA challenge cookie, issued after the password
// step only, was signed with the same key as the session cookie and had no
// identity field, so getSessionUser read it as a Google session. A person whose
// email was also on the Google list could skip the authenticator code.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { passwordHash } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const origin = "https://magickeys-balwyn-portal.com";

async function configure() {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    PORTAL_USERNAME: "Site Admin", PORTAL_PASSWORD_SALT: "salt-1",
    PORTAL_PASSWORD_HASH: await passwordHash("correct horse battery", "salt-1"),
    PORTAL_OPERATOR_EMAIL: "admin@example.test", PORTAL_ROLE: "administrator",
    GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator",
  });
}

test("an MFA challenge cookie is never accepted as a session", async () => {
  await configure();
  const user = { displayName: "Site Admin", email: "admin@example.test", role: "administrator" };
  const mfa = await auth.createMfaChallengeCookie(user, "fp");
  const value = mfa.split(";")[0].slice("balwyn_operator_mfa=".length);
  const replay = new Request(`${origin}/api/portal`, { headers: { Cookie: `balwyn_operator_session=${value}` } });
  assert.equal(await auth.getSessionUser(replay), null, "the password-only challenge was accepted as a full session");
  // The challenge itself still works where it belongs.
  const own = new Request(`${origin}/api/auth/mfa`, { headers: { Cookie: `balwyn_operator_mfa=${value}` } });
  assert.equal((await auth.getMfaChallenge(own))?.user.displayName, "Site Admin");
});

test("a real Google session cookie is still accepted", async () => {
  await configure();
  const cookie = (await auth.createSessionCookie({ displayName: "Admin", email: "admin@example.test", role: "administrator" })).split(";")[0];
  const request = new Request(`${origin}/api/portal`, { headers: { Cookie: cookie } });
  assert.equal((await auth.getSessionUser(request))?.role, "administrator");
});
