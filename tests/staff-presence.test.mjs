// Staff time-on-portal and button-press record (15 Oct 2026).
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
const presence = await vite.ssrLoadModule("/lib/staff-presence.ts");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const route = await vite.ssrLoadModule("/app/api/presence/route.ts");
const accountsRoute = await vite.ssrLoadModule("/app/api/accounts/route.ts");
const activityRoute = await vite.ssrLoadModule("/app/api/accounts/activity/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const alice = { displayName: "Alice Viewer", email: "alice@example.test", role: "viewer", accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const bob = { displayName: "Bob Viewer", email: "bob@example.test", role: "viewer", accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const at = (s) => new Date(Date.UTC(2026, 9, 15, 0, 0, 0) + s * 1000);

async function setup(t) {
  const { fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test" });
  env.fetchDatabase = fetchDatabase;
}

test("time is measured by the server from heartbeat gaps", async (t) => {
  await setup(t);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(0))).activeSeconds, 0);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(30))).activeSeconds, 30);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(60))).activeSeconds, 60);
  // 10 minutes away: the gap is idle, so no time is added.
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(660))).activeSeconds, 60);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(690))).activeSeconds, 90);
});

test("a gap of exactly 90 s counts, 91 s does not, and one beat never adds more than 60 s", async (t) => {
  await setup(t);
  await presence.recordHeartbeat(alice, { sessionId: S1 }, at(0));
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(90))).activeSeconds, 60);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(181))).activeSeconds, 60);
});

test("beats faster than 5 s are ignored, so time cannot be inflated", async (t) => {
  await setup(t);
  await presence.recordHeartbeat(alice, { sessionId: S1 }, at(0));
  for (let i = 1; i < 5; i++) assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1, events: [{ label: "spam" }] }, at(i))).counted, false);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(5))).activeSeconds, 5);
  const detail = await presence.staffDetail(presence.accountKeyFor(alice), alice.displayName);
  assert.equal(detail.presses.length, 0, "events from rejected beats are dropped");
});

test("a session id cannot be taken over by another account", async (t) => {
  await setup(t);
  await presence.recordHeartbeat(alice, { sessionId: S1 }, at(0));
  assert.equal((await presence.recordHeartbeat(bob, { sessionId: S1, events: [{ label: "x" }] }, at(30))).counted, false);
  assert.equal((await presence.recordHeartbeat(alice, { sessionId: S1 }, at(30))).activeSeconds, 30);
  assert.equal((await presence.staffDetail(presence.accountKeyFor(bob), bob.displayName)).presses.length, 0);
});

test("bad session ids are refused", async (t) => {
  await setup(t);
  for (const bad of ["", "nope", 5, null, "11111111-1111-4111-8111-11111111111Z"]) assert.equal((await presence.recordHeartbeat(alice, { sessionId: bad }, at(0))).counted, false);
});

test("button labels are cleaned, capped and limited per beat; nothing else is stored", async (t) => {
  await setup(t);
  assert.equal(presence.cleanLabel("  Open\n\tgate\u0000  "), "Open gate");
  assert.equal(presence.cleanLabel("x".repeat(500)).length, 120);
  assert.equal(presence.cleanLabel({}), "");
  await presence.recordHeartbeat(alice, { sessionId: S1 }, at(0));
  const events = Array.from({ length: 60 }, (_, i) => ({ label: `Button ${i}`, password: "secret-value" }));
  events.push({ label: "   " }, { label: 7 });
  const result = await presence.recordHeartbeat(alice, { sessionId: S1, events }, at(30));
  assert.equal(result.events, presence.MAX_EVENTS_PER_BEAT);
  const detail = await presence.staffDetail(presence.accountKeyFor(alice), alice.displayName);
  assert.equal(detail.presses.length, presence.MAX_EVENTS_PER_BEAT);
  assert.ok(!JSON.stringify(detail).includes("secret-value"));
});

test("usage summary totals visits and the last 7 days", async (t) => {
  await setup(t);
  const old = new Date(Date.UTC(2026, 9, 1));
  await presence.recordHeartbeat(alice, { sessionId: S1 }, old);
  await presence.recordHeartbeat(alice, { sessionId: S1 }, new Date(old.getTime() + 30000));
  await presence.recordHeartbeat(alice, { sessionId: S2 }, at(0));
  await presence.recordHeartbeat(alice, { sessionId: S2 }, at(45));
  const [row] = await presence.staffUsageSummary(at(60));
  assert.equal(row.account_key, alice.accountId);
  assert.equal(row.sessions, 2);
  assert.equal(row.total_seconds, 75);
  assert.equal(row.week_seconds, 45);
});

test("records older than 12 months are deleted when a new session starts", async (t) => {
  await setup(t);
  await presence.recordHeartbeat(alice, { sessionId: S1 }, new Date(Date.UTC(2025, 8, 1)));
  await presence.recordHeartbeat(bob, { sessionId: S2 }, at(0));
  assert.deepEqual((await presence.staffUsageSummary(at(1))).map((r) => r.account_key), [bob.accountId]);
});

test("the heartbeat route needs a signed-in session and a same-origin request", async (t) => {
  await setup(t);
  const post = (headers, body) => route.POST(new Request(`${origin}/api/presence`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  assert.equal((await post({}, { sessionId: S1 })).status, 401);
  assert.equal((await post({ Origin: "https://evil.example" }, { sessionId: S1 })).status, 403);
  const cookie = (await auth.createSessionCookie(alice, { provider: "password", subject: "x" })).split(";")[0];
  // The identity check reloads the account, so a cookie for an account that does not exist is refused too.
  assert.equal((await post({ Cookie: cookie }, { sessionId: S1 })).status, 401);
});

test("only administrators can read accounts usage and one person's activity", async (t) => {
  await setup(t);
  const get = (url, cookie) => url.GET(new Request(`${origin}${cookie.path}`, { headers: { Cookie: cookie.value } }));
  const created = await auth.createPortalAccount({ email: "Staff@Example.test", displayName: "Staff One", role: "viewer" }, "admin@example.test");
  await auth.setPasswordWithToken(created.token, "a-long-enough-test-password-1");
  const user = await auth.verifyAccountCredentials("staff@example.test", "a-long-enough-test-password-1");
  await presence.recordHeartbeat(user, { sessionId: S1 }, at(0));
  await presence.recordHeartbeat(user, { sessionId: S1, events: [{ label: "Open gate" }] }, at(30));
  const viewerCookie = (await auth.createSessionCookie(user, await auth.credentialIdentity(user))).split(";")[0];
  assert.equal((await get(accountsRoute, { value: viewerCookie, path: "/api/accounts" })).status, 403);
  assert.equal((await get(activityRoute, { value: viewerCookie, path: `/api/accounts/activity?id=${created.id}` })).status, 403);
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  env.GOOGLE_ALLOWED_EMAILS = "admin@example.test";
  const adminCookie = (await auth.createSessionCookie(admin, { provider: "google" })).split(";")[0];
  const list = await (await get(accountsRoute, { value: adminCookie, path: "/api/accounts" })).json();
  const row = list.accounts.find((a) => a.id === created.id);
  assert.equal(row.usage.total_seconds, 30);
  assert.equal(row.usage.sessions, 1);
  const detail = await (await get(activityRoute, { value: adminCookie, path: `/api/accounts/activity?id=${created.id}` })).json();
  assert.equal(detail.presses[0].label, "Open gate");
  assert.equal(detail.sessions[0].active_seconds, 30);
  assert.equal((await get(activityRoute, { value: adminCookie, path: "/api/accounts/activity?id=00000000-0000-4000-8000-000000000000" })).status, 404);
});
