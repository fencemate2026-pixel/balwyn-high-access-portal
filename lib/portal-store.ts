import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";

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

function nowIso() {
  return new Date().toISOString();
}

export async function ensurePortalSeeded() {
  const d1 = getSql();
  const seeded = await d1.prepare("SELECT id FROM system_state WHERE id = 1").first();
  if (seeded) {
    const registered = await d1.prepare(
      `SELECT COUNT(*) AS count FROM gate_states WHERE gate_id IN (${GATES.map(() => "?").join(", ")})`,
    ).bind(...GATES.map((gate) => gate.id)).first<{ count: number }>();
    if (registered?.count === GATES.length) return;
  }

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

export async function getPortalSnapshot(user: PortalUser): Promise<PortalSnapshot> {
  await ensurePortalSeeded();
  const db = getDb();
  const d1 = getSql();
  const expiry = nowIso();
  await d1.batch([
    d1.prepare("UPDATE gate_states SET last_command_state = 'failed', last_error = 'Command expired before controller confirmation.', updated_at = CURRENT_TIMESTAMP WHERE last_command_id IN (SELECT id FROM command_queue WHERE state IN ('queued', 'dispatched') AND expires_at <= ?)").bind(expiry),
    d1.prepare("UPDATE command_queue SET state = 'failed', acknowledged_at = CURRENT_TIMESTAMP, detail = 'Command expired before controller confirmation.' WHERE state IN ('queued', 'dispatched') AND expires_at <= ?").bind(expiry),
  ]);
  const [systemRows, gateRows, scheduleRows, activityRows, ruleRows, settingRows] = await Promise.all([
    db.select().from(systemState).where(eq(systemState.id, 1)).limit(1),
    db.select().from(gateStates).orderBy(asc(gateStates.gateId)),
    db.select().from(schedules).orderBy(asc(schedules.gateId), asc(schedules.id)),
    db.select().from(activityLog).orderBy(desc(activityLog.id)).limit(200),
    db.select().from(automationRules).orderBy(asc(automationRules.id)),
    db.select().from(portalSettings).where(eq(portalSettings.id, 1)).limit(1),
  ]);

  const scheduleMap = Object.fromEntries(GATES.map((gate) => [gate.id, makeWeekPlan(gate)])) as Record<string, WeekPlan>;
  for (const row of scheduleRows) {
    if (!isGateActive(row.gateId) || !scheduleMap[row.gateId] || !DAYS.includes(row.day as DayKey)) continue;
    scheduleMap[row.gateId][row.day as DayKey] = { enabled: row.enabled, open: row.openTime, close: row.closeTime };
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
    automations: ruleRows.map((row) => ({ id: row.id, name: row.name, trigger: row.trigger, action: row.action, enabled: row.enabled })),
    settings: {
      positionMonitoring: setting?.positionMonitoring ?? true,
      faultAlerts: setting?.faultAlerts ?? true,
      voiceAnnouncements: setting?.voiceAnnouncements ?? true,
      enabledModules: enabledModules.filter((module) => planAllowsModule(module, plan)),
    },
    user,
    serverTime: nowIso(),
  };
}

export async function recordActivity(user: PortalUser, action: string, detail: string, category: string) {
  await getDb().insert(activityLog).values({
    action,
    detail,
    category,
    actorName: user.displayName,
    actorRole: user.role,
  });
}

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
  const expiry = new Date(Date.now() + 2 * 60 * 1000).toISOString();
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
      : "INSERT INTO command_queue (correlation_id, gate_id, command, source, state, requested_by, expires_at) SELECT ?, ?, ?, ?, 'queued', ?, ? WHERE NOT EXISTS (SELECT 1 FROM command_queue WHERE gate_id = ? AND state IN ('queued', 'dispatched'))";
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
  await d1.batch(statements);
  return { correlationId, queuedCount: validIds.length };
}

export async function clearEmergencyPriority(user: PortalUser) {
  const d1 = getSql();
  await d1.batch([
    d1.prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT 'Emergency priority cleared', ? || ' cleared ' || mode || ' priority. Queued emergency packets were cancelled. Already-collected packets remain in flight and cannot be recalled by the portal. Gate positions were not declared safe.', 'emergency-clear', ?, ? FROM system_state WHERE id = 1").bind(user.displayName, user.displayName, user.role),
    d1.prepare("UPDATE gate_states SET last_command_state = 'failed', last_error = 'Emergency packet cancelled before controller collection when portal priority was cleared.', updated_at = CURRENT_TIMESTAMP WHERE last_command_id IN (SELECT id FROM command_queue WHERE source = 'emergency' AND state = 'queued')"),
    d1.prepare("UPDATE command_queue SET state = 'failed', acknowledged_at = CURRENT_TIMESTAMP, detail = 'Cancelled before controller collection when emergency priority was cleared.' WHERE source = 'emergency' AND state = 'queued'"),
    d1.prepare("UPDATE system_state SET mode = 'normal', updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1").bind(user.displayName),
  ]);
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
    return d1.prepare(
      "INSERT INTO gate_schedules (gate_id, day, enabled, open_time, close_time, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(gate_id, day) DO UPDATE SET enabled = excluded.enabled, open_time = excluded.open_time, close_time = excluded.close_time, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by",
    ).bind(gateId, day, plan.enabled ? 1 : 0, open, close, user.displayName);
  });
  await d1.batch(statements);
  const gate = GATES.find((candidate) => candidate.id === gateId)!;
  await recordActivity(user, "Gate schedule updated", `${gate.name}'s weekly operating schedule was saved.`, "schedule");
}

export async function addAutomationRule(rule: Omit<AutomationRule, "id" | "enabled">, user: PortalUser) {
  const name = rule.name.trim().slice(0, 80);
  const trigger = rule.trigger.trim().slice(0, 160);
  const action = rule.action.trim().slice(0, 160);
  if (!name || !trigger || !action) throw new Error("Name, trigger and action are required.");
  await getDb().insert(automationRules).values({ name, trigger, action, enabled: true, updatedBy: user.displayName });
  await recordActivity(user, "Automation rule added", `${user.displayName} created “${name}”.`, "automation");
}

export async function setAutomationRuleState(id: number, enabled: boolean, user: PortalUser) {
  const rows = await getDb().select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
  if (!rows[0]) throw new Error("Automation rule not found.");
  await getDb().update(automationRules).set({ enabled, updatedAt: nowIso(), updatedBy: user.displayName }).where(eq(automationRules.id, id));
  await recordActivity(user, `Automation ${enabled ? "enabled" : "paused"}`, `${user.displayName} updated “${rows[0].name}”.`, "automation");
}

export async function removeAutomationRule(id: number, user: PortalUser) {
  const rows = await getDb().select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
  if (!rows[0]) throw new Error("Automation rule not found.");
  await getDb().delete(automationRules).where(eq(automationRules.id, id));
  await recordActivity(user, "Automation rule removed", `${user.displayName} removed “${rows[0].name}”.`, "automation");
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

export async function recordHeartbeat(input: {
  gateId: string;
  position: ReportedPosition;
  safetyOk: boolean;
  faults: string[];
  softwareVersion?: string;
}): Promise<boolean> {
  const faultText = input.faults.map((fault) => fault.trim()).filter(Boolean).slice(0, 8).join("; ").slice(0, 500);
  const current = await getDb().select({ commissioned: gateStates.commissioned }).from(gateStates).where(eq(gateStates.gateId, input.gateId)).limit(1);
  const hasVerifiedInitialState = heartbeatCompletesCommissioning(input.position, input.safetyOk);
  const commissioned = Boolean(current[0]?.commissioned) || hasVerifiedInitialState;
  await getDb().update(gateStates).set({
    reportedPosition: input.position,
    controllerState: faultText || !input.safetyOk ? "fault" : "online",
    commissioned,
    safetyOk: input.safetyOk,
    lastSeen: nowIso(),
    lastError: faultText || (!input.safetyOk ? "Local safety circuit is not healthy." : null),
    softwareVersion: input.softwareVersion?.slice(0, 80),
    updatedAt: nowIso(),
  }).where(eq(gateStates.gateId, input.gateId));
  return commissioned;
}

export async function getNextControllerCommand(gateId: string) {
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
  )).orderBy(asc(commandQueue.id)).limit(1);
  const command = commands[0];
  if (!command) return null;
  const d1 = getSql();
  const claimed = await d1.batch([
    d1.prepare("UPDATE command_queue SET state = 'dispatched', dispatched_at = ? WHERE id = ? AND expires_at > ? AND (state = 'queued' OR (state = 'dispatched' AND dispatched_at < ?))").bind(currentTime, command.id, currentTime, leaseExpired),
    d1.prepare("UPDATE gate_states SET last_command_state = 'dispatched', updated_at = CURRENT_TIMESTAMP WHERE gate_id = ? AND EXISTS (SELECT 1 FROM command_queue WHERE id = ? AND state = 'dispatched' AND dispatched_at = ?)").bind(gateId, command.id, currentTime),
  ]);
  if (Number(claimed[0]?.meta?.changes ?? 0) === 0) return null;
  return { id: command.id, command: command.command as GatePosition, expiresAt: command.expiresAt, correlationId: command.correlationId };
}

async function getControllerScheduleDirective(gateId: string): Promise<{ target: GatePosition; key: string } | null> {
  if (!isGateActive(gateId)) return null;
  const db = getDb();
  const modes = await db.select({ mode: systemState.mode }).from(systemState).where(eq(systemState.id, 1)).limit(1);
  if ((modes[0]?.mode ?? "normal") !== "normal") return null;
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const day = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!day || !hour || !minute) return null;
  const rows = await db.select().from(schedules).where(and(eq(schedules.gateId, gateId), eq(schedules.day, day))).limit(1);
  const plan = rows[0];
  if (!plan?.enabled) return null;
  const current = `${hour}:${minute}`;
  const target = current >= plan.openTime && current < plan.closeTime ? "open" : "closed";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { target, key: `schedule-${gateId}-${localDate}-${target}-${plan.updatedAt.replace(/[^0-9]/g, "")}` };
}

export async function getOrCreateScheduledControllerCommand(gateId: string) {
  const directive = await getControllerScheduleDirective(gateId);
  if (!directive) return null;
  const db = getDb();
  const gateRows = await db.select().from(gateStates).where(eq(gateStates.gateId, gateId)).limit(1);
  const gate = gateRows[0];
  if (!gate || gate.reportedPosition === directive.target) return null;
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const inserted = await db.insert(commandQueue).values({
    correlationId: directive.key,
    gateId,
    command: directive.target,
    source: "schedule",
    state: "queued",
    requestedBy: "Approved schedule",
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
      action: "Scheduled relay command queued",
      detail: `${gateConfig?.name ?? gateId}: ${directive.target} requested by the approved Melbourne-time schedule.`,
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
  await getSql().batch([
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
