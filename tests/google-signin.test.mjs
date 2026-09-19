import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { authenticateGoogleSignIn, createGoogleSignInChallenge, isSameOriginSignInRequest } from "../lib/google-signin.ts";

const origin = "https://magickeys-balwyn-portal.com";
const settings = { clientId: "test-client.apps.googleusercontent.com", allowedEmails: new Set(["operator@example.test"]) };
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "test-google-key", alg: "RS256", use: "sig" };
const fetchKeys = async (url) => {
  assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
  return Response.json({ keys: [jwk] });
};

function request(cookie = "", headers = {}) {
  return new Request(`${origin}/api/auth/google`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Cookie: cookie, ...headers }, body: "{}" });
}

async function sign(payload, header = { alg: "RS256", kid: jwk.kid }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode(header)}.${encode(payload)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0004_puzzling_squirrel_girl.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...bindings) { return {
        async first() { return statement.get(...bindings) ?? null; },
        async run() { const result = statement.run(...bindings); return { success: true, meta: { changes: Number(result.changes) } }; },
      }; } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const challenge = await createGoogleSignInChallenge(db, request());
  const loginRequest = request(challenge.cookie.split(";")[0]);
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://accounts.google.com", aud: settings.clientId, sub: "test-operator-id", email: "operator@example.test", email_verified: true, name: "Test Operator", nonce: challenge.nonce, iat: now, exp: now + 3600 };
  const token = await sign(payload);
  const login = (overrides = {}, req = loginRequest, config = settings, fetcher = fetchKeys) => authenticateGoogleSignIn(db, req, { credential: token, state: challenge.state, ...overrides }, config, fetcher);
  return { sqlite, db, challenge, loginRequest, payload, token, login };
}

test("a valid Google-signed response and browser-bound challenge authenticate an approved operator", async (t) => {
  const f = await fixture(t);
  assert.match(f.challenge.cookie, /^__Host-balwyn_google_login=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/);
  assert.notEqual(f.challenge.state, f.challenge.nonce);
  assert.deepEqual(await f.login(), { displayName: "Test Operator", email: "operator@example.test", role: "administrator" });
});

test("racing copies of a response can authenticate only once; subsequent replay fails", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.login(), f.login()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await f.login(), null);
});

test("forged, missing, same-site and insecure origins cannot initiate or complete sign-in", async (t) => {
  const f = await fixture(t);
  const invalidHeaders = [
    { Origin: "" }, { Origin: "null" }, { Origin: "https://attacker.example" },
    { Origin: "http://magickeys-balwyn-portal.com" }, { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" }, { "Content-Type": "text/plain" },
  ];
  for (const headers of invalidHeaders) {
    const req = request(f.challenge.cookie.split(";")[0], headers);
    assert.equal(isSameOriginSignInRequest(req), false);
    assert.equal(await f.login({}, req), null);
    await assert.rejects(createGoogleSignInChallenge(f.db, req), /rejected/);
  }
  assert.equal(isSameOriginSignInRequest(new Request(`${origin}/api/auth/google`)), false);
  assert.ok(await f.login());
});

test("state, signed nonce and browser cookie must all belong to the same sign-in attempt", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.login({ state: undefined }), null);
  assert.equal(await f.login({ state: "A".repeat(43) }), null);
  assert.equal(await f.login({}, request()), null);
  assert.equal(await f.login({}, request(`__Host-balwyn_google_login=${"A".repeat(43)}`)), null);
  const otherBrowser = await createGoogleSignInChallenge(f.db, request());
  assert.equal(await f.login({}, request(otherBrowser.cookie.split(";")[0])), null);
  assert.equal(await f.login({ credential: await sign({ ...f.payload, nonce: otherBrowser.nonce }) }), null);
  assert.equal(await f.login({ credential: await sign({ ...f.payload, nonce: undefined }) }), null);
  assert.ok(await f.login());
});

test("expired login attempts cannot be used even while the Google token remains valid", async (t) => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE google_login_challenges SET expires_at = ?").run(Date.now() - 1);
  assert.equal(await f.login(), null);
});

test("wrong identity claims, clients, issuers, expiry and unauthorised accounts fail closed", async (t) => {
  const f = await fixture(t);
  const invalidClaims = [
    { iss: "https://attacker.example" }, { aud: "other-client.apps.googleusercontent.com" },
    { aud: [settings.clientId, "other-client"], azp: undefined }, { azp: "other-client" },
    { exp: Math.floor(Date.now() / 1000) - 1 }, { exp: "9999999999" },
    { iat: Math.floor(Date.now() / 1000) + 120 }, { iat: "1" },
    { email_verified: false }, { email_verified: "true" }, { email: "unapproved@example.test" },
    { email: 123 }, { sub: "" }, { sub: 123 },
  ];
  for (const claims of invalidClaims) assert.equal(await f.login({ credential: await sign({ ...f.payload, ...claims }) }), null, JSON.stringify(claims));
  assert.equal(await f.login({}, f.loginRequest, { ...settings, allowedEmails: new Set() }), null);
  assert.ok(await f.login());
});

test("invalid signatures, malformed tokens and non-RSA signing algorithms cannot authenticate", async (t) => {
  const f = await fixture(t);
  const parts = f.token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  const invalid = [parts.join("."), `${f.token}.extra`, "A".repeat(10_001), await sign(null), await sign([]), await sign(f.payload, { alg: "none", kid: jwk.kid }), await sign(f.payload, { alg: "HS256", kid: jwk.kid })];
  for (const credential of invalid) assert.equal(await f.login({ credential }), null);
  assert.ok(await f.login());
});

test("an unavailable Google key service never creates an authenticated user", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.login({}, f.loginRequest, settings, async () => new Response("Unavailable", { status: 503 })), /unavailable/);
  assert.ok(await f.login());
});

test('Google sign-in uses the configured role, not a role claimed by the browser', async t => {
  for (const role of ['viewer', 'operator', 'administrator']) {
    const f = await fixture(t);
    const result = await f.login({}, f.loginRequest, { ...settings, accountRoles: new Map([['operator@example.test', role]]) });
    assert.equal(result.role, role);
  }
  const f = await fixture(t);
  assert.equal(await f.login({}, f.loginRequest, { ...settings, accountRoles: new Map() }), null);
});
