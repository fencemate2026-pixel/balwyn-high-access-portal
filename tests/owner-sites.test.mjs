// Owner sites (GSM gate diallers), 30 Oct 2026: only the verified Magic Keys owner
// can see or change another site's whitelist; every write is validated, stamped
// with who did it and scoped to the site being viewed.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const model = await vite.ssrLoadModule("/lib/owner-sites-model.ts");
const route = await vite.ssrLoadModule("/app/api/owner/sites/route.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SITE = { id: "11111111-1111-4111-8111-111111111111", slug: "thomastown", name: "Thomastown Body Corp", config_version: 7 };
const UNIT_ID = "22222222-2222-4222-8222-222222222222";

/** Fake Supabase REST behind supabaseFetch (the fixture routes it to env.fetchDatabase). */
function fakeSupabase() {
  const calls = [];
  env.fetchDatabase = async (path, init = {}) => {
    const u = new URL(String(path), "https://example.supabase.co");
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: decodeURIComponent(u.search), body: init.body ? JSON.parse(init.body) : null });
    const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/gd_sites") && u.search.includes("slug=eq.thomastown")) return json([SITE]);
    if (u.pathname.endsWith("/gd_sites") && init.method === "PATCH") return json(u.search.includes("config_version=eq.7") ? [SITE] : []);
    if (u.pathname.endsWith("/gd_sites")) return json([{ ...SITE, gd_units: [] }]);
    if (u.pathname.endsWith("/gd_units") && u.search.includes(`id=eq.${UNIT_ID}`)) return json([{ id: UNIT_ID }]);
    if (u.pathname.endsWith("/gd_units") && /[?&]id=eq\./.test(u.search)) return json([]); // unit not in this site
    if (u.pathname.endsWith("/gd_units")) return json([{ id: UNIT_ID, name: "Swing", secret_hash: "a".repeat(64) }]);
    if (init.method && init.method !== "GET") return json([{ id: "x" }]);
    return json([]);
  };
  return calls;
}

async function setup(t, { email = "owner@example.test", role = "administrator" } = {}) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: `owner@example.test|administrator,staff@example.test|administrator,viewer@example.test|viewer`,
    PORTAL_OWNER_EMAIL: "owner@example.test",
  });
  const calls = fakeSupabase();
  const cookie = (await auth.createSessionCookie({ displayName: "Jarrod", email, role })).split(";")[0];
  const get = (q = "") => route.GET(new Request(`${origin}/api/owner/sites${q}`, { headers: { Cookie: cookie } }));
  const post = (body, extra = {}) => route.POST(new Request(`${origin}/api/owner/sites`, {
    method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie, ...extra },
    body: JSON.stringify(body),
  }));
  return { get, post, calls };
}

test("phone numbers normalise exactly like the gate unit", () => {
  assert.equal(model.normaliseAu("0400 101 132"), "+61400101132");
  assert.equal(model.normaliseAu("+61 400 101 132"), "+61400101132");
  assert.equal(model.normaliseAu("400101132"), "+61400101132");
  assert.equal(model.normaliseAu("12345"), null);
  assert.equal(model.localAu("+61400101132"), "0400 101 132");
});

test("schedule input is validated before it reaches a gate", () => {
  const ok = model.scheduleInput({ name: "Weekend", openTime: "09:55", closeTime: "01:30", spanDays: 3, days: [5] });
  assert.deepEqual(ok.days, [5]);
  assert.throws(() => model.scheduleInput({ name: "x", openTime: "06:00", closeTime: "06:00", days: [1] }), /same/);
  assert.throws(() => model.scheduleInput({ name: "x", openTime: "6am", closeTime: "18:00", days: [1] }), /HH:MM/);
  assert.throws(() => model.scheduleInput({ name: "x", openTime: "06:00", closeTime: "18:00", days: [] }), /day/);
  assert.throws(() => model.unitInput({ deviceKeyFingerprint: "abc" }), /64/);
});

test("school staff and school administrators cannot see owner sites", async (t) => {
  for (const email of ["staff@example.test", "viewer@example.test"]) {
    const { get, post, calls } = await setup(t, { email, role: email.startsWith("viewer") ? "viewer" : "administrator" });
    assert.equal((await get()).status, 404, email);
    assert.equal((await post({ action: "whitelist.add", site: "thomastown", name: "X", phone: "0400000000" })).status, 404, email);
    assert.equal(calls.length, 0, "no database call is made for a non-owner");
  }
});

test("the owner lists sites and the key hash never reaches the browser", async (t) => {
  const { get } = await setup(t);
  const list = await get();
  assert.equal(list.status, 200);
  assert.equal((await list.json()).sites[0].slug, "thomastown");
  const detail = await (await get("?site=thomastown")).json();
  assert.equal(detail.units[0].has_device_key, true);
  assert.equal("secret_hash" in detail.units[0], false);
});

test("a cross-site request is refused before any change", async (t) => {
  const { post, calls } = await setup(t);
  const res = await post({ action: "whitelist.add", site: "thomastown", name: "X", phone: "0400000000" }, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("adding a number stamps the owner and who authorised it, scoped to the site", async (t) => {
  const { post, calls } = await setup(t);
  const res = await post({ action: "whitelist.add", site: "thomastown", name: "Jane", phone: "0411 222 333", unitLabel: "Unit 9", authorisedBy: "OC Manager" });
  assert.equal(res.status, 200);
  const insert = calls.find((c) => c.method === "POST" && c.path.endsWith("/gd_whitelist"));
  assert.deepEqual(insert.body, { name: "Jane", phone_e164: "+61411222333", unit_label: "Unit 9", site_id: SITE.id, last_actor: "owner@example.test", last_authorised_by: "OC Manager" });
  assert.ok(insert.path.startsWith("/rest/v1/"), "goes through the portal's server-side supabaseFetch");
});

test("delete stamps first, then deletes, only within the site", async (t) => {
  const { post, calls } = await setup(t);
  const id = "33333333-3333-4333-8333-333333333333";
  assert.equal((await post({ action: "whitelist.delete", site: "thomastown", id })).status, 200);
  const writes = calls.filter((c) => c.path.endsWith("/gd_whitelist") && c.method !== "GET");
  assert.deepEqual(writes.map((c) => c.method), ["PATCH", "DELETE"]);
  for (const w of writes) assert.match(w.search, new RegExp(`id=eq.${id}&site_id=eq.${SITE.id}`));
});

test("a schedule for a unit outside the site is refused", async (t) => {
  const { post } = await setup(t);
  const res = await post({ action: "schedule.save", site: "thomastown", unitId: "44444444-4444-4444-8444-444444444444", name: "Daily", openTime: "06:00", closeTime: "18:00", days: [1] });
  assert.equal(res.status, 400);
});

test("a bad phone number is refused with a plain message", async (t) => {
  const { post, calls } = await setup(t);
  const res = await post({ action: "whitelist.add", site: "thomastown", name: "X", phone: "123" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Australian/);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("confirming a large removal is optimistic on the version seen", async (t) => {
  const { post } = await setup(t);
  assert.equal((await post({ action: "site.ackShrink", site: "thomastown", seenVersion: 7 })).status, 200);
  assert.equal((await post({ action: "site.ackShrink", site: "thomastown", seenVersion: 6 })).status, 400);
});
