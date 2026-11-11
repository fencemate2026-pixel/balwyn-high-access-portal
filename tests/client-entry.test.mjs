import assert from "node:assert/strict";
import test from "node:test";
import { createClientEntryHandler } from "../lib/client-entry.ts";

const portal = "https://magickeys-balwyn-portal.com";
const request = (body, origin = "https://www.magickeys.com.au", extra = {}) => new Request(portal + "/api/auth/client-entry", {
  method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", "user-agent": "test-browser", "x-forwarded-for": "192.0.2.1", ...extra }, body,
});
const credentials = new URLSearchParams({ username: "test@example.invalid", password: "private-test-password" });

test("password entry uses existing authentication, preserves session cookie and redirects without tokens", async () => {
  let called = 0;
  const handler = createClientEntryHandler(async r => {
    called++;
    assert.equal(r.headers.get("origin"), portal);
    assert.equal(r.headers.get("sec-fetch-site"), "same-origin");
    assert.equal(r.headers.get("user-agent"), "test-browser");
    assert.equal(r.headers.get("x-forwarded-for"), "192.0.2.1");
    assert.deepEqual(await r.json(), { email: "test@example.invalid", password: "private-test-password" });
    return Response.json({ snapshot: { user: { role: "viewer" } } }, { headers: { "set-cookie": "existing_session=test; HttpOnly; Secure; SameSite=Strict; Path=/" } });
  }, () => { throw new Error("MFA must not be called"); });
  const r = await handler(request(credentials));
  assert.equal(called, 1); assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/client-login");
  assert.match(r.headers.get("set-cookie"), /existing_session=test/); assert.equal(await r.text(), "");
});

test("a Settlement Road login from the MagicKeys page opens that site and keeps the session cookie", async () => {
  const handler = createClientEntryHandler(async () => Response.json({ settlementSite: true }, { headers: { "set-cookie": "existing_session=settlement; HttpOnly; Secure; SameSite=Strict; Path=/" } }), () => { throw new Error("MFA must not be called"); });
  const r = await handler(request(credentials));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/settlement");
  assert.match(r.headers.get("set-cookie"), /existing_session=settlement/);
  assert.equal(await r.text(), "");
});

test("operator requires the existing authenticator challenge, with escaped enrollment and no password reflection", async () => {
  const handler = createClientEntryHandler(async () => Response.json({ requiresAuthenticator: true, enrollment: { secret: "TEST<KEY>", account: 'test"account' } }, { headers: { "set-cookie": "existing_mfa=challenge; HttpOnly; Secure; SameSite=Strict; Path=/" } }), async () => { throw new Error("not yet"); });
  const r = await handler(request(credentials)); const html = await r.text();
  assert.equal(r.status, 200); assert.match(html, /name="step" value="verify"/); assert.match(html, /TEST&lt;KEY&gt;/);
  assert.match(html, /test&quot;account/); assert.doesNotMatch(html, /private-test-password/); assert.match(r.headers.get("set-cookie"), /existing_mfa=challenge/);
  assert.equal(r.headers.get("cache-control"), "no-store"); assert.match(r.headers.get("content-security-policy"), /form-action 'self'/);
});

test("MFA verification preserves challenge cookie, both response cookies and the existing account checks", async () => {
  const handler = createClientEntryHandler(async () => { throw new Error("not password"); }, async r => {
    assert.equal(r.headers.get("cookie"), "existing_mfa=challenge"); assert.deepEqual(await r.json(), { code: "123456" });
    const headers = new Headers(); headers.append("Set-Cookie", "session=ready; HttpOnly; Secure; Path=/"); headers.append("Set-Cookie", "existing_mfa=; Max-Age=0; Path=/");
    return Response.json({ snapshot: {} }, { headers });
  });
  const r = await handler(request("step=verify&code=123456", portal, { cookie: "existing_mfa=challenge" }));
  assert.equal(r.status, 303); assert.equal(r.headers.getSetCookie().length, 2);
});

test("unapproved, absent and lookalike origins cannot call password authentication", async () => {
  let called = false;
  const handler = createClientEntryHandler(async () => { called = true; return Response.json({}); }, async () => Response.json({}));
  for (const origin of ["https://evil.example", "null", "", "https://www.magickeys.com.au.evil.example", "http://www.magickeys.com.au"]) assert.equal((await handler(request(credentials, origin))).status, 403);
  assert.equal(called, false);
});

test("marketing origin cannot submit an MFA verification", async () => {
  const handler = createClientEntryHandler(async () => { throw new Error("unexpected"); }, async () => { throw new Error("unexpected"); });
  assert.equal((await handler(request("step=verify&code=123456"))).status, 403);
});

test("HTTPS, content type and streamed size limits fail before authenticating", async () => {
  let called = false; const auth = async () => { called = true; return Response.json({}); };
  const handler = createClientEntryHandler(auth, auth);
  assert.equal((await handler(request(credentials, portal, { "x-forwarded-proto": "http" }))).status, 403);
  assert.equal((await handler(request(credentials, portal, { "content-type": "application/json" }))).status, 403);
  assert.equal((await handler(request("password=" + "x".repeat(9000)))).status, 400);
  assert.equal(called, false);
});

test("rate limiting is retained with Retry-After and no credential echo", async () => {
  const handler = createClientEntryHandler(async () => Response.json({ error: "Try again later." }, { status: 429, headers: { "Retry-After": "900" } }), async () => Response.json({}));
  const r = await handler(request(credentials)); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "900"); assert.doesNotMatch(await r.text(), /private-test-password/);
});

test("rejected and expired authenticator challenges never redirect to a signed-in workspace", async () => {
  const handler = createClientEntryHandler(async () => Response.json({}), async () => Response.json({ error: "Code rejected <test>" }, { status: 401 }));
  const r = await handler(request("step=verify&code=000000", portal)); const html = await r.text();
  assert.equal(r.status, 401); assert.equal(r.headers.get("location"), null); assert.match(html, /Code rejected &lt;test&gt;/); assert.match(html, /name="code"/);
});

test("an unavailable account service returns a safe retry page", async () => {
  const handler = createClientEntryHandler(async () => { throw new Error("private internal detail"); }, async () => Response.json({}));
  const r = await handler(request(credentials)); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /private internal detail|private-test-password/);
});
