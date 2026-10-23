import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";

import { getSql, getDb } from "@/db";
import {
  activityLog,
  authAttempts,
  automationRules,
  commandQueue,
  gateStates,
  portalSettings,
  schedules,
  systemState,
} from "@/db/schema";
import {
  DAYS,
  GATES,
  isGateActive,
  INITIAL_AUTOMATIONS,
  makeWeekPlan,
  SCHEDULE_LABEL_MAX,
  type AutomationRule,
  type ControllerState,
  type DayKey,
  type GatePosition,
  type ModuleKey,
  type PortalSnapshot,
  type PortalUser,
  type ReportedPosition,
  type SystemMode,
  type WeekPlan,
} from "@/lib/portal-model";
import { heartbeatCompletesCommissioning, validateControllerAcknowledgement } from "@/lib/controller-safety";
import { assertPlanAllowsModules, getPortalPlan, planAllowsModule } from "@/lib/portal-plan";
import { readGateService, recordGateOperation } from "@/lib/gate-service";
import { reportGateFault } from "@/lib/gate-faults";
import {
  addDays,
  melbourneDate,
  melbourneToUtc,
  parseGateWindowConfig,
  resolveDirective,
  windowsForDate,
  type BookingLink,
  type GateWindow,
  type RuleKind,
  type StoredRule,
} from "@/lib/gate-windows";

function nowIso() {
  return new Date().toISOString();
}

// Command expiry is housekeeping: run it at most every 10 s from snapshot reads
// instead of on every 4 s refresh, so dashboard reads stop queuing behind the
// database write lock. Controller polls and operator actions still expire
// commands through their own paths.
let lastExpirySweep = 0;
const EXPIRY_SWEEP_INTERVAL_MS = 10_000;

export async function ensurePortalSeeded() {
  const d1 = getSql();
  const seeded = await d1.prepare("SELECT id FROM system_state WHERE id = 1").first();
  if (seeded) return;

  const scheduleRows = GATES.flatMap((gate) => {
    const week = makeWeekPlan(gate);
    return DAYS.map((day) => ({
      gateId: gate.id,
      day,
      enabled: week[day].enabled,
      openTime: week[day].open,
      closeTime: week[day].close,
      updatedBy: "system",
    }));
  });

  const gatePlaceholders = GATES.map(() => "(?, ?, 'unknown', 'uncommissioned')").join(", ");
  const scheduleChunks = Array.from(
    { length: Math.ceil(scheduleRows.length / 12) },
    (_, index) => scheduleRows.slice(index * 12, index * 12 + 12),
  );
  const automationPlaceholders = INITIAL_AUTOMATIONS.map(() => "(?, ?, ?, ?, 'system')").join(", ");

  const statements = [
    d1.prepare(
      "INSERT INTO portal_settings (id, position_monitoring, fault_alerts, voice_announcements, enabled_modules, updated_by) VALUES (1, 1, 1, 1, ?, 'system') ON CONFLICT(id) DO NOTHING",
    ).bind('["mobile"]'),
    d1.prepare(
      `INSERT INTO gate_states (gate_id, commanded_position, reported_position, controller_state) VALUES ${gatePlaceholders} ON CONFLICT(gate_id) DO NOTHING`,
    ).bind(...GATES.flatMap((gate) => [gate.id, gate.defaultPosition])),
    ...scheduleChunks.map((chunk) => d1.prepare(
      `INSERT INTO gate_schedules (gate_id, day, enabled, open_time, close_time, updated_by) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, 'system')").join(", ")} ON CONFLICT(gate_id, day) DO NOTHING`,
    ).bind(...chunk.flatMap((row) => [row.gateId, row.day, row.enabled ? 1 : 0, row.openTime, row.closeTime]))),
    ...(INITIAL_AUTOMATIONS.length > 0 ? [d1.prepare(
      `INSERT INTO automation_rules (name, trigger, action, enabled, updated_by) VALUES ${automationPlaceholders} ON CONFLICT(name) DO NOTHING`,
    ).bind(...INITIAL_AUTOMATIONS.flatMap((rule) => [rule.name, rule.trigger, rule.action, rule.enabled ? 1 : 0]))] : []),
  ];

  await d1.batch(statements);
  await d1.prepare(
    "INSERT INTO system_state (id, mode, updated_by) VALUES (1, 'normal', 'system') ON CONFLICT(id) DO NOTHING",
  ).run();
}

export async function getPortalSnapshot(user: PortalUser, seededCheckDone = false): Promise<PortalSnapshot> {
  // The seed check used to be a separate round trip before every read. The
  // reads below already fetch system_state, so seeding now runs only when that
  // row is actually missing (first ever start), then the snapshot is re-read.
  const db = getDb();
  const d1 = getSql();
  const expiry = nowIso();
  if (Date.now() - lastExpirySweep >= EXPIRY_SWEEP_INTERVAL_MS) {
  lastExpirySweep = Date.now();
  await d1.batch([
    d1.prepare("UPDATE gate_states SET last_command_state = 'failed', last_error = 'Command expired before controller confirmation.', updated_at = CURRENT_TIMESTAMP WHERE last_command_id IN (SELECT id FROM command_queue WHERE state IN ('queued', 'dispatched') AND expires_at <= ?)").bind(expiry),
    d1.prepare("UPDATE command_queue SET state = 'failed', acknowledged_at = CURRENT_TIMESTAMP, detail = 'Command expired before controller confirmation.' WHERE state IN ('queued', 'dispatched') AND expires_at <= ?").bind(expiry),
  ]);
  }
  const [systemRows, gateRows, scheduleRows, activityRows, ruleRows, settingRows, service] = await Promise.all([
    db.select().from(systemState).where(eq(systemState.id, 1)).limit(1),
    db.select().from(gateStates).orderBy(asc(gateStates.gateId)),
    db.select().from(schedules).orderBy(asc(schedules.gateId), asc(schedules.id)),
    db.select().from(activityLog).orderBy(desc(activityLog.id)).limit(200),
    db.select().from(automationRules).orderBy(asc(automationRules.id)),
    db.select().from(portalSettings).where(eq(portalSettings.id, 1)).limit(1),
    readGateService(), // null (never throws) if the counter table is not set up yet
  ]);
  if (!systemRows.length && !seededCheckDone) {
    await ensurePortalSeeded();
    return getPortalSnapshot(user, true);
  }

  const scheduleMap = Object.fromEntries(GATES.map((gate) => [gate.id, makeWeekPlan(gate)])) as Record<string, WeekPlan>;
  for (const row of scheduleRows) {
    if (!isGateActive(row.gateId) || !scheduleMap[row.gateId] || !DAYS.includes(row.day as DayKey)) continue;
    scheduleMap[row.gateId][row.day as DayKey] = { enabled: row.enabled, open: row.openTime, close: row.closeTime, label: row.label ?? "" };
  }

  const currentTime = Date.now();
  const runtimeGates = GATES.map((gate) => {
    const row = gateRows.find((candidate) => candidate.gateId === gate.id);
    const stale = row?.commissioned && (!row.lastSeen || currentTime - Date.parse(row.lastSeen) > 90_000);
    const controllerState = !row?.commissioned
      ? "uncommissioned"
      : stale
        ? "offline"
        : (row.controllerState as ControllerState);
    return {
      gateId: gate.id,
      commandedPosition: (row?.commandedPosition ?? gate.defaultPosition) as GatePosition,
      reportedPosition: (row?.reportedPosition ?? "unknown") as ReportedPosition,
      controllerState,
      safetyOk: row?.safetyOk ?? null,
      lastSeen: row?.lastSeen ?? null,
      lastCommandState: (row?.lastCommandState ?? "idle") as PortalSnapshot["gates"][number]["lastCommandState"],
      lastCommandId: row?.lastCommandId ?? null,
      lastError: row?.lastError ?? null,
      credentialIssued: Boolean(row?.controllerTokenHash),
      commissioned: Boolean(row?.commissioned),
      // Only shown while the controller is reporting; an old reading is not passed on.
      cpuTempC: controllerState === "online" || controllerState === "fault" ? (row?.cpuTempC ?? null) : null,
    };
  });

  const setting = settingRows[0];
  let enabledModules: ModuleKey[] = ["mobile"];
  try {
    const parsed = JSON.parse(setting?.enabledModules ?? "[]") as string[];
    enabledModules = parsed.filter((item): item is ModuleKey => ["mobile", "video", "visitor", "intercom", "api", "reporting"].includes(item));
    if (!enabledModules.includes("mobile")) enabledModules.unshift("mobile");
  } catch {
    enabledModules = ["mobile"];
  }

  const plan = getPortalPlan();
  return {
    plan,
    systemMode: (systemRows[0]?.mode ?? "normal") as SystemMode,
    gates: runtimeGates,
    schedules: scheduleMap,
    activity: activityRows.map((row) => ({
      id: row.id,
      action: row.action,
      detail: row.detail,
      category: row.category,
      actorName: row.actorName,
      createdAt: row.createdAt,
    })),
    automations: ruleRows.map((row) => ({ id: row.id, name: row.name, trigger: row.trigger, action: row.action, enabled: row.enabled, kind: row.kind === "gate_window" ? "gate_window" : "note", config: row.config ?? null })),
    settings: {
      positionMonitoring: setting?.positionMonitoring ?? true,
      faultAlerts: setting?.faultAlerts ?? true,
      voiceAnnouncements: setting?.voiceAnnouncements ?? true,
      enabledModules: enabledModules.filter((module) => planAllowsModule(module, plan)),
    },
    user,
    serverTime: nowIso(),
    service,
  };
}

export async function recordActivity(user: PortalUser, action: string, detail: string, category: string) {
  await getDb().insert(activityLog).values({
    action: action.slice(0, 200),
    // The log is permanent (append-only), so entries are length-capped.
    detail: detail.slice(0, 1000),
    category,
    actorName: user.displayName,
    actorRole: user.role,
  });
}

/** Manual commands expire quickly: a stale manual OPEN must never fire late. */
export const MANUAL_COMMAND_EXPIRY_MS = 2 * 60 * 1000;
/** Emergency packets (fire OPEN and all-clear CLOSE): see queueGateCommands. */
export const EMERGENCY_COMMAND_EXPIRY_MS = 12 * 60 * 60 * 1000;

export async function queueGateCommands(
  gateIds: string[],
  position: GatePosition,
  user: PortalUser,
  options: { mode?: SystemMode; activityAction: string; activityDetail: string },
) {
  await ensurePortalSeeded();
  if (gateIds.some((id) => !isGateActive(id))) throw new Error("Commands are blocked for inactive or unknown gates.");
  const validIds = [...new Set(gateIds)];
  if (!validIds.length) throw new Error("No valid gate was selected.");
  const correlationId = crypto.randomUUID();
  // A fire OPEN stays collectable as long as the controller would keep the hold
  // (audit F2): a gate whose controller is offline for more than two minutes when
  // the alarm is raised still opens once it reconnects. Clearing the emergency
  // cancels any fire OPEN not yet collected, so a long expiry cannot open a gate
  // after the all-clear.
  const expiry = new Date(Date.now() + (options.mode ? EMERGENCY_COMMAND_EXPIRY_MS : MANUAL_COMMAND_EXPIRY_MS)).toISOString();
  const d1 = getSql();
  const statements = [];
  if (options.mode) {
    statements.push(
      d1.prepare("UPDATE gate_states SET last_command_state = 'failed', last_error = 'Queued command superseded by emergency priority.', updated_at = CURRENT_TIMESTAMP WHERE last_command_id IN (SELECT id FROM command_queue WHERE state = 'queued')"),
      d1.prepare("UPDATE command_queue SET state = 'failed', acknowledged_at = CURRENT_TIMESTAMP, detail = 'Superseded by emergency priority.' WHERE state = 'queued'"),
    );
  }
  const source = options.mode ? "emergency" : "manual";
  for (const gateId of validIds) {
    const insertSql = options.mode
      ? "INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)"
      : "INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) SELECT ?, ?, ?, ?, 'queued', ?, ? WHERE NOT EXISTS (SELECT 1 FROM command_queue WHERE gate_id = ? AND state IN ('queued', 'dispatched')) AND (SELECT mode FROM system_state WHERE id = 1) = 'normal'";
    const insert = d1.prepare(insertSql);
    statements.push(options.mode
      ? insert.bind(correlationId, gateId, position, source, user.displayName, expiry)
      : insert.bind(correlationId, gateId, position, source, user.displayName, expiry, gateId));
    statements.push(d1.prepare(
      "UPDATE gate_states SET commanded_position = ?, last_command_id = (SELECT id FROM command_queue WHERE correlation_id = ? AND gate_id = ?), last_command_state = 'queued', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE gate_id = ? AND EXISTS (SELECT 1 FROM command_queue WHERE correlation_id = ? AND gate_id = ? AND state = 'queued')",
    ).bind(position, correlationId, gateId, gateId, correlationId, gateId));
  }
  if (options.mode) {
    statements.push(d1.prepare("UPDATE system_state SET mode = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1").bind(options.mode, user.displayName));
  }
  statements.push(d1.prepare(
    "INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM command_queue WHERE correlation_id = ?)",
  ).bind(options.activityAction, options.activityDetail, options.mode ? "emergency" : "gate-command", user.displayName, user.role, correlationId));
  const results = await d1.batch(statements);
  // Manual commands are inserted only if, inside the same locked transaction, the
  // gate has nothing in flight AND no emergency mode has started since the route
  // checked (closes the gap between that check and this insert).
  if (!options.mode) {
    const inserted = results.filter((_, index) => index % 2 === 0 && index < validIds.length * 2)
      .reduce((sum, result) => sum + Number(result?.meta?.changes ?? 0), 0);
    if (inserted === 0) throw new Error("The command was not queued: a command is already awaiting completion for this gate, or emergency priority has started. Refresh and check the gate.");
    return { correlationId, queuedCount: inserted };
  }
  return { correlationId, queuedCount: validIds.length };
}

/** How long an all-clear CLOSE stays collectable. It matches the controller's
 *  default EMERGENCY_RESTORE_MAX_S (12 h): a controller that restores a fire hold
 *  after an outage of up to 12 h can still collect the CLOSE that ends it. With
 *  the earlier 15 minutes, a gate offline for longer stayed held open (audit F2). */
export const ALL_CLEAR_CLOSE_EXPIRY_MS = EMERGENCY_COMMAND_EXPIRY_MS;

/**
 * Clear fire / evacuation priority AND release the gates the fire command opened
 * (Jarrod, 24 Oct 2026: "when the evacuation is over it releases the relays and
 * goes back to closed").
 *
 * The gate controller keeps a fire hold on until the portal sends a CLOSE: no
 * timer or network loss ends it (gate-controller relay.py). Before this change an
 * administrator had to press CLOSE on every gate after clearing, and a gate left
 * alone stayed held open. Now, in the same transaction that returns the portal to
 * normal, one CLOSE is queued for every active gate whose most recent command is
 * the emergency OPEN, i.e. every gate still under the fire command.
 *
 * What the CLOSE does at the gate: it only releases the hold. The operator then
 * closes the gate itself after its pause time, under its own safety devices, and
 * the controller acknowledges only when the closed reed confirms it. It never
 * drives a gate shut and never declares the site safe.
 *
 * The CLOSE is queued with source 'emergency' so it is handed out ahead of
 * anything else and pre-empts a gate that is still busy with the fire open.
 * Starting a new fire supersedes it (queueGateCommands fails every queued packet
 * before queuing the new OPENs). A gate the administrator has already closed by
 * hand (its last command is a manual CLOSE) is left alone.
 */
export async function clearEmergencyPriority(user: PortalUser) {
  const d1 = getSql();
  const activeIds = GATES.filter((gate) => isGateActive(gate.id)).map((gate) => gate.id);
  const correlationId = crypto.randomUUID();
  const expiry = new Date(Date.now() + ALL_CLEAR_CLOSE_EXPIRY_MS).toISOString();
  // Gates still under the fire command: the latest command for the gate is an
  // emergency OPEN, or an all-clear CLOSE that failed (expired or not confirmed),
  // so pressing Clear again re-sends it (audit F5). A queued or confirmed
  // all-clear CLOSE is left alone, so repeated presses never duplicate it.
  const heldByFire = `SELECT cq.gate_id FROM command_queue cq
     WHERE cq.source = 'emergency' AND (cq.command = 'open' OR (cq.command = 'closed' AND cq.state = 'failed'))
       AND cq.id = (SELECT MAX(latest.id) FROM command_queue latest WHERE latest.gate_id = cq.gate_id)
       AND cq.gate_id IN (${activeIds.map(() => "?::text").join(", ") || "NULL"})`;
  await d1.batch([
    d1.prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT 'Emergency priority cleared', ? || ' cleared ' || mode || ' priority. Uncollected fire OPEN packets were cancelled. A CLOSE was sent to every gate still held open by the fire command: each controller releases its hold and the gate closes by itself under its own safety devices. Each gate is shown closed only when its controller confirms it. The site was not declared safe.', 'emergency-clear', ?, ? FROM system_state WHERE id = 1").bind(user.displayName, user.displayName, user.role),
    d1.prepare("UPDATE gate_states SET last_command_state = 'failed', last_error = 'Emergency packet cancelled before controller collection when portal priority was cleared.', updated_at = CURRENT_TIMESTAMP WHERE last_command_id IN (SELECT id FROM command_queue WHERE source = 'emergency' AND command = 'open' AND state = 'queued')"),
    // Only uncollected fire OPENs are cancelled. An all-clear CLOSE from an earlier
    // press is left queued: cancelling it would leave the fire hold on (audit F1).
    d1.prepare("UPDATE command_queue SET state = 'failed', acknowledged_at = CURRENT_TIMESTAMP, detail = 'Cancelled before controller collection when emergency priority was cleared.' WHERE source = 'emergency' AND command = 'open' AND state = 'queued'"),
    // All-clear: one CLOSE per gate still under the fire command (see above).
    d1.prepare(`INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at)
      SELECT ?::text, held.gate_id, 'closed', 'emergency', 'queued', ?::text, ?::text FROM (${heldByFire}) held`)
      .bind(correlationId, `${user.displayName} (fire all-clear)`, expiry, ...activeIds),
    d1.prepare("UPDATE gate_states SET commanded_position = 'closed', last_command_id = (SELECT id FROM command_queue WHERE correlation_id = ? AND gate_id = gate_states.gate_id), last_command_state = 'queued', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM command_queue WHERE correlation_id = ? AND gate_id = gate_states.gate_id)")
      .bind(correlationId, correlationId),
    d1.prepare("UPDATE system_state SET mode = 'normal', updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1").bind(user.displayName),
  ]);
}

/** A schedule name: optional, single line, at most SCHEDULE_LABEL_MAX characters. */
export function cleanScheduleLabel(value: unknown, day: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`Invalid schedule name for ${day}.`);
  const label = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (label.length > SCHEDULE_LABEL_MAX) throw new Error(`${day}'s schedule name must be ${SCHEDULE_LABEL_MAX} characters or fewer.`);
  return label;
}

export async function saveGateSchedule(gateId: string, week: WeekPlan, user: PortalUser) {
  if (!isGateActive(gateId)) throw new Error("Schedules are blocked for inactive or unknown gates.");
  const d1 = getSql();
  const statements = DAYS.map((day) => {
    const plan = week[day];
    if (!plan || typeof plan.enabled !== "boolean") throw new Error(`Invalid schedule for ${day}.`);
    const open = typeof plan.open === "string" ? plan.open : "";
    const close = typeof plan.close === "string" ? plan.close : "";
    if (plan.enabled && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close))) {
      throw new Error(`Invalid schedule for ${day}.`);
    }
    if (plan.enabled && open >= close) throw new Error(`${day}'s opening time must be before its closing time.`);
    const label = cleanScheduleLabel(plan.label, day);
    return d1.prepare(
      "INSERT INTO gate_schedules (gate_id, day, enabled, open_time, close_time, label, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(gate_id, day) DO UPDATE SET enabled = excluded.enabled, open_time = excluded.open_time, close_time = excluded.close_time, label = excluded.label, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by",
    ).bind(gateId, day, plan.enabled ? 1 : 0, open, close, label, user.displayName);
  });
  await d1.batch(statements);
  const gate = GATES.find((candidate) => candidate.id === gateId)!;
  await recordActivity(user, "Gate schedule updated", `${gate.name}'s weekly operating schedule was saved.`, "schedule");
}

/**
 * Add an automation rule.
 *  kind "gate_window": validated by parseGateWindowConfig; runs through the same
 *    engine as schedules and appears on the calendar.
 *  kind "note": free text, stored for the record, never executed.
 */
export async function addAutomationRule(
  rule: { name: string; kind?: RuleKind; trigger?: string; action?: string; config?: unknown },
  user: PortalUser,
) {
  const name = String(rule.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("Name the automation rule.");
  const kind: RuleKind = rule.kind === "gate_window" ? "gate_window" : "note";
  if (kind === "gate_window") {
    const config = parseGateWindowConfig(rule.config);
    const gate = GATES.find((candidate) => candidate.id === config.gateId)!;
    const when = config.date ? `On ${config.date}` : `Every ${config.days!.join(", ")}`;
    await getDb().insert(automationRules).values({
      name, kind, config: JSON.stringify(config), enabled: true, updatedBy: user.displayName,
      trigger: `${when}, ${config.open}–${config.close} (Melbourne time)`.slice(0, 160),
      action: `Hold ${gate.name} open, then release`.slice(0, 160),
    });
  } else {
    const trigger = String(rule.trigger ?? "").trim().slice(0, 160);
    const action = String(rule.action ?? "").trim().slice(0, 160);
    if (!trigger || !action) throw new Error("Name, trigger and action are required.");
    await getDb().insert(automationRules).values({ name, kind, config: null, trigger, action, enabled: true, updatedBy: user.displayName });
  }
  await recordActivity(user, "Automation rule added", `${user.displayName} created "${name}"${kind === "note" ? " (note only, not automated)" : ""}.`, "automation");
}

export async function setAutomationRuleState(id: number, enabled: boolean, user: PortalUser) {
  const rows = await getDb().select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
  if (!rows[0]) throw new Error("Automation rule not found.");
  await getDb().update(automationRules).set({ enabled, updatedAt: nowIso(), updatedBy: user.displayName }).where(eq(automationRules.id, id));
  await recordActivity(user, `Automation ${enabled ? "enabled" : "paused"}`, `${user.displayName} updated "${rows[0].name}".`, "automation");
}

export async function removeAutomationRule(id: number, user: PortalUser) {
  const rows = await getDb().select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
  if (!rows[0]) throw new Error("Automation rule not found.");
  await getDb().delete(automationRules).where(eq(automationRules.id, id));
  await recordActivity(user, "Automation rule removed", `${user.displayName} removed "${rows[0].name}".`, "automation");
}

export async function updatePortalSettings(
  patch: Partial<{ positionMonitoring: boolean; faultAlerts: boolean; voiceAnnouncements: boolean; enabledModules: ModuleKey[] }>,
  user: PortalUser,
) {
  const clean: Record<string, unknown> = { updatedAt: nowIso(), updatedBy: user.displayName };
  if (typeof patch.positionMonitoring === "boolean") clean.positionMonitoring = patch.positionMonitoring;
  if (typeof patch.faultAlerts === "boolean") clean.faultAlerts = patch.faultAlerts;
  if (typeof patch.voiceAnnouncements === "boolean") clean.voiceAnnouncements = patch.voiceAnnouncements;
  if (Array.isArray(patch.enabledModules)) {
    const valid = [...new Set(patch.enabledModules)].filter((item): item is ModuleKey => ["mobile", "video", "visitor", "intercom", "api", "reporting"].includes(item));
    if (!valid.includes("mobile")) valid.unshift("mobile");
    assertPlanAllowsModules(valid);
    clean.enabledModules = JSON.stringify(valid);
  }
  await getDb().update(portalSettings).set(clean).where(eq(portalSettings.id, 1));
  await recordActivity(user, "System settings updated", `${user.displayName} updated the portal's operating configuration.`, "settings");
}

export async function issueControllerToken(gateId: string, user: PortalUser) {
  const gate = GATES.find((candidate) => candidate.id === gateId);
  if (!gate) throw new Error("Unknown gate controller.");
  if (!gate.active) throw new Error("Controller setup is blocked until this gate is activated.");
  await ensurePortalSeeded();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await getDb().update(gateStates).set({
    controllerTokenHash: hash,
    commissioned: false,
    controllerState: "uncommissioned",
    lastSeen: null,
    lastError: null,
    updatedAt: nowIso(),
  }).where(eq(gateStates.gateId, gateId));
  await recordActivity(user, "Controller credential issued", `${gate.name} received a new one-time setup credential. Any previous credential was revoked.`, "security");
  return token;
}

export async function controllerTokenValid(gateId: string, token: string) {
  if (!isGateActive(gateId)) return false;
  const rows = await getDb().select({ tokenHash: gateStates.controllerTokenHash }).from(gateStates).where(eq(gateStates.gateId, gateId)).limit(1);
  const expected = rows[0]?.tokenHash;
  if (!expected || !token) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/**
 * Gate cycle counter (24 Oct 2026, Jarrod: "Gate cycles since service" did not count).
 *
 * One cycle is counted each time the controller reports the gate LEAVING its closed
 * reed (closed -> any other reading). Between the reeds the controller reports
 * "unknown" for a movement it did not start (keypad, Compass, exit button) and
 * "moving" for one it did, so both count. This counts every real opening, whatever started
 * it: the portal, the keypad / Compass reader, the exit button or a schedule. Before
 * this, only portal OPEN commands confirmed by the open reed were counted, so keypad
 * openings (most of a school's use) never appeared.
 *
 * The change is claimed with a single conditional UPDATE, so a repeated or
 * concurrent report of the same movement is counted once. A report that carries a
 * fault (for example both reeds made) never counts, and a restarting controller
 * never reports a shut gate as anything but closed. A cycle is missed only if the gate
 * opens and recloses entirely while the controller is not reporting (offline).
 * Counting never throws: a failure here must not stop a heartbeat.
 */
export async function countReedCycle(gateId: string, position: ReportedPosition, hasFault = false): Promise<boolean> {
  if (position === "closed" || hasFault) return false;
  try {
    const left = await getSql().prepare(
      "UPDATE gate_states SET reported_position = ?::text WHERE gate_id = ? AND reported_position = 'closed' RETURNING gate_id",
    ).bind(position, gateId).all<{ gate_id: string }>();
    if (!left.results.length) return false;
    await recordGateOperation(gateId);
    return true;
  } catch {
    console.warn("gate_cycle_count_failed", JSON.stringify({ gateId }));
    return false;
  }
}

/** A Pi CPU temperature the portal will store: finite, -40..125 °C, one decimal. Anything else is null. */
export function plausibleCpuTemp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -40 || value > 125) return null;
  return Math.round(value * 10) / 10;
}

export async function recordHeartbeat(input: {
  gateId: string;
  position: ReportedPosition;
  safetyOk: boolean;
  faults: string[];
  softwareVersion?: string;
  cpuTempC?: number | null;
}): Promise<boolean> {
  const faultText = input.faults.map((fault) => fault.trim()).filter(Boolean).slice(0, 8).join("; ").slice(0, 500);
  const current = await getDb().select({ commissioned: gateStates.commissioned, controllerState: gateStates.controllerState }).from(gateStates).where(eq(gateStates.gateId, input.gateId)).limit(1);
  const hasVerifiedInitialState = heartbeatCompletesCommissioning(input.position, input.safetyOk);
  const commissioned = Boolean(current[0]?.commissioned) || hasVerifiedInitialState;
  await countReedCycle(input.gateId, input.position, Boolean(faultText));
  await getDb().update(gateStates).set({
    reportedPosition: input.position,
    controllerState: faultText || !input.safetyOk ? "fault" : "online",
    commissioned,
    safetyOk: input.safetyOk,
    lastSeen: nowIso(),
    lastError: faultText || (!input.safetyOk ? "Local safety circuit is not healthy." : null),
    softwareVersion: input.softwareVersion?.slice(0, 80),
    cpuTempC: plausibleCpuTemp(input.cpuTempC),
    updatedAt: nowIso(),
  }).where(eq(gateStates.gateId, input.gateId));
  // Fault alert to RJL on the change from healthy to fault (commissioned gates only).
  // Not awaited: an email can never slow or break the controller's poll.
  const nowFault = Boolean(faultText) || !input.safetyOk;
  if (nowFault && commissioned && current[0]?.controllerState !== "fault") {
    void reportGateFault({ gateId: input.gateId, faultText, safetyOk: input.safetyOk });
  }
  return commissioned;
}

/**
 * closeOnly (15 Oct 2026): while the controller reports its local safety circuit as NOT healthy, only a CLOSE is
 * handed out. A CLOSE just releases a hold, which is always the safe direction, and without this a fire / evacuation
 * hold could not be ended remotely while any safety device was tripped. An OPEN is never handed to an unsafe gate.
 */
export async function getNextControllerCommand(gateId: string, options: { closeOnly?: boolean } = {}) {
  if (!isGateActive(gateId)) return null;
  const db = getDb();
  const leaseExpired = new Date(Date.now() - 30_000).toISOString();
  const currentTime = nowIso();
  const commands = await db.select().from(commandQueue).where(and(
    eq(commandQueue.gateId, gateId),
    or(
      eq(commandQueue.state, "queued"),
      and(eq(commandQueue.state, "dispatched"), lt(commandQueue.dispatchedAt, leaseExpired)),
    ),
    gt(commandQueue.expiresAt, currentTime),
    ...(options.closeOnly ? [eq(commandQueue.command, "closed")] : []),
    // Emergency priority (10 Oct 2026 review): while a fire mode is active only
    // emergency packets are handed out. A schedule or booking CLOSE that slipped
    // into the queue just as fire started can never release the fire hold.
    or(eq(commandQueue.source, "emergency"), sql`(SELECT mode FROM system_state WHERE id = 1) = 'normal'`),
  )).orderBy(asc(commandQueue.id)).limit(1);
  const command = commands[0];
  if (!command) return null;
  const d1 = getSql();
  const claimed = await d1.batch([
    // Same emergency rule re-checked inside the claim, atomically with the dispatch.
    d1.prepare("UPDATE command_queue SET state = 'dispatched', dispatched_at = ? WHERE id = ? AND expires_at > ? AND (state = 'queued' OR (state = 'dispatched' AND dispatched_at < ?)) AND (source = 'emergency' OR (SELECT mode FROM system_state WHERE id = 1) = 'normal')" + (options.closeOnly ? " AND command = 'closed'" : "")).bind(currentTime, command.id, currentTime, leaseExpired),
    d1.prepare("UPDATE gate_states SET last_command_state = 'dispatched', updated_at = CURRENT_TIMESTAMP WHERE gate_id = ? AND EXISTS (SELECT 1 FROM command_queue WHERE id = ? AND state = 'dispatched' AND dispatched_at = ?)").bind(gateId, command.id, currentTime),
  ]);
  if (Number(claimed[0]?.meta?.changes ?? 0) === 0) return null;
  return { id: command.id, command: command.command as GatePosition, source: command.source, expiresAt: command.expiresAt, correlationId: command.correlationId };
}

/**
 * Every gate window touching the given Melbourne dates, from all three sources.
 * Used by the controller engine (today) and the calendar feed (a date range),
 * so both always agree.
 */
export async function loadGateWindows(fromDate: string, toDate: string): Promise<GateWindow[]> {
  const db = getDb();
  const d1 = getSql();
  const [scheduleRows, ruleRows] = await Promise.all([
    db.select().from(schedules),
    db.select().from(automationRules),
  ]);
  const scheduleMap = Object.fromEntries(GATES.map((gate) => [gate.id, makeWeekPlan(gate)])) as Record<string, WeekPlan>;
  for (const row of scheduleRows) {
    if (!isGateActive(row.gateId) || !scheduleMap[row.gateId] || !DAYS.includes(row.day as DayKey)) continue;
    scheduleMap[row.gateId][row.day as DayKey] = { enabled: row.enabled, open: row.openTime, close: row.closeTime, label: row.label ?? "" };
  }
  const rules: StoredRule[] = ruleRows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, config: row.config ?? null, enabled: row.enabled }));
  // Bookings from the day before (a run-out can cross midnight) to the day after.
  const from = melbourneToUtc(addDays(fromDate, -1), "00:00").toISOString();
  const to = melbourneToUtc(addDays(toDate, 2), "00:00").toISOString();
  const links = await d1.prepare(
    `SELECT g.booking_id, g.gate_id, g.lead_minutes, g.lag_minutes, o.starts_at, o.ends_at, b.name
       FROM hire_booking_gates g
       JOIN hire_bookings b ON b.id = g.booking_id
       JOIN hire_booking_occurrences o ON o.booking_id = b.id
      WHERE o.cancelled = false AND b.status IN ('confirmed', 'completed')
        AND o.ends_at > ?::timestamptz AND o.starts_at < ?::timestamptz
      ORDER BY o.starts_at
      LIMIT 2000`,
  ).bind(from, to).all<{ booking_id: string; gate_id: string; lead_minutes: number; lag_minutes: number; starts_at: string; ends_at: string; name: string }>();
  const bookings: BookingLink[] = links.results.map((row) => ({
    bookingId: String(row.booking_id), gateId: String(row.gate_id), label: `Hire: ${row.name}`,
    startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(),
    leadMinutes: Number(row.lead_minutes), lagMinutes: Number(row.lag_minutes),
  }));
  const windows: GateWindow[] = [];
  const seen = new Set<string>();
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    for (const window of windowsForDate(date, scheduleMap, rules, bookings)) {
      const id = `${window.ref}@${window.start}`;
      if (seen.has(id)) continue; // a booking crossing midnight touches two dates
      seen.add(id);
      windows.push(window);
    }
  }
  return windows;
}

async function getControllerScheduleDirective(gateId: string) {
  if (!isGateActive(gateId)) return null;
  const db = getDb();
  const modes = await db.select({ mode: systemState.mode }).from(systemState).where(eq(systemState.id, 1)).limit(1);
  // Emergency priority: no automation of any kind while fire mode (or any non-normal mode) is set.
  if ((modes[0]?.mode ?? "normal") !== "normal") return null;
  const now = new Date();
  const today = melbourneDate(now);
  // Yesterday is included so a booking run-out that crosses midnight is still honoured.
  const windows = (await loadGateWindows(addDays(today, -1), today)).filter((window) => Date.parse(window.end) > melbourneToUtc(today, "00:00").getTime());
  const directive = resolveDirective(gateId, windows, now);
  if (directive) return directive;
  // No window today any more, but the gate is still held by an automation OPEN
  // (the only window was paused, deleted or switched off mid-hold). Release it,
  // once; otherwise the controller keeps the hold until HOLD_MAX_S (audit F3).
  const latest = await db.select({ correlationId: commandQueue.correlationId, command: commandQueue.command, source: commandQueue.source, state: commandQueue.state })
    .from(commandQueue).where(eq(commandQueue.gateId, gateId)).orderBy(desc(commandQueue.id)).limit(1);
  const last = latest[0];
  if (last && last.source === "schedule" && last.command === "open" && last.state === "acknowledged") {
    return { target: "closed", key: `${last.correlationId}-released`, reason: "Its automation window was removed or paused" } as const;
  }
  return null;
}

const scheduleOffChecked = new Map<string, number>();
export const SCHEDULE_OFF_CHECK_INTERVAL_MS = 60_000;

/**
 * 24 Oct 2026 (Jarrod: "the gate scheduler doesn't work"). A controller started with
 * SCHEDULE_CONTROL=false (the commissioning setting in the Venus env files) tells the
 * portal not to send schedule commands, and the portal used to skip the window
 * without a word. Now, when a window is due and the controller has schedule control
 * off, the activity log says so, once per window, so the reason is visible.
 * Checked at most once a minute per gate (the controller polls every 750 ms).
 */
export async function noteScheduleControlOff(gateId: string, nowMs = Date.now()): Promise<boolean> {
  const last = scheduleOffChecked.get(gateId) ?? 0;
  if (nowMs - last < SCHEDULE_OFF_CHECK_INTERVAL_MS) return false;
  scheduleOffChecked.set(gateId, nowMs);
  try {
    const directive = await getControllerScheduleDirective(gateId);
    if (!directive || directive.target !== "open") return false;
    const gate = GATES.find((candidate) => candidate.id === gateId);
    const marker = `[window ${directive.key}]`;
    const detail = `${gate?.name ?? gateId}: ${directive.reason} is due now, but this gate's controller has schedule control switched off (SCHEDULE_CONTROL=false on the gate Pi), so the gate was not held open. ${marker}`;
    const result = await getSql().prepare(
      "INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT 'Scheduled window not run', ?, 'schedule', 'Magic Keys schedule', 'system' WHERE NOT EXISTS (SELECT 1 FROM activity_log WHERE category = 'schedule' AND action = 'Scheduled window not run' AND right(detail, length(?::text)) = ?::text)",
    ).bind(detail.slice(0, 1000), marker, marker).run();
    return Number(result?.meta?.changes ?? 0) === 1;
  } catch {
    console.warn("schedule_control_off_note_failed", JSON.stringify({ gateId }));
    return false;
  }
}

/** Test hook: forget the once-a-minute throttle. */
export function resetScheduleOffThrottle() { scheduleOffChecked.clear(); }

/** Re-open limits for one hold window (see reopenCorrelationId). */
export const REOPEN_COOLDOWN_MS = 60_000;
export const REOPEN_MAX_PER_WINDOW = 3;

/**
 * Decide whether an OPEN for the current window should be sent again.
 *
 * The window's first OPEN uses directive.key. If the gate is later reported
 * CLOSED while the window is still running (the Pi restarted and dropped its
 * hold, the hold was released after a network outage, or a safety trip
 * released it), the same key cannot be reused, so a re-open is issued as
 * key:r1, key:r2, … Guards, all required:
 *   - the gate reports "closed" (a definite reed reading, never unknown/moving);
 *   - every earlier command for this window has finished;
 *   - no manual or fire command was sent for this gate after the window's
 *     first OPEN — staff pressing CLOSE ends automation for that window;
 *   - at least REOPEN_COOLDOWN_MS since the last one finished;
 *   - at most REOPEN_MAX_PER_WINDOW re-opens, so a gate that keeps failing
 *     (obstruction, fault) is not hammered.
 * Returns the correlation id to use, or null.
 */
async function reopenCorrelationId(gateId: string, key: string): Promise<string | null> {
  const d1 = getSql();
  const family = await d1.prepare(
    `SELECT id, correlation_id, state, acknowledged_at FROM command_queue
      WHERE gate_id = ? AND (correlation_id = ?::text OR left(correlation_id, length(?::text) + 2) = ?::text || ':r')
      ORDER BY id DESC LIMIT 20`,
  ).bind(gateId, key, key, key).all<{ id: number; correlation_id: string; state: string; acknowledged_at: string | null }>();
  const rows = family.results;
  if (!rows.length) return key; // first OPEN of this window
  if (rows.some((row) => row.state === "queued" || row.state === "dispatched")) return null;
  const reopens = rows.length - 1;
  if (reopens >= REOPEN_MAX_PER_WINDOW) return null;
  const last = rows[0];
  const finishedAt = last.acknowledged_at ? Date.parse(last.acknowledged_at) : NaN;
  if (!Number.isFinite(finishedAt) || Date.now() - finishedAt < REOPEN_COOLDOWN_MS) return null;
  const firstId = Math.min(...rows.map((row) => Number(row.id)));
  const override = await d1.prepare(
    "SELECT 1 AS hit FROM command_queue WHERE gate_id = ? AND id > ? AND source IN ('manual', 'emergency') LIMIT 1",
  ).bind(gateId, firstId).first<{ hit: number }>();
  if (override) return null;
  return `${key}:r${reopens + 1}`;
}

export async function getOrCreateScheduledControllerCommand(gateId: string) {
  const directive = await getControllerScheduleDirective(gateId);
  if (!directive) return null;
  const db = getDb();
  const gateRows = await db.select().from(gateStates).where(eq(gateStates.gateId, gateId)).limit(1);
  const gate = gateRows[0];
  if (!gate || gate.reportedPosition === directive.target) return null;
  // Re-opening is only ever considered on a definite CLOSED reading.
  let correlationId = directive.key;
  let reopening = false;
  if (directive.target === "open") {
    const candidate = await reopenCorrelationId(gateId, directive.key);
    if (!candidate) return getNextControllerCommand(gateId);
    if (candidate !== directive.key) {
      if (gate.reportedPosition !== "closed") return getNextControllerCommand(gateId);
      correlationId = candidate;
      reopening = true;
    }
  }
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const inserted = await db.insert(commandQueue).values({
    correlationId,
    gateId,
    command: directive.target,
    source: "schedule",
    state: "queued",
    requestedBy: "Approved automation",
    expiresAt: expiry,
  }).onConflictDoNothing().returning({ id: commandQueue.id });
  if (inserted[0]) {
    await db.update(gateStates).set({
      commandedPosition: directive.target,
      lastCommandId: inserted[0].id,
      lastCommandState: "queued",
      lastError: null,
      updatedAt: nowIso(),
    }).where(eq(gateStates.gateId, gateId));
    const gateConfig = GATES.find((candidate) => candidate.id === gateId);
    await db.insert(activityLog).values({
      action: reopening ? "Scheduled relay command re-sent" : "Scheduled relay command queued",
      detail: reopening
        ? `${gateConfig?.name ?? gateId}: reported closed during ${directive.reason}, so open was requested again (attempt ${correlationId.split(":r").pop()} of ${REOPEN_MAX_PER_WINDOW}).`
        : `${gateConfig?.name ?? gateId}: ${directive.target} requested by ${directive.reason} (Melbourne time).`,
      category: "schedule",
      actorName: "Magic Keys schedule",
      actorRole: "system",
    });
  }
  return getNextControllerCommand(gateId);
}

export async function acknowledgeControllerCommand(input: {
  gateId: string;
  commandId: number;
  state: "acknowledged" | "failed" | "blocked";
  position: ReportedPosition;
  safetyOk: boolean;
  detail?: string;
}) {
  const db = getDb();
  const rows = await db.select().from(commandQueue).where(and(eq(commandQueue.id, input.commandId), eq(commandQueue.gateId, input.gateId))).limit(1);
  const command = rows[0];
  if (!command) throw new Error("Command not found for this controller.");
  if (!new Set(["queued", "dispatched"]).has(command.state)) return;
  const suppliedDetail = input.detail?.trim().slice(0, 500) || null;
  const validated = validateControllerAcknowledgement({
    expected: command.command as GatePosition,
    state: input.state,
    position: input.position,
    safetyOk: input.safetyOk,
    detail: suppliedDetail,
  });
  const effectiveState = validated.state;
  const detail = validated.detail;
  const gate = GATES.find((candidate) => candidate.id === input.gateId);
  const timestamp = nowIso();
  // The acknowledgement carries a position reading too: count a movement off the closed reed here as well.
  await countReedCycle(input.gateId, input.position);
  const results = await getSql().batch([
    getSql().prepare("UPDATE command_queue SET state = ?, acknowledged_at = ?, detail = ? WHERE id = ? AND gate_id = ? AND state IN ('queued', 'dispatched')").bind(effectiveState, timestamp, detail, input.commandId, input.gateId),
    getSql().prepare("UPDATE gate_states SET reported_position = ?, controller_state = ?, safety_ok = ?, last_seen = ?, last_command_state = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE gate_id = ? AND EXISTS (SELECT 1 FROM command_queue WHERE id = ? AND gate_id = ? AND acknowledged_at = ?)").bind(input.position, effectiveState === "acknowledged" ? "online" : "fault", input.safetyOk ? 1 : 0, timestamp, effectiveState, effectiveState === "acknowledged" ? null : detail || "Controller did not complete the relay command.", input.gateId, input.commandId, input.gateId, timestamp),
    getSql().prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT ?, ?, 'controller', ?, 'device' WHERE EXISTS (SELECT 1 FROM command_queue WHERE id = ? AND gate_id = ? AND acknowledged_at = ?)").bind(
      effectiveState === "acknowledged" ? "Relay command confirmed" : "Relay command not completed",
      `${gate?.name ?? input.gateId}: ${effectiveState}${detail ? ` — ${detail}` : ""}`,
      `Controller ${input.gateId}`,
      input.commandId,
      input.gateId,
      timestamp,
    ),
  ]);
  // Cycles are counted from the reeds (countReedCycle), not from confirmed OPEN
  // commands, so a portal open is not counted twice.
  const completedNow = Number(results[0]?.meta?.changes ?? 0) === 1;
  // A command the controller could not complete is a fault: tell RJL (throttled,
  // not awaited). Covers faults first seen through a command rather than a heartbeat.
  if (completedNow && effectiveState !== "acknowledged") {
    void reportGateFault({ gateId: input.gateId, faultText: detail || `Command ${effectiveState}.`, safetyOk: input.safetyOk });
  }
}

export async function recentFailedLogins(fingerprint: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await getDb().select({ id: authAttempts.id }).from(authAttempts).where(and(
    eq(authAttempts.fingerprint, fingerprint),
    eq(authAttempts.success, false),
    gt(authAttempts.createdAt, since),
  ));
  return rows.length;
}

export type AuthenticationAttemptState = {
  failures: number;
  lastFailureAt: string | null;
  locked: boolean;
  retryAfterSeconds: number;
};

export async function authenticationAttemptState(fingerprint: string): Promise<AuthenticationAttemptState> {
  const row = await getSql().prepare(`
    SELECT COUNT(*) AS failures, MAX(created_at) AS last_failure_at
    FROM auth_attempts
    WHERE fingerprint = ?
      AND success = 0
      AND created_at > COALESCE(
        (SELECT MAX(created_at) FROM auth_attempts WHERE fingerprint = ? AND success = 1),
        '1970-01-01T00:00:00.000Z'
      )
  `).bind(fingerprint, fingerprint).first<{ failures: number; last_failure_at: string | null }>();
  const failures = Number(row?.failures ?? 0);
  const lastFailureAt = row?.last_failure_at ?? null;
  const cooldownEndsAt = lastFailureAt ? new Date(lastFailureAt).getTime() + 10 * 60 * 1000 : 0;
  return {
    failures,
    lastFailureAt,
    locked: failures >= 3,
    retryAfterSeconds: failures === 2 ? Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000)) : 0,
  };
}

export async function recordLoginAttempt(fingerprint: string, success: boolean) {
  await getDb().insert(authAttempts).values({ fingerprint, success, createdAt: nowIso() });
}

export async function clearAuthenticationLockouts(user: PortalUser) {
  await getSql().batch([
    getSql().prepare("DELETE FROM auth_attempts WHERE success = 0"),
    getSql().prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) VALUES ('Legacy authentication lockouts cleared', 'An authorised administrator cleared historical password sign-in counters. Current access remains restricted to approved Google accounts.', 'security', ?, ?)").bind(user.displayName, user.role),
  ]);
}
