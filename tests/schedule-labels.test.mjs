// 24 Oct 2026 (Jarrod): a weekly schedule day can be given a name, not just times.
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
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const model = await vite.ssrLoadModule("/lib/portal-model.ts");
const windows = await vite.ssrLoadModule("/lib/gate-windows.ts");
const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };

function week(overrides) {
  const plan = model.makeWeekPlan(model.ACTIVE_GATES[0]);
  return { ...plan, ...overrides };
}

test("a schedule name is saved, read back and shown on the window", async (t) => {
  const { fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  await store.saveGateSchedule("TF-ENTRY", week({ Monday: { enabled: true, open: "08:00", close: "09:00", label: "  School\ndrop-off  " } }), admin);
  const snapshot = await store.getPortalSnapshot(admin);
  assert.equal(snapshot.schedules["TF-ENTRY"].Monday.label, "School drop-off", "name trimmed to one line");
  assert.equal(snapshot.schedules["TF-ENTRY"].Tuesday.label, "");
  const monday = "2026-10-26";
  const [window] = windows.windowsForDate(monday, snapshot.schedules, [], []).filter((w) => w.gateId === "TF-ENTRY");
  assert.equal(window.label, "School drop-off 08:00–09:00");
  assert.equal(window.ref, "schedule:TF-ENTRY:Monday:08:00-09:00", "the name is not part of the window key");
});

test("an over-long or non-text schedule name is refused", async (t) => {
  const { fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  await assert.rejects(store.saveGateSchedule("TF-ENTRY", week({ Monday: { enabled: true, open: "08:00", close: "09:00", label: "x".repeat(model.SCHEDULE_LABEL_MAX + 1) } }), admin), /60 characters or fewer/);
  await assert.rejects(store.saveGateSchedule("TF-ENTRY", week({ Monday: { enabled: true, open: "08:00", close: "09:00", label: 5 } }), admin), /Invalid schedule name/);
});

test("a due window skipped because the controller has schedule control off is logged once", async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  const today = new Intl.DateTimeFormat("en-AU", { weekday: "long", timeZone: "Australia/Melbourne" }).format(new Date());
  await store.saveGateSchedule("TF-ENTRY", week({ [today]: { enabled: true, open: "00:00", close: "23:59", label: "Bench test" } }), admin);
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "closed", safetyOk: true, faults: [] });
  store.resetScheduleOffThrottle();
  assert.equal(await store.noteScheduleControlOff("TF-ENTRY"), true);
  store.resetScheduleOffThrottle();
  assert.equal(await store.noteScheduleControlOff("TF-ENTRY"), false, "logged once per window");
  const rows = (await pg.query("SELECT detail FROM activity_log WHERE action = 'Scheduled window not run'")).rows;
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail, /Bench test 00:00–23:59 is due now, but this gate's controller has schedule control switched off/);
});
