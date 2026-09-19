import assert from "node:assert/strict";
import test from "node:test";
import { databaseFixture } from "./auth-fixture.mjs";
import { authenticateMicrosoftSignIn, createMicrosoftSignInChallenge } from "../lib/microsoft-signin.ts";

const origin = "https://magickeys-balwyn-portal.com";
const tenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
const oid = "00000000-1111-2222-3333-444444444444";
const settings = { clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "test-only-provider-secret", allowedAccounts: new Set([`${tenant}:${oid}`]) };
const keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", keyPair.publicKey), kid: "test-key", use: "sig", issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" };
const startRequest = (headers = {}) => new Request(`${origin}/api/auth/microsoft/start`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers } });
async function fixture(t, overrides = {}, header = { alg: "RS256", kid: jwk.kid }) {
  const { sqlite, db } = databaseFixture(t);
  const challenge = await createMicrosoftSignInChallenge(db, startRequest(), settings);
  const authorize = new URL(challenge.url);
  const cookie = challenge.cookie.split(";")[0];
  const now = Math.floor(Date.now() / 1000);
  const claims = { ver: "2.0", iss: `https://login.microsoftonline.com/${tenant}/v2.0`, tid: tenant, oid, sub: "stable-subject", aud: settings.clientId,
    nonce: authorize.searchParams.get("nonce"), iat: now, exp: now + 3600, email: "operator@hotmail.com", name: "Test Operator", ...overrides };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signed = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(unsigned));
  const idToken = `${unsigned}.${Buffer.from(signed).toString("base64url")}`;
  let exchanges = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith("/token")) {
      exchanges++;
      assert.equal(url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
      assert.equal(options.body.get("client_secret"), settings.clientSecret);
      assert.equal(options.body.get("redirect_uri"), `${origin}/api/auth/microsoft/callback`);
      const challengeHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(options.body.get("code_verifier")))).toString("base64url");
      assert.equal(challengeHash, authorize.searchParams.get("code_challenge"));
      return Response.json({ id_token: idToken });
    }
    assert.equal(url, "https://login.microsoftonline.com/common/discovery/v2.0/keys");
    return Response.json({ keys: [jwk] });
  };
  const callback = (query = "", browserCookie = cookie) => new Request(`${origin}/api/auth/microsoft/callback?state=${authorize.searchParams.get("state")}&code=test-code${query}`, { headers: { Cookie: browserCookie } });
  return { sqlite, db, challenge, authorize, cookie, callback, fetcher, exchanges: () => exchanges };
}

test("personal Hotmail OAuth uses PKCE and one browser-bound, single-use callback", async (t) => {
  const f = await fixture(t);
  assert.match(f.challenge.cookie, /HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.equal(f.authorize.searchParams.get("scope"), "openid profile email");
  assert.equal(f.authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(f.authorize.searchParams.has("client_secret"), false);
  const results = await Promise.all([authenticateMicrosoftSignIn(f.db, f.callback(), settings, f.fetcher), authenticateMicrosoftSignIn(f.db, f.callback(), settings, f.fetcher)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).user.email, "operator@hotmail.com");
  assert.equal(f.exchanges(), 1);
  assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback(), settings, f.fetcher), null);
});

test("wrong browser, duplicate state, expired and cancelled callbacks cannot create a session", async (t) => {
  const f = await fixture(t);
  assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback("", ""), settings, f.fetcher), null);
  assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback("&state=another"), settings, f.fetcher), null);
  assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback("&error=access_denied"), settings, f.fetcher), null);
  assert.equal(f.exchanges(), 0);
  const expired = await fixture(t);
  expired.sqlite.prepare("UPDATE microsoft_login_challenges SET expires_at = ?").run(Date.now() - 1);
  assert.equal(await authenticateMicrosoftSignIn(expired.db, expired.callback(), settings, expired.fetcher), null);
});

test("forged origins cannot begin Microsoft sign-in", async (t) => {
  const { db } = databaseFixture(t);
  for (const headers of [{ Origin: "https://evil.example" }, { Origin: "" }, { "Sec-Fetch-Site": "same-site" }]) {
    await assert.rejects(createMicrosoftSignInChallenge(db, startRequest(headers), settings), /rejected/);
  }
});

test("claims, tenant, audience, nonce, expiry and immutable approval are enforced", async (t) => {
  for (const overrides of [{ aud: "other" }, { iss: "https://evil.example" }, { nonce: "wrong" }, { exp: 1 }, { exp: "9999999999" },
    { tid: "invalid" }, { oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "operator@hotmail.com" }, { sub: "" }, { nbf: Math.floor(Date.now()/1000) + 300 }]) {
    const f = await fixture(t, overrides);
    assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback(), settings, f.fetcher), null, JSON.stringify(overrides));
  }
  const f = await fixture(t, {}, { alg: "none", kid: jwk.kid });
  assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback(), settings, f.fetcher), null);
});

test("a bad signature or signing key issuer and token exchange outage fail closed", async (t) => {
  for (const mode of ["signature", "issuer", "unavailable"]) {
    const f = await fixture(t);
    const fetcher = async (url, options) => {
      if (mode === "unavailable") return new Response("Unavailable", { status: 503 });
      const response = await f.fetcher(url, options);
      const body = await response.json();
      if (mode === "signature" && body.id_token) { const parts = body.id_token.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1); body.id_token = parts.join("."); }
      if (mode === "issuer" && body.keys) body.keys[0].issuer = "https://evil.example";
      return Response.json(body);
    };
    if (mode === "unavailable") await assert.rejects(authenticateMicrosoftSignIn(f.db, f.callback(), settings, fetcher));
    else assert.equal(await authenticateMicrosoftSignIn(f.db, f.callback(), settings, fetcher), null);
  }
});

test('Microsoft sign-in assigns roles by immutable tenant and object identity', async t => {
  for (const role of ['viewer', 'operator', 'administrator']) {
    const f = await fixture(t);
    const result = await authenticateMicrosoftSignIn(f.db, f.callback(), { ...settings, accountRoles: new Map([[`${tenant}:${oid}`, role]]) }, f.fetcher);
    assert.equal(result.user.role, role);
  }
});
