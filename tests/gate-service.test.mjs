// Gate cycle counter, service alerts, RJL alert outbox, action rate limit and
// the append-only activity log (10 Oct 2026). Runs the real migration in PGlite.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture, passwordHash } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const service = await vite.ssrLoadModule("/lib/gate-service.ts");
const alerts = await vite.ssrLoadModule("/lib/rjl-alerts.ts");
const limiter = await vite.ssrLoadModule("/lib/action-rate-limit.ts");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const admin = await vite.ssrLoadModule("/app/api/auth/admin/route.ts");
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");

const origin = "https://magickeys-balwyn-portal.com";
const user = { displayName: "Test Administrator", email: "admin@example.test", role: "administrator" };
const password = "A-test-password-934!";
const hash = await passwordHash(password, "test-password-salt");
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: user.email,
    PORTAL_USERNAME: user.displayName, PORTAL_OPERATOR_EMAIL: user.email, PORTAL_PASSWORD_SALT: "test-password-salt", PORTAL_PASSWORD_HASH: hash });
});
async function fixture(t) {
  const { pg, fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  return { pg };
}
const counter = async (pg, gateId) => (await pg.query("SELECT * FROM gate_service_counters WHERE gate_id = $1", [gateId])).rows[0];
const notifications = async (pg) => (await pg.query("SELECT kind, subject, body, delivery, error FROM rjl_notifications ORDER BY created_at, id")).rows;
const mailer = () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return Response.json({ id: "email-id" }); };
  return { sent, fetcher };
};
const runtime = { RESEND_API_KEY: "re_test_key" };

// ---------- Pure rules ----------
test("service rule: defaults, bounds and invalid settings", () => {
  assert.deepEqual(service.serviceRule({}), { operationLimit: 4000, intervalMonths: 6 });
  assert.deepEqual(service.serviceRule({ GATE_SERVICE_OPERATION_LIMIT: "5000", GATE_SERVICE_INTERVAL_MONTHS: "3" }), { operationLimit: 5000, intervalMonths: 3 });
  for (const bad of ["0", "-1", "abc", "40.5", "99", "1e9", ""]) assert.equal(service.serviceRule({ GATE_SERVICE_OPERATION_LIMIT: bad }).operationLimit, 4000);
  for (const bad of ["0", "25", "x"]) assert.equal(service.serviceRule({ GATE_SERVICE_INTERVAL_MONTHS: bad }).intervalMonths, 6);
});

test("addMonths clamps to the end of shorter months", () => {
  assert.equal(service.addMonths("2026-08-31T02:00:00.000Z", 6), "2027-02-28T02:00:00.000Z");
  assert.equal(service.addMonths("2027-08-31T02:00:00.000Z", 6), "2028-02-29T02:00:00.000Z");
  assert.equal(service.addMonths("2026-04-15T02:00:00.000Z", 6), "2026-10-15T02:00:00.000Z");
});

test("alert thresholds: 90 % early warning, 100 % service due", () => {
  assert.equal(service.alertLevelFor(3599, 4000), 0);
  assert.equal(service.alertLevelFor(3600, 4000), 1);
  assert.equal(service.alertLevelFor(3999, 4000), 1);
  assert.equal(service.alertLevelFor(4000, 4000), 2);
  assert.equal(service.alertLevelFor(9000, 4000), 2);
});

test("status: due by operations before the date, or by date", () => {
  const rule = { operationLimit: 4000, intervalMonths: 6 };
  const now = new Date("2026-10-10T00:00:00Z");
  const empty = service.gateServiceStatus(null, now, rule);
  assert.equal(empty.state, "ok"); assert.equal(empty.nextServiceAt, null); assert.equal(empty.operationsSinceService, 0);
  const early = service.gateServiceStatus({ total_operations: 9000, operations_since_service: 4000, last_service_at: "2026-09-01T02:00:00Z" }, now, rule);
  assert.equal(early.state, "due"); assert.equal(early.dueReason, "operations"); assert.equal(early.nextServiceAt, "2027-03-01T02:00:00.000Z");
  const byDate = service.gateServiceStatus({ total_operations: 10, operations_since_service: 10, last_service_at: "2026-03-01T02:00:00Z" }, now, rule);
  assert.equal(byDate.state, "due"); assert.equal(byDate.dueReason, "date");
  const soon = service.gateServiceStatus({ total_operations: 3700, operations_since_service: 3700, last_service_at: "2026-09-01T02:00:00Z" }, now, rule);
  assert.equal(soon.state, "soon"); assert.equal(soon.dueReason, null);
});

test("service dates: real calendar dates only, never in the future or before 2020", () => {
  const now = new Date("2026-10-10T03:00:00Z");
  assert.equal(service.parseServiceDate("2026-10-01", now), "2026-10-01T02:00:00.000Z");
  assert.equal(service.parseServiceDate(" 2026-10-10 ", now), "2026-10-10T02:00:00.000Z");
  assert.throws(() => service.parseServiceDate("2026-10-11", new Date("2026-10-10T03:00:00Z")), /future/, "tomorrow in Melbourne is the future");
  assert.equal(service.parseServiceDate("2026-10-11", new Date("2026-10-10T14:00:00Z")), "2026-10-11T02:00:00.000Z", "already 11 Oct in Melbourne");
  for (const bad of ["2026-02-30", "2026-13-01", "01/10/2026", "2026-10-1", "2019-12-31", "2026-10-12", "", null, 20261001, "2026-10-01T00:00:00Z", "2026-10-01'; DROP TABLE x;--"]) {
    assert.throws(() => service.parseServiceDate(bad, now), /Invalid service date/, String(bad));
  }
});

// ---------- Counting and alerts (database) ----------
test("each confirmed operation counts once; unknown and inactive gates are never counted", async (t) => {
  const { pg } = await fixture(t);
  for (let i = 0; i < 3; i++) await service.recordGateOperation("TF-ENTRY", { runtime: {} });
  const row = await counter(pg, "TF-ENTRY");
  assert.equal(row.total_operations, 3); assert.equal(row.operations_since_service, 3); assert.equal(row.alert_level, 0);
  assert.equal(await service.recordGateOperation("SCP-B01", { runtime: {} }), null);
  assert.equal(await service.recordGateOperation("NOT-A-GATE", { runtime: {} }), null);
  assert.equal(await service.recordGateOperation("__proto__", { runtime: {} }), null);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM gate_service_counters")).rows[0].n, 1);
  assert.deepEqual(await notifications(pg), []);
});

test("RJL is emailed once at 90 % and once at the limit when it comes before the scheduled date", async (t) => {
  const { pg } = await fixture(t);
  const { sent, fetcher } = mailer();
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true });
  await pg.query("UPDATE gate_service_counters SET operations_since_service = 3598, total_operations = 3598 WHERE gate_id = 'SIDE-ENTRY'");
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true }); // 3599: nothing
  assert.equal(sent.length, 0);
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true }); // 3600: early warning
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true }); // 3601: no repeat
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.subject, /approaching service/);
  assert.equal(sent[0].init.headers.Authorization, "Bearer re_test_key");
  assert.equal(sent[0].init.headers["Idempotency-Key"], "service-SIDE-ENTRY-unset-1");
  assert.deepEqual(sent[0].body.to, ["info@rjlcommercialgroup.com"]);
  assert.equal(sent[0].init.redirect, "error");
  await pg.query("UPDATE gate_service_counters SET operations_since_service = 3999 WHERE gate_id = 'SIDE-ENTRY'");
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true }); // 4000: service due
  await service.recordGateOperation("SIDE-ENTRY", { runtime, fetcher, waitForAlert: true }); // 4001: no repeat
  assert.equal(sent.length, 2);
  assert.match(sent[1].body.subject, /is due for service \(4,000 operations reached\)/);
  assert.match(sent[1].body.text, /portal, keypad \/ Compass reader, exit button and schedules\)\. Openings made while the controller was offline are not included/);
  assert.equal((await counter(pg, "SIDE-ENTRY")).alert_level, 2);
  const log = await notifications(pg);
  assert.deepEqual(log.map((n) => [n.kind, n.delivery]), [["service_warning", "sent"], ["service_due", "sent"]]);
});

test("no early-service email when the scheduled date has already passed (the date rule already applies)", async (t) => {
  const { pg } = await fixture(t);
  const { sent, fetcher } = mailer();
  const now = new Date("2026-10-10T00:00:00Z");
  await pg.query("INSERT INTO gate_service_counters (gate_id, total_operations, operations_since_service, last_service_at) VALUES ('TF-ENTRY', 3999, 3999, '2026-03-01T02:00:00Z')");
  const status = await service.recordGateOperation("TF-ENTRY", { runtime, fetcher, now, waitForAlert: true });
  assert.equal(status.state, "due"); assert.equal(status.dueReason, "date");
  assert.equal(sent.length, 0);
  assert.equal((await counter(pg, "TF-ENTRY")).alert_level, 0);
});

test("recording a service resets the count and alert, logs who did it, and re-arms alerts", async (t) => {
  const { pg } = await fixture(t);
  await pg.query("INSERT INTO gate_service_counters (gate_id, total_operations, operations_since_service, alert_level) VALUES ('TF-ENTRY', 5000, 4001, 2)");
  await service.recordGateService("TF-ENTRY", "2026-10-09T02:00:00.000Z", user);
  const row = await counter(pg, "TF-ENTRY");
  assert.equal(row.operations_since_service, 0); assert.equal(row.total_operations, 5000); assert.equal(row.alert_level, 0);
  assert.equal(new Date(row.last_service_at).toISOString(), "2026-10-09T02:00:00.000Z");
  const entry = (await pg.query("SELECT action, detail, category, actor_name FROM activity_log WHERE action = 'Gate service recorded'")).rows[0];
  assert.equal(entry.category, "maintenance"); assert.equal(entry.actor_name, user.displayName);
  assert.match(entry.detail, /Tony Frizza Stadium Entry: service completed 9 October 2026 recorded by Test Administrator\. Operations since last service reset to 0 \(was 4001\)\./);
  await assert.rejects(service.recordGateService("SCP-B01", "2026-10-09T02:00:00.000Z", user), /blocked for inactive or unknown gates/);
  await assert.rejects(service.recordGateService("NOPE", "2026-10-09T02:00:00.000Z", user), /blocked/);
});

test("counting never throws, even when the counter table is unavailable", async (t) => {
  const { pg } = await fixture(t);
  await pg.query("RESET ROLE"); await pg.query("REVOKE ALL ON balwyn_portal.gate_service_counters FROM balwyn_app"); await pg.query("SET ROLE balwyn_app");
  assert.equal(await service.recordGateOperation("TF-ENTRY", { runtime: {} }), null);
  assert.equal(await service.readGateService(), null);
});

// ---------- RJL alert outbox ----------
test("alerts are recorded first; without an email key nothing is sent and nothing breaks", async (t) => {
  const { pg } = await fixture(t);
  let calls = 0;
  const result = await alerts.sendRjlAlert({ kind: "help_flag", subject: "Subject\r\nBcc: attacker@example.test", body: "Line one\u0000\r\nLine two" }, { runtime: {}, fetcher: async () => { calls++; return Response.json({}); } });
  assert.equal(result, "not_configured");
  assert.equal(calls, 0);
  const [row] = await notifications(pg);
  assert.equal(row.delivery, "not_configured");
  assert.equal(row.subject, "Subject Bcc: attacker@example.test"); // one line: no header injection
  assert.equal(row.body, "Line one\nLine two");
});

test("provider failures and timeouts are recorded without leaking the provider message", async (t) => {
  const { pg } = await fixture(t);
  assert.equal(await alerts.sendRjlAlert({ kind: "service_due", subject: "A", body: "B" }, { runtime, fetcher: async () => new Response("leaked detail info@x.test", { status: 500 }) }), "failed");
  assert.equal(await alerts.sendRjlAlert({ kind: "service_due", subject: "A", body: "B" }, { runtime, fetcher: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; } }), "failed");
  assert.deepEqual((await notifications(pg)).map((n) => n.error), ["provider status 500", "timeout"]);
});

test("alert addresses: malformed settings fall back to safe defaults", () => {
  assert.deepEqual(alerts.alertAddresses({}), { to: "info@rjlcommercialgroup.com", from: "Magic Keys Portal <onboarding@resend.dev>" });
  assert.deepEqual(alerts.alertAddresses({ RJL_ALERT_TO: "a@b.co, c@d.co", RJL_ALERT_FROM: "Evil\r\nBcc: x@y.z <a@b.co>" }), { to: "info@rjlcommercialgroup.com", from: "Magic Keys Portal <onboarding@resend.dev>" });
  assert.deepEqual(alerts.alertAddresses({ RJL_ALERT_TO: "service@rjl.example", RJL_ALERT_FROM: "Magic Keys <alerts@rjl.example>" }), { to: "service@rjl.example", from: "Magic Keys <alerts@rjl.example>" });
});

test("alert outbox keeps 12 months", async (t) => {
  const { pg } = await fixture(t);
  await pg.query("INSERT INTO rjl_notifications (kind, subject, body, created_at) VALUES ('help_flag', 'old', 'old', now() - interval '400 days'), ('help_flag', 'recent', 'recent', now() - interval '30 days')");
  await alerts.sendRjlAlert({ kind: "help_flag", subject: "new", body: "new" }, { runtime: {} });
  assert.deepEqual((await notifications(pg)).map((n) => n.subject), ["recent", "new"]);
});

// ---------- Rate limit and audit trail ----------
test("action slots: atomic limit per key, window expiry, strict key format", async (t) => {
  const { pg } = await fixture(t);
  const key = "remote-open:gate:TF-ENTRY";
  assert.equal(await limiter.takeActionSlot(key, 1, 6000), true);
  assert.equal(await limiter.takeActionSlot(key, 1, 6000), false);
  assert.equal(await limiter.takeActionSlot("remote-open:gate:SIDE-ENTRY", 1, 6000), true);
  await pg.query("UPDATE auth_attempts SET created_at = '2020-01-01T00:00:00.000Z' WHERE fingerprint = $1", [key]);
  assert.equal(await limiter.takeActionSlot(key, 1, 6000), true);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM auth_attempts WHERE fingerprint = $1", [key])).rows[0].n, 1, "expired slots are pruned");
  for (const bad of ["remote-open", "remote-open:gate:", "x:y:a b", "remote-open:gate:a'b", "remote-open:user:" + "a".repeat(201)]) {
    await assert.rejects(limiter.takeActionSlot(bad, 1, 6000), /Invalid rate-limit key/);
  }
  await assert.rejects(limiter.takeActionSlot(key, 0, 6000), /Invalid rate-limit window/);
  // Sign-in lockout state is untouched: action slots never use sign-in fingerprints.
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM auth_attempts WHERE success = 0")).rows[0].n, 0);
});

test("the activity log is append-only for the application role", async (t) => {
  const { pg } = await fixture(t);
  await pg.query("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) VALUES ('x', 'y', 'system', 'z', 'administrator')");
  await assert.rejects(pg.query("DELETE FROM activity_log"), /permission denied/);
  await assert.rejects(pg.query("UPDATE activity_log SET detail = 'tampered'"), /permission denied/);
});

// ---------- Portal action: record_service ----------
function request(body, cookie) {
  return new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
}
test("record_service needs an unlocked administrator and a valid date; the snapshot shows the result", async (t) => {
  const { pg } = await fixture(t);
  const cookie = (await auth.createSessionCookie(user)).split(";")[0];
  await pg.query("INSERT INTO gate_service_counters (gate_id, total_operations, operations_since_service, alert_level) VALUES ('SIDE-ENTRY', 4100, 4100, 2)");
  const locked = await portal.POST(request({ action: "record_service", gateId: "SIDE-ENTRY", servicedOn: "2026-10-01" }, cookie));
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).code, "admin_password_required");
  const unlockResponse = await admin.POST(new Request(`${origin}/api/auth/admin`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ password }) }));
  assert.equal(unlockResponse.status, 200);
  const unlocked = `${cookie}; ${unlockResponse.headers.get("set-cookie").split(";")[0]}`;
  for (const servicedOn of ["2099-01-01", "2026-02-30", "yesterday"]) {
    assert.equal((await portal.POST(request({ action: "record_service", gateId: "SIDE-ENTRY", servicedOn }, unlocked))).status, 400, servicedOn);
  }
  assert.equal((await portal.POST(request({ action: "record_service", gateId: "SCP-B01", servicedOn: "2026-10-01" }, unlocked))).status, 400);
  const ok = await portal.POST(request({ action: "record_service", gateId: "SIDE-ENTRY", servicedOn: "2026-10-01" }, unlocked));
  assert.equal(ok.status, 200);
  const { snapshot } = await ok.json();
  assert.equal(snapshot.service["SIDE-ENTRY"].operationsSinceService, 0);
  assert.equal(snapshot.service["SIDE-ENTRY"].totalOperations, 4100);
  assert.equal(snapshot.service["SIDE-ENTRY"].lastServiceAt, "2026-10-01T02:00:00.000Z");
  assert.equal(snapshot.service["SIDE-ENTRY"].nextServiceAt, "2027-04-01T02:00:00.000Z");
  assert.equal(snapshot.service["TF-ENTRY"].state, "ok");
  assert.equal(snapshot.service["SCP-B01"], undefined, "inactive gates are not listed");
});

// ---------- Remote open route: audit before pulse, rate limits, counting ----------
const doors = await vite.ssrLoadModule("/app/api/doors/open/route.ts");
const doorToken = "0123456789abcdef0123456789abcdef";
const DOOR_MAP = { "TF-ENTRY": 1, "SIDE-ENTRY": 4 };
function doorRequest(gateId, cookie) {
  return new Request(`${origin}/api/doors/open`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ gateId }) });
}
async function doorFixture(t, piReply = (body) => Response.json(body)) {
  const { pg } = await fixture(t);
  Object.assign(env, { DOOR_SERVICE_URL: "https://pi.example.test", DOOR_SERVICE_TOKEN: doorToken, DOOR_GATE_MAP: JSON.stringify(DOOR_MAP) });
  const pulses = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const door = Number(String(url).match(/doors\/(\d)\/open/)?.[1]);
    const requestId = init.headers["Idempotency-Key"];
    pulses.push({ url: String(url), door });
    return piReply({ status: "pulsed", door, pulse_ms: 500, position: "unknown", sensor_feedback: false, request_id: requestId });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const cookie = (await auth.createSessionCookie(user)).split(";")[0];
  const log = async () => (await pg.query("SELECT action FROM activity_log WHERE category = 'gate-command' ORDER BY id")).rows.map((r) => r.action);
  return { pg, pulses, cookie, log };
}

test("remote open: logged before the pulse, outcome logged after, and one confirmed pulse = one gate cycle", async (t) => {
  const { pg, pulses, cookie, log } = await doorFixture(t);
  const response = await doors.POST(doorRequest("TF-ENTRY", cookie));
  assert.equal(response.status, 200);
  assert.equal(pulses.length, 1); assert.equal(pulses[0].door, 1);
  assert.deepEqual(await log(), ["Remote open requested", "Remote open pulsed"]);
  assert.equal((await counter(pg, "TF-ENTRY")).operations_since_service, 1);
});

test("remote open: a second request for the same gate within 6 seconds is refused without a pulse", async (t) => {
  const { pulses, cookie } = await doorFixture(t);
  assert.equal((await doors.POST(doorRequest("SIDE-ENTRY", cookie))).status, 200);
  const second = await doors.POST(doorRequest("SIDE-ENTRY", cookie));
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /opened a moment ago/);
  assert.equal(pulses.length, 1);
});

test("remote open: more than 6 requests a minute from one person are refused", async (t) => {
  const { pg, pulses, cookie } = await doorFixture(t);
  const now = new Date().toISOString();
  const key = await limiter.personKey("remote-open:user", user.email);
  assert.doesNotMatch(key, /@/, "the stored key does not reveal the email address");
  for (let i = 0; i < 6; i++) await pg.query("INSERT INTO auth_attempts (fingerprint, success, created_at) VALUES ($1, 1, $2)", [key, now]);
  const response = await doors.POST(doorRequest("TF-ENTRY", cookie));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /Too many remote-open requests/);
  assert.equal(pulses.length, 0);
});

test("remote open: if the request cannot be written to the activity log, the gate is not opened", async (t) => {
  const { pg, pulses, cookie } = await doorFixture(t);
  await pg.query("RESET ROLE"); await pg.query("REVOKE INSERT ON balwyn_portal.activity_log FROM balwyn_app"); await pg.query("SET ROLE balwyn_app");
  const response = await doors.POST(doorRequest("TF-ENTRY", cookie));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /could not be recorded, so the gate was not opened/);
  assert.equal(pulses.length, 0);
});

test("remote open: replayed or unconfirmed pulses are logged but never counted", async (t) => {
  let mode = "replayed";
  const { pg, cookie, log } = await doorFixture(t, (body) => mode === "replayed" ? Response.json({ ...body, replayed: true }) : new Response("busy", { status: 503 }));
  assert.equal((await doors.POST(doorRequest("TF-ENTRY", cookie))).status, 200);
  mode = "fail";
  assert.equal((await doors.POST(doorRequest("SIDE-ENTRY", cookie))).status, 502);
  assert.deepEqual(await log(), ["Remote open requested", "Remote open pulsed", "Remote open requested", "Remote open not confirmed"]);
  assert.equal(await counter(pg, "TF-ENTRY"), undefined);
  assert.equal(await counter(pg, "SIDE-ENTRY"), undefined);
});

// ---------- Controller endpoints: credentials checked before anything else ----------
const heartbeatRoute = await vite.ssrLoadModule("/app/api/controller/heartbeat/route.ts");
test("controller endpoints refuse missing or malformed credentials and oversized messages without touching the database", async () => {
  let dbCalls = 0;
  env.fetchDatabase = async () => { dbCalls++; throw new Error("must not reach the database"); };
  const post = (headers, body) => heartbeatRoute.POST(new Request(`${origin}/api/controller/heartbeat`, { method: "POST", headers, body }));
  const good = { Authorization: `Bearer ${"a".repeat(43)}` };
  assert.equal((await post({}, "{}")).status, 401);
  assert.equal((await post({ Authorization: "Bearer short" }, "{}")).status, 401);
  assert.equal((await post({ Authorization: "Basic YWJjOmRlZg==" }, "{}")).status, 401);
  assert.equal((await post(good, "x".repeat(9000))).status, 413);
  assert.equal((await post(good, "[1,2]")).status, 400);
  assert.equal((await post(good, "not json")).status, 400);
  assert.equal(dbCalls, 0);
});

// ---------- Fault alerts (System settings > Fault alerts) ----------
const faults = await vite.ssrLoadModule("/lib/gate-faults.ts");
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
test("fault alerts: one email per gate per 6 hours, only when the setting is on", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  const { sent, fetcher } = mailer();
  const stored = async () => (await pg.query("SELECT kind, subject FROM rjl_notifications WHERE kind = 'gate_fault'")).rows;
  await pg.query("UPDATE portal_settings SET fault_alerts = 0 WHERE id = 1");
  assert.equal(await faults.reportGateFault({ gateId: "TF-ENTRY", faultText: "motor overload", safetyOk: true, fetcher }), "disabled");
  await pg.query("UPDATE portal_settings SET fault_alerts = 1 WHERE id = 1");
  env.RESEND_API_KEY = "re_test_key";
  assert.equal(await faults.reportGateFault({ gateId: "TF-ENTRY", faultText: "motor overload", safetyOk: true, fetcher }), "sent");
  assert.equal(await faults.reportGateFault({ gateId: "TF-ENTRY", faultText: "motor overload", safetyOk: true, fetcher }), "throttled");
  assert.equal(await faults.reportGateFault({ gateId: "SIDE-ENTRY", faultText: "", safetyOk: false, fetcher }), "sent");
  assert.equal(sent.length, 2);
  assert.match(sent[0].body.subject, /Tony Frizza Stadium Entry reported a fault/);
  assert.match(sent[1].body.text, /Safety input: NOT healthy/);
  assert.equal((await stored()).length, 2);
});

test("a heartbeat raises a fault alert only on the change to fault, and only for commissioned gates", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  const count = async () => { await new Promise((r) => setTimeout(r, 150)); return (await pg.query("SELECT COUNT(*)::int AS n FROM rjl_notifications WHERE kind = 'gate_fault'")).rows[0].n; };
  await store.recordHeartbeat({ gateId: "SIDE-ENTRY", position: "unknown", safetyOk: false, faults: [] });
  assert.equal(await count(), 0, "not commissioned: no alert");
  await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = 'online' WHERE gate_id = 'TF-ENTRY'");
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "closed", safetyOk: true, faults: [] });
  assert.equal(await count(), 0, "healthy: no alert");
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "closed", safetyOk: false, faults: [] });
  assert.equal(await count(), 1, "healthy → fault: one alert");
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "closed", safetyOk: false, faults: ["still blocked"] });
  assert.equal(await count(), 1, "still in fault: no repeat");
});

test("remote open: a malformed request id is refused before it uses a rate-limit slot or touches the log", async (t) => {
  const { pg, pulses, cookie, log } = await doorFixture(t);
  const bad = new Request(`${origin}/api/doors/open`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "x".repeat(1900) }, body: JSON.stringify({ gateId: "TF-ENTRY" }) });
  assert.equal((await doors.POST(bad)).status, 400);
  assert.deepEqual(await log(), []);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM auth_attempts")).rows[0].n, 0);
  assert.equal((await doors.POST(doorRequest("TF-ENTRY", cookie))).status, 200, "a valid request straight after is not blocked");
  assert.equal(pulses.length, 1);
});

test("emergency priority: a non-emergency packet queued during fire is never handed to a controller", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = 'online', safety_ok = 1 WHERE gate_id = 'TF-ENTRY'");
  const admin = { displayName: "Admin", email: "a@example.test", role: "administrator" };
  await store.queueGateCommands(["TF-ENTRY"], "open", admin, { mode: "fire", activityAction: "Fire", activityDetail: "test" });
  const future = new Date(Date.now() + 600_000).toISOString();
  // A schedule CLOSE that slipped in just after fire started (the race the review found).
  await pg.query("INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) VALUES ($1, 'TF-ENTRY', 'closed', 'schedule', 'queued', 'Schedule', $2)", [crypto.randomUUID(), future]);
  const first = await store.getNextControllerCommand("TF-ENTRY");
  assert.equal(first.source, "emergency"); assert.equal(first.command, "open");
  await pg.query("UPDATE command_queue SET state = 'acknowledged' WHERE id = $1", [first.id]);
  assert.equal(await store.getNextControllerCommand("TF-ENTRY"), null, "the schedule CLOSE is held while fire is active");
  // A re-issued fire command is still delivered past the held packet.
  await store.queueGateCommands(["TF-ENTRY"], "open", admin, { mode: "fire", activityAction: "Fire again", activityDetail: "test" });
  assert.equal((await store.getNextControllerCommand("TF-ENTRY")).source, "emergency");
});

test("an unsafe controller is handed a CLOSE but never an OPEN (a fire hold must be endable)", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = 'online' WHERE gate_id = 'TF-ENTRY'");
  const future = new Date(Date.now() + 600_000).toISOString();
  await pg.query("INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) VALUES ($1, 'TF-ENTRY', 'open', 'manual', 'queued', 'Staff', $2)", [crypto.randomUUID(), future]);
  assert.equal(await store.getNextControllerCommand("TF-ENTRY", { closeOnly: true }), null, "only an OPEN is queued: nothing is handed to an unsafe gate");
  assert.equal((await pg.query("SELECT state FROM command_queue WHERE gate_id = 'TF-ENTRY' AND command = 'open'")).rows[0].state, "queued", "the OPEN was not claimed");
  await pg.query("INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) VALUES ($1, 'TF-ENTRY', 'closed', 'emergency', 'queued', 'Staff', $2)", [crypto.randomUUID(), future]);
  const next = await store.getNextControllerCommand("TF-ENTRY", { closeOnly: true });
  assert.equal(next.command, "closed");
  assert.equal((await pg.query("SELECT state FROM command_queue WHERE gate_id = 'TF-ENTRY' AND command = 'open'")).rows[0].state, "queued", "the OPEN is still not claimed");
});

test("manual commands are refused atomically once emergency priority has started", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  await pg.query("UPDATE system_state SET mode = 'fire' WHERE id = 1");
  const admin = { displayName: "Admin", email: "a@example.test", role: "administrator" };
  await assert.rejects(store.queueGateCommands(["SIDE-ENTRY"], "closed", admin, { activityAction: "Close", activityDetail: "test" }), /emergency priority has started/);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM command_queue WHERE gate_id = 'SIDE-ENTRY'")).rows[0].n, 0);
});

test("a command the controller could not complete raises a fault alert", async (t) => {
  const { pg } = await fixture(t);
  await store.ensurePortalSeeded();
  await pg.query("UPDATE gate_states SET commissioned = 1, controller_state = 'online', safety_ok = 1 WHERE gate_id = 'SIDE-ENTRY'");
  const admin = { displayName: "Admin", email: "a@example.test", role: "administrator" };
  await store.queueGateCommands(["SIDE-ENTRY"], "open", admin, { activityAction: "Open", activityDetail: "test" });
  const command = await store.getNextControllerCommand("SIDE-ENTRY");
  await store.acknowledgeControllerCommand({ gateId: "SIDE-ENTRY", commandId: command.id, state: "blocked", position: "closed", safetyOk: false, detail: "safety beam broken" });
  await new Promise((r) => setTimeout(r, 200));
  const rows = (await pg.query("SELECT subject FROM rjl_notifications WHERE kind = 'gate_fault'")).rows;
  assert.equal(rows.length, 1);
  assert.match(rows[0].subject, /Side Entry reported a fault/);
});

test("controller endpoints stop reading a chunked body with no length header at 8 KB", async () => {
  let dbCalls = 0;
  env.fetchDatabase = async () => { dbCalls++; throw new Error("must not reach the database"); };
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) { if (sent > 64) { controller.close(); return; } sent++; controller.enqueue(new Uint8Array(1024).fill(32)); } });
  const request = new Request(`${origin}/api/controller/heartbeat`, { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(43)}` }, body: stream, duplex: "half" });
  assert.equal(request.headers.get("content-length"), null);
  assert.equal((await heartbeatRoute.POST(request)).status, 413);
  assert.ok(sent < 20, `stopped early (read ${sent} KB)`);
  assert.equal(dbCalls, 0);
});

