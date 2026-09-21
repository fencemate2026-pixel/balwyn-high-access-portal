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
  // Production already holds the imported register. A COUNT(*) from Postgres
  // arrives as a string/bigint, so the old === GATES.length check never matched
  // and every Google login re-ran the seed INSERT batch.
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
