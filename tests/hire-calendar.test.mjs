// Facility hire API: the calendar gets exactly the dates it shows, and hirer
// contact details are only given to operators and administrators.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const hire = await vite.ssrLoadModule("/app/api/hire/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

async function setup(t, role) {
  const { pg, fetchDatabase } = await databaseFixture(t);
  // Apply the production hire migration as the owner, then drop back to the app role.
  await pg.exec("RESET ROLE; SET search_path = public;");
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260921103400_hire_bookings_balwyn_portal.sql", import.meta.url), "utf8"));
  await pg.exec("SET ROLE balwyn_app; SET search_path = balwyn_portal, pg_catalog;");
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: `op@example.test|${role}` });
  env.fetchDatabase = fetchDatabase;
  const user = { displayName: "Op", email: "op@example.test", role };
  const cookie = (await auth.createSessionCookie(user)).split(";")[0];
  const post = (body) => hire.POST(new Request(`${origin}/api/hire`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  const get = (query = "") => hire.GET(new Request(`${origin}/api/hire${query}`, { headers: { Cookie: cookie } }));
  return { post, get };
}

const booking = (date, name) => ({ fullName: name, email: `${name.split(" ")[0].toLowerCase()}@example.org`, phone: "0400 000 000", area: "tony-frizza-stadium", date, startTime: "18:00", endTime: "21:00", depositLeft: false, depositAmount: 0, comment: "" });

test("calendar reads return only the requested dates, with contact details for operators", async (t) => {
  const { post, get } = await setup(t, "operator");
  for (const [date, name] of [["2026-09-22", "Basketball Club"], ["2026-10-14", "Netball Club"], ["2026-12-01", "Late Club"]]) {
    const saved = await post(booking(date, name));
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  }
  const response = await get("?from=2026-09-21&to=2026-10-31");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.visits.map((v) => String(v.occurs_on).slice(0, 10)).sort(), ["2026-09-22", "2026-10-14"]);
  assert.equal(body.visits[0].phone, "0400 000 000");
  assert.ok(body.visits[0].email);
  assert.equal(body.areas.length, 5);
});

test("viewers see bookings but never hirer email or phone", async (t) => {
  const { get } = await setup(t, "viewer");
  const response = await get("?from=2026-09-01&to=2026-09-30");
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const visit of body.visits) { assert.equal("email" in visit, false); assert.equal("phone" in visit, false); }
});

test("malformed or reversed date windows are refused", async (t) => {
  const { get } = await setup(t, "operator");
  assert.equal((await get("?from=24-09-2026")).status, 400);
  assert.equal((await get("?from=2026-10-01&to=2026-09-01")).status, 400);
});

test("impossible dates and times are refused before reaching the database, with plain messages", async (t) => {
  const { post } = await setup(t, "operator");
  for (const [change, message] of [
    [{ date: "2026-02-30" }, /hire date/], [{ date: "2099-01-01" }, /two years ahead/], [{ startTime: "25:00" }, /start and end times/],
    [{ endTime: "21:61" }, /start and end times/], [{ depositLeft: true, depositAmount: 1e9 }, /deposit amount/], [{ depositLeft: true, depositAmount: 10.005 }, /deposit amount/],
  ]) {
    const response = await post({ ...booking("2026-11-20", "Edge Case"), ...change });
    assert.equal(response.status, 400, JSON.stringify(change));
    const body = await response.json();
    assert.match(body.error, message);
    assert.doesNotMatch(body.error, /balwyn_portal|syntax|relation|column|invalid input/i);
  }
});

test("deposits in dollars and cents save exactly, including amounts like $19.99", async (t) => {
  const { post } = await setup(t, "operator");
  for (const [amount, date] of [[19.99, "2026-11-21"], [4.35, "2026-11-22"], [0.29, "2026-11-23"], [150, "2026-11-24"]]) {
    const response = await post({ ...booking(date, `Deposit ${amount}`), depositLeft: true, depositAmount: amount });
    assert.equal(response.status, 200, `${amount}: ${JSON.stringify(await response.clone().json())}`);
  }
});

test("operators can book without gates, but a booking that opens gates needs an administrator", async (t) => {
  const { post } = await setup(t, "operator");
  const withGates = await post({ ...booking("2026-11-25", "Gate Club"), gateIds: ["TF-ENTRY"], leadMinutes: 120, lagMinutes: 120 });
  assert.equal(withGates.status, 403);
  assert.equal((await withGates.json()).code, "administrator_required");
  assert.equal((await post({ ...booking("2026-11-25", "Gate Club"), gateIds: [] })).status, 200);
  assert.equal((await post(booking("2026-11-26", "Default Club"))).status, 200, "no gates unless explicitly ticked");
});


test("an administrator saves a booking that opens gates without the settings password (30 Oct 2026)", async (t) => {
  // This session has NO settings unlock cookie: only the administrator sign-in.
  const { post, get } = await setup(t, "administrator");
  const saved = await post({ ...booking("2026-11-27", "Hire Club"), gateIds: ["TF-ENTRY"], leadMinutes: 15, lagMinutes: 15 });
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const body = await (await get("?from=2026-11-23&to=2026-11-29")).json();
  assert.equal(body.visits.length, 1);
});

test("viewers still cannot save any booking", async (t) => {
  const { post } = await setup(t, "viewer");
  const refused = await post({ ...booking("2026-11-28", "View Club"), gateIds: ["TF-ENTRY"] });
  assert.ok([401, 403].includes(refused.status), `viewer got ${refused.status}`);
});
