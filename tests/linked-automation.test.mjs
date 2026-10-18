// Linked gate automation (26 Sep 2026): one window engine feeds both the gates
// and the calendar; bookings save all-or-nothing; typed rules run, notes never do.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture, passwordHash } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const windowsLib = await vite.ssrLoadModule("/lib/gate-windows.ts");
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const hire = await vite.ssrLoadModule("/app/api/hire/route.ts");
const calendar = await vite.ssrLoadModule("/app/api/calendar/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

// ------------------------------------------------------------------ pure engine

test("Melbourne wall-clock times convert correctly on both sides of daylight saving", () => {
  assert.equal(windowsLib.melbourneToUtc("2026-09-26", "09:00").toISOString(), "2026-09-25T23:00:00.000Z"); // AEST +10
  assert.equal(windowsLib.melbourneToUtc("2026-10-05", "09:00").toISOString(), "2026-10-04T22:00:00.000Z"); // AEDT +11
  assert.equal(windowsLib.weekdayOf("2026-09-26"), "Saturday");
});

test("gate window rules are validated before they can ever run", () => {
  const ok = windowsLib.parseGateWindowConfig({ gateId: "TF-ENTRY", open: "07:30", close: "09:00", days: ["Friday", "Monday", "Monday"] });
  assert.deepEqual(ok.days, ["Monday", "Friday"]);
  assert.throws(() => windowsLib.parseGateWindowConfig({ gateId: "TF-EXIT", open: "07:30", close: "09:00", days: ["Monday"] }), /active gate/);
  assert.throws(() => windowsLib.parseGateWindowConfig({ gateId: "TF-ENTRY", open: "09:00", close: "07:30", days: ["Monday"] }), /before the closing/);
  assert.throws(() => windowsLib.parseGateWindowConfig({ gateId: "TF-ENTRY", open: "07:30", close: "09:00", days: ["Monday"], date: "2026-09-28" }), /either/);
  assert.throws(() => windowsLib.parseGateWindowConfig({ gateId: "TF-ENTRY", open: "07:30", close: "09:00" }), /either/);
});

test("the engine opens inside a window, releases after it, and leaves unmanaged gates alone", () => {
  const schedules = { "TF-ENTRY": { Saturday: { enabled: true, open: "08:00", close: "10:00" } } };
  const rules = [
    { id: 1, name: "Sport", kind: "gate_window", enabled: true, config: JSON.stringify({ gateId: "TF-ENTRY", open: "14:00", close: "16:00", date: "2026-09-26" }) },
    { id: 2, name: "Old note", kind: "note", enabled: true, config: null },
    { id: 3, name: "Paused", kind: "gate_window", enabled: false, config: JSON.stringify({ gateId: "SIDE-ENTRY", open: "00:00", close: "23:59", days: ["Saturday"] }) },
  ];
  const windows = windowsLib.windowsForDate("2026-09-26", schedules, rules, []);
  assert.deepEqual(windows.map((w) => w.source), ["schedule", "automation"]);
  const at = (hhmm) => windowsLib.melbourneToUtc("2026-09-26", hhmm);
  const early = windowsLib.resolveDirective("TF-ENTRY", windows, at("07:00"));
  const first = windowsLib.resolveDirective("TF-ENTRY", windows, at("09:00"));
  const gap = windowsLib.resolveDirective("TF-ENTRY", windows, at("12:00"));
  const second = windowsLib.resolveDirective("TF-ENTRY", windows, at("15:00"));
  const late = windowsLib.resolveDirective("TF-ENTRY", windows, at("17:00"));
  assert.deepEqual([early.target, first.target, gap.target, second.target, late.target], ["closed", "open", "closed", "open", "closed"]);
  // Each open and each release is its own command; the two opens are distinct.
  assert.equal(new Set([early.key, first.key, gap.key, second.key, late.key]).size, 5);
  // A paused rule and a note never manage a gate.
  assert.equal(windowsLib.resolveDirective("SIDE-ENTRY", windows, at("12:00")), null);
});

// -------------------------------------------------------------- database paths

function melbourneNow(offsetMinutes) {
  const at = new Date(Date.now() + offsetMinutes * 60000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Bookings that open gates need an administrator with settings unlocked
// (10 Oct 2026), so gate-linked booking tests use setup(t, "administrator").
async function setup(t, role = "operator") {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  const password = "A-test-password-934!";
  // AUDIT_SECURITY P2 fix (18 Oct 2026): PORTAL_ROLE now defaults to
  // 'viewer' when unset, so the primary password account (used by the
  // settings-password unlock below) must be annotated explicitly, or it
  // drops out of administratorPasswords() and every unlock attempt fails.
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: `op@example.test|${role}`, PORTAL_ROLE: role,
    PORTAL_USERNAME: "Op", PORTAL_OPERATOR_EMAIL: "op@example.test", PORTAL_PASSWORD_SALT: "test-password-salt", PORTAL_PASSWORD_HASH: await passwordHash(password, "test-password-salt") });
  env.fetchDatabase = fetchDatabase;
  const user = { displayName: "Op", email: "op@example.test", role };
  let cookie = (await auth.createSessionCookie(user)).split(";")[0];
  if (role === "administrator") {
    const adminRoute = await vite.ssrLoadModule("/app/api/auth/admin/route.ts");
    const unlock = await adminRoute.POST(new Request(`${origin}/api/auth/admin`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ password }) }));
    assert.equal(unlock.status, 200, JSON.stringify(await unlock.clone().json()));
    cookie = `${cookie}; ${unlock.headers.getSetCookie()[0].split(";")[0]}`;
  }
  const headers = { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie };
  const post = (body, extra = {}) => hire.POST(new Request(`${origin}/api/hire`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
  const feed = (query) => calendar.GET(new Request(`${origin}/api/calendar${query}`, { headers: { Cookie: cookie } }));
  await store.ensurePortalSeeded();
  return { pg, post, feed, user };
}

const booking = (date, startTime, endTime, extra = {}) => ({ fullName: "Basketball Club", email: "club@example.org", phone: "0400 000 000", area: "tony-frizza-stadium", date, startTime, endTime, depositLeft: false, depositAmount: 0, comment: "", ...extra });

test("a booking with a gate appears on the calendar feed as both a booking and a gate window", async (t) => {
  const { post, feed } = await setup(t, "administrator");
  const saved = await post(booking("2026-10-14", "18:00", "21:00", { gateIds: ["TF-ENTRY"], leadMinutes: 15, lagMinutes: 30 }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const body = await (await feed("?from=2026-10-12&to=2026-10-18")).json();
  assert.equal(body.bookings.length, 1);
  assert.equal(body.bookings[0].occurs_on, "2026-10-14");
  assert.equal("email" in body.bookings[0], false);
  const [window] = body.gateWindows;
  assert.equal(window.source, "booking");
  assert.equal(window.gateId, "TF-ENTRY");
  assert.equal(window.start, windowsLib.melbourneToUtc("2026-10-14", "17:45").toISOString());
  assert.equal(window.end, windowsLib.melbourneToUtc("2026-10-14", "21:30").toISOString());
});

test("an overlapping booking for the same space is refused and writes nothing", async (t) => {
  const { pg, post } = await setup(t, "administrator");
  assert.equal((await post(booking("2026-10-14", "18:00", "21:00"))).status, 200);
  const count = async (table) => Number((await pg.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  const before = { clients: await count("hire_clients"), bookings: await count("hire_bookings"), log: await count("activity_log"), gates: await count("hire_booking_gates") };
  const clash = await post(booking("2026-10-14", "20:00", "22:00", { fullName: "Netball Club", email: "net@example.org", gateIds: ["SIDE-ENTRY"] }));
  assert.equal(clash.status, 409);
  // The refused booking left no trace: no client, booking, gate link or log entry.
  assert.deepEqual({ clients: await count("hire_clients"), bookings: await count("hire_bookings"), log: await count("activity_log"), gates: await count("hire_booking_gates") }, before);
  // Back-to-back is not a clash, and a different space is not a clash.
  assert.equal((await post(booking("2026-10-14", "21:00", "22:00", { fullName: "Netball Club", email: "net@example.org" }))).status, 200);
  assert.equal((await post(booking("2026-10-14", "18:00", "21:00", { area: "gymnasium", fullName: "Gym Club", email: "gym@example.org" }))).status, 200);
  assert.equal(await count("activity_log") - before.log, 2);
});

test("bookings refuse inactive gates, bad run-out values and cross-site posts", async (t) => {
  const { post } = await setup(t, "administrator");
  assert.equal((await post(booking("2026-10-14", "18:00", "21:00", { gateIds: ["TF-EXIT"] }))).status, 400);
  assert.equal((await post(booking("2026-10-14", "18:00", "21:00", { gateIds: ["TF-ENTRY"], lagMinutes: 500 }))).status, 400);
  assert.equal((await post(booking("2026-10-14", "18:00", "21:00"), { Origin: "https://evil.example" })).status, 403);
});

test("the controller engine holds a gate open for a live booking and a typed rule, never for a note, never in fire mode", async (t) => {
  const start = melbourneNow(-30), end = melbourneNow(60);
  if (start.date !== end.date || start.time >= end.time) { t.skip("Too close to Melbourne midnight for a same-day window."); return; }
  const { pg, post, user } = await setup(t, "administrator");
  assert.equal((await post(booking(start.date, start.time, end.time, { gateIds: ["TF-ENTRY"], leadMinutes: 0, lagMinutes: 0 }))).status, 200);
  await store.addAutomationRule({ name: "Note only", kind: "note", trigger: "A controller goes offline", action: "Notify" }, user);
  let command = await store.getOrCreateScheduledControllerCommand("TF-ENTRY");
  assert.equal(command?.command, "open");
  assert.equal(command?.source, "schedule");
  // The note rule does not manage SIDE-ENTRY.
  assert.equal(await store.getOrCreateScheduledControllerCommand("SIDE-ENTRY"), null);
  await store.addAutomationRule({ name: "Side gate trial", kind: "gate_window", config: { gateId: "SIDE-ENTRY", open: start.time, close: end.time, date: start.date } }, user);
  command = await store.getOrCreateScheduledControllerCommand("SIDE-ENTRY");
  assert.equal(command?.command, "open");
  // Fire mode suspends all automation.
  await pg.query("UPDATE system_state SET mode = 'fire' WHERE id = 1");
  await pg.query("UPDATE command_queue SET state = 'failed'");
  assert.equal(await store.getOrCreateScheduledControllerCommand("TF-ENTRY"), null);
});

test("invalid typed rules are refused before storage", async (t) => {
  const { user } = await setup(t);
  await assert.rejects(store.addAutomationRule({ name: "Bad", kind: "gate_window", config: { gateId: "OFFICE-ENTRY-BOOM1", open: "08:00", close: "09:00", days: ["Monday"] } }, user), /active gate/);
  await assert.rejects(store.addAutomationRule({ name: "", kind: "gate_window", config: {} }, user), /Name/);
});

test("a booking opens only the gates explicitly ticked (none by default), with 15/15 minutes unless set", async (t) => {
  const { pg, post, feed } = await setup(t, "administrator");
  const gatesFor = async () => (await pg.query("SELECT b.name, g.gate_id, g.lead_minutes, g.lag_minutes FROM hire_booking_gates g JOIN hire_bookings b ON b.id = g.booking_id ORDER BY b.name")).rows;
  // Gate ticked, lead/lag not sent: the default 15/15 minutes apply.
  assert.equal((await post(booking("2026-10-20", "18:00", "21:00", { gateIds: ["TF-ENTRY"] }))).status, 200);
  // No gateIds sent: nothing opens (10 Oct 2026: no implicit default gate).
  assert.equal((await post(booking("2026-10-21", "18:00", "21:00", { fullName: "Quiet Club", email: "quiet@example.org" }))).status, 200);
  // Explicit empty list: nothing opens.
  assert.equal((await post(booking("2026-10-22", "18:00", "21:00", { fullName: "Gym Club", email: "gym@example.org", area: "gymnasium", gateIds: [] }))).status, 200);
  const rows = await gatesFor();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gate_id, "TF-ENTRY");
  assert.deepEqual([rows[0].lead_minutes, rows[0].lag_minutes], [15, 15]);
  // The calendar shows the opening from 17:45 and the release at 21:15.
  const body = await (await feed("?from=2026-10-19&to=2026-10-25")).json();
  assert.equal(body.gateWindows.length, 1);
  assert.equal(body.gateWindows[0].start, windowsLib.melbourneToUtc("2026-10-20", "17:45").toISOString());
  assert.equal(body.gateWindows[0].end, windowsLib.melbourneToUtc("2026-10-20", "21:15").toISOString());
});

test("the engine opens for the booking, then releases the gate once the run-out has passed", () => {
  const bookings = [{ bookingId: "b1", gateId: "TF-ENTRY", label: "Hire: Basketball", startsAt: windowsLib.melbourneToUtc("2026-10-20", "18:00").toISOString(), endsAt: windowsLib.melbourneToUtc("2026-10-20", "21:00").toISOString(), leadMinutes: 15, lagMinutes: 15 }];
  const windows = windowsLib.windowsForDate("2026-10-20", {}, [], bookings);
  const at = (hhmm) => windowsLib.melbourneToUtc("2026-10-20", hhmm);
  assert.equal(windowsLib.resolveDirective("TF-ENTRY", windows, at("17:44")).target, "closed");
  assert.equal(windowsLib.resolveDirective("TF-ENTRY", windows, at("17:45")).target, "open");
  assert.equal(windowsLib.resolveDirective("TF-ENTRY", windows, at("21:14")).target, "open");
  const release = windowsLib.resolveDirective("TF-ENTRY", windows, at("21:15"));
  assert.equal(release.target, "closed");
  assert.match(release.reason, /After Hire: Basketball/);
});

test("after a Pi restart mid-window the gate is re-opened, but never against staff and never endlessly", async (t) => {
  const start = melbourneNow(-30), end = melbourneNow(60);
  if (start.date !== end.date || start.time >= end.time) { t.skip("Too close to Melbourne midnight for a same-day window."); return; }
  const { pg, user } = await setup(t);
  await store.addAutomationRule({ name: "Sport", kind: "gate_window", config: { gateId: "TF-ENTRY", open: start.time, close: end.time, date: start.date } }, user);
  const heartbeat = (position) => store.recordHeartbeat({ gateId: "TF-ENTRY", position, safetyOk: true, faults: [] });
  const ackLatest = async (position) => {
    const row = (await pg.query("SELECT id, command FROM command_queue WHERE gate_id = 'TF-ENTRY' ORDER BY id DESC LIMIT 1")).rows[0];
    await store.acknowledgeControllerCommand({ gateId: "TF-ENTRY", commandId: row.id, state: position === row.command ? "acknowledged" : "failed", position, safetyOk: true });
    return row;
  };
  const ageLastAck = () => pg.query("UPDATE command_queue SET acknowledged_at = ? WHERE id = (SELECT max(id) FROM command_queue)".replace("?", `'${new Date(Date.now() - 2 * 60_000).toISOString()}'`));

  await heartbeat("closed");
  const first = await store.getOrCreateScheduledControllerCommand("TF-ENTRY");
  assert.equal(first?.command, "open");
  await ackLatest("open");

  // Pi restarts: relay drops, the operator auto-closes, the controller reports closed.
  await heartbeat("closed");
  assert.equal(await store.getOrCreateScheduledControllerCommand("TF-ENTRY"), null, "cool-down first");
  await ageLastAck();
  const reopen = await store.getOrCreateScheduledControllerCommand("TF-ENTRY");
  assert.equal(reopen?.command, "open");
  assert.match(reopen.correlationId, /:r1$/);
  const log = (await pg.query("SELECT action FROM activity_log ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(log.action, "Scheduled relay command re-sent");

  // Never more than three re-opens in one window.
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    await ackLatest("closed"); await heartbeat("closed"); await ageLastAck();
    assert.match((await store.getOrCreateScheduledControllerCommand("TF-ENTRY"))?.correlationId ?? "", new RegExp(`:r${attempt}$`));
  }
  await ackLatest("closed"); await heartbeat("closed"); await ageLastAck();
  assert.equal(await store.getOrCreateScheduledControllerCommand("TF-ENTRY"), null);
});

test("staff pressing CLOSE during a window ends automation for that window", async (t) => {
  const start = melbourneNow(-30), end = melbourneNow(60);
  if (start.date !== end.date || start.time >= end.time) { t.skip("Too close to Melbourne midnight for a same-day window."); return; }
  const { pg, user } = await setup(t);
  await store.addAutomationRule({ name: "Sport", kind: "gate_window", config: { gateId: "SIDE-ENTRY", open: start.time, close: end.time, date: start.date } }, user);
  await store.recordHeartbeat({ gateId: "SIDE-ENTRY", position: "closed", safetyOk: true, faults: [] });
  const open = await store.getOrCreateScheduledControllerCommand("SIDE-ENTRY");
  await store.acknowledgeControllerCommand({ gateId: "SIDE-ENTRY", commandId: open.id, state: "acknowledged", position: "open", safetyOk: true });
  await store.queueGateCommands(["SIDE-ENTRY"], "closed", user, { activityAction: "Close", activityDetail: "staff" });
  const close = (await pg.query("SELECT id FROM command_queue WHERE gate_id = 'SIDE-ENTRY' ORDER BY id DESC LIMIT 1")).rows[0];
  await store.acknowledgeControllerCommand({ gateId: "SIDE-ENTRY", commandId: close.id, state: "acknowledged", position: "closed", safetyOk: true });
  await store.recordHeartbeat({ gateId: "SIDE-ENTRY", position: "closed", safetyOk: true, faults: [] });
  await pg.query(`UPDATE command_queue SET acknowledged_at = '${new Date(Date.now() - 5 * 60_000).toISOString()}'`);
  assert.equal(await store.getOrCreateScheduledControllerCommand("SIDE-ENTRY"), null);
});

test("staff accounts: listing needs an administrator; every change also needs the settings password (10 Oct 2026)", async (t) => {
  const accounts = await vite.ssrLoadModule("/app/api/accounts/route.ts");
  const adminRoute = await vite.ssrLoadModule("/app/api/auth/admin/route.ts");
  const { fetchDatabase } = await databaseFixture(t);
  const password = "A-test-password-934!";
  for (const key of Object.keys(env)) delete env[key];
  // AUDIT_SECURITY P2 fix (18 Oct 2026): PORTAL_ROLE now defaults to
  // 'viewer' when unset, so the primary password account (used by the
  // settings-password unlock below) must be annotated explicitly.
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator,op@example.test|operator", PORTAL_ROLE: "administrator",
    PORTAL_USERNAME: "administrator", PORTAL_OPERATOR_EMAIL: "admin@example.test", PORTAL_PASSWORD_SALT: "test-password-salt", PORTAL_PASSWORD_HASH: await passwordHash(password, "test-password-salt") });
  env.fetchDatabase = fetchDatabase;
  const cookieFor = async (email, role) => (await auth.createSessionCookie({ displayName: role, email, role })).split(";")[0];
  const admin = await cookieFor("admin@example.test", "administrator");
  const operator = await cookieFor("op@example.test", "operator");
  const list = (cookie) => accounts.GET(new Request(`${origin}/api/accounts`, { headers: { Cookie: cookie } }));
  const create = (cookie, from = origin) => accounts.POST(new Request(`${origin}/api/accounts`, { method: "POST",
    headers: { Cookie: cookie, Origin: from, "Sec-Fetch-Site": from === origin ? "same-origin" : "cross-site", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", email: "sam@example.test", displayName: "Sam Lee", role: "viewer" }) }));
  assert.equal((await list(admin)).status, 200, "listing needs no unlock");
  assert.equal((await list(operator)).status, 403);
  const locked = await create(admin);
  assert.equal(locked.status, 403, "a change without the settings password is refused");
  assert.equal((await locked.json()).code, "admin_password_required");
  const unlockResponse = await adminRoute.POST(new Request(`${origin}/api/auth/admin`, { method: "POST", headers: { Cookie: admin, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: JSON.stringify({ password }) }));
  assert.equal(unlockResponse.status, 200, JSON.stringify(await unlockResponse.clone().json()));
  const unlocked = `${admin}; ${unlockResponse.headers.getSetCookie()[0].split(";")[0]}`;
  assert.equal((await create(unlocked, "https://evil.example")).status, 403);
  assert.equal((await create(operator)).status, 403);
  const made = await create(unlocked);
  assert.equal(made.status, 200, JSON.stringify(await made.clone().json()));
  assert.match((await made.json()).setupLink, /^https:\/\/[^/]+\/setup\?token=/);
});
