// Audit 24 Oct 2026, gate logic F3 and F4.
//  F3: pausing the only window of the day mid-hold sent no release, so the
//      controller kept the schedule hold until HOLD_MAX_S.
//  F4: adding an unrelated window for the gate changed the OPEN key and re-opened
//      a gate that staff had closed by hand.
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
const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };

async function setup(t) {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  await store.issueControllerToken("TF-ENTRY", admin);
  await store.recordHeartbeat({ gateId: "TF-ENTRY", position: "closed", safetyOk: true, faults: [] });
  return pg;
}
// Mirrors app/api/controller/commands/route.ts
async function poll(position) {
  const commissioned = await store.recordHeartbeat({ gateId: "TF-ENTRY", position, safetyOk: true, faults: [] });
  let command = commissioned ? await store.getNextControllerCommand("TF-ENTRY") : null;
  if (!command && commissioned) command = await store.getOrCreateScheduledControllerCommand("TF-ENTRY");
  return command;
}
const ack = (command, position) => store.acknowledgeControllerCommand({ gateId: "TF-ENTRY", commandId: command.id, state: "acknowledged", position, safetyOk: true });
function melb(offsetMin) {
  const at = new Date(Date.now() + offsetMin * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

test("pausing the only window mid-hold releases the hold once (F3)", async (t) => {
  const s = melb(-30), e = melb(60);
  if (s.date !== e.date || s.time >= e.time) { t.skip("too close to midnight in Melbourne"); return; }
  const pg = await setup(t);
  await store.addAutomationRule({ name: "Sport", kind: "gate_window", config: { gateId: "TF-ENTRY", open: s.time, close: e.time, date: s.date } }, admin);
  const open = await poll("closed");
  assert.equal(open?.command, "open");
  await ack(open, "open");
  const id = (await pg.query("SELECT id FROM automation_rules LIMIT 1")).rows[0].id;
  await store.setAutomationRuleState(id, false, admin);
  const release = await poll("open");
  assert.equal(release?.command, "closed", "a release CLOSE is sent");
  assert.equal(release.source, "schedule");
  await ack(release, "closed");
  assert.equal(await poll("closed"), null, "nothing further once released");
  assert.equal(await poll("open"), null, "the release is sent once, not repeatedly");
});

test("adding an unrelated window does not re-open a gate staff closed by hand (F4)", async (t) => {
  const s = melb(-30), e = melb(60), later1 = melb(120), later2 = melb(150);
  if (s.date !== later2.date || s.time >= e.time || later1.time >= later2.time) { t.skip("too close to midnight in Melbourne"); return; }
  const pg = await setup(t);
  await store.addAutomationRule({ name: "Sport", kind: "gate_window", config: { gateId: "TF-ENTRY", open: s.time, close: e.time, date: s.date } }, admin);
  const open = await poll("closed");
  await ack(open, "open");
  await store.queueGateCommands(["TF-ENTRY"], "closed", admin, { activityAction: "close", activityDetail: "close" });
  const manual = await poll("open");
  assert.equal(manual.source, "manual");
  await ack(manual, "closed");
  await pg.query("UPDATE command_queue SET acknowledged_at = $1", [new Date(Date.now() - 120000).toISOString()]);
  assert.equal(await poll("closed"), null, "staff close ends automation for this window");
  await store.addAutomationRule({ name: "Evening", kind: "gate_window", config: { gateId: "TF-ENTRY", open: later1.time, close: later2.time, date: s.date } }, admin);
  assert.equal(await poll("closed"), null, "an unrelated evening window must not re-open the gate now");
});
