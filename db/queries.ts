import { desc } from "drizzle-orm";

import {
  activityLog,
  alertVerifications,
  automationRules,
  detectionEvents,
  gateSchedules,
  gatesConfig,
  gateStates,
  systemEvents,
} from "@/db/schema";
import type { Gate, PersistedPortalState, WeekPlan } from "@/lib/portal-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PortalDb = any;

export async function seedGatesConfiguration(db: PortalDb, gates: Gate[]) {
  for (const gate of gates) {
    await db
      .insert(gatesConfig)
      .values({
        id: gate.id,
        name: gate.name,
        area: gate.area,
        type: gate.type,
        group: gate.group,
        defaultPosition: gate.defaultPosition,
        forceGate: gate.forceGate ?? false,
      })
      .onConflictDoUpdate({
        target: gatesConfig.id,
        set: {
          name: gate.name,
          area: gate.area,
          type: gate.type,
          group: gate.group,
          defaultPosition: gate.defaultPosition,
          forceGate: gate.forceGate ?? false,
        },
      });
  }
}

function flattenSchedules(schedules: Record<string, WeekPlan>) {
  return Object.entries(schedules).flatMap(([gateId, week]) =>
    Object.entries(week).map(([day, plan]) => ({
      gateId,
      day,
      enabled: plan.enabled,
      openTime: plan.open,
      closeTime: plan.close,
    })),
  );
}

export async function syncPortalState(
  db: PortalDb,
  snapshot: PersistedPortalState,
  gates: Gate[],
  operator: string,
) {
  await seedGatesConfiguration(db, gates);

  await db.delete(gateSchedules);
  const scheduleRows = flattenSchedules(snapshot.schedules);
  if (scheduleRows.length) await db.insert(gateSchedules).values(scheduleRows);

  for (const gate of gates) {
    await db
      .insert(gateStates)
      .values({
        gateId: gate.id,
        position: snapshot.gateOverrides[gate.id] ?? gate.defaultPosition,
        perimeterState: snapshot.perimeterStates[gate.id] ?? "normal",
        updatedAt: new Date().toISOString(),
        lastOperator: operator,
      })
      .onConflictDoUpdate({
        target: gateStates.gateId,
        set: {
          position: snapshot.gateOverrides[gate.id] ?? gate.defaultPosition,
          perimeterState: snapshot.perimeterStates[gate.id] ?? "normal",
          updatedAt: new Date().toISOString(),
          lastOperator: operator,
        },
      });
  }

  for (const rule of snapshot.automations) {
    await db
      .insert(automationRules)
      .values(rule)
      .onConflictDoUpdate({
        target: automationRules.id,
        set: {
          name: rule.name,
          trigger: rule.trigger,
          action: rule.action,
          enabled: rule.enabled,
        },
      });
  }

  for (const record of snapshot.activity) {
    await db
      .insert(activityLog)
      .values({
        id: record.id,
        action: record.action,
        detail: record.detail,
        operator,
        source: record.source,
        timestamp: record.timestamp,
      })
      .onConflictDoUpdate({
        target: activityLog.id,
        set: {
          action: record.action,
          detail: record.detail,
          operator,
          source: record.source,
          timestamp: record.timestamp,
        },
      });
  }

  for (const event of snapshot.detectionEvents) {
    await db
      .insert(detectionEvents)
      .values({
        id: event.id,
        type: event.type,
        source: event.source,
        confidence: event.confidence,
        incidentLocation: event.incidentLocation,
        imageReference: event.snapshotLabel,
        camera: event.camera,
        status: event.status,
        timestamp: event.timestamp,
        notes: event.notes,
      })
      .onConflictDoUpdate({
        target: detectionEvents.id,
        set: {
          type: event.type,
          source: event.source,
          confidence: event.confidence,
          incidentLocation: event.incidentLocation,
          imageReference: event.snapshotLabel,
          camera: event.camera,
          status: event.status,
          timestamp: event.timestamp,
          notes: event.notes,
        },
      });
  }

  for (const verification of snapshot.alertVerifications) {
    await db
      .insert(alertVerifications)
      .values(verification)
      .onConflictDoUpdate({
        target: alertVerifications.id,
        set: {
          detectionEventId: verification.detectionEventId,
          operator: verification.operator,
          decision: verification.decision,
          notes: verification.notes,
          actionTaken: verification.actionTaken,
          timestamp: verification.timestamp,
        },
      });
  }

  for (const event of snapshot.systemEvents) {
    await db
      .insert(systemEvents)
      .values(event)
      .onConflictDoUpdate({
        target: systemEvents.id,
        set: {
          category: event.category,
          mode: event.mode,
          detail: event.detail,
          timestamp: event.timestamp,
        },
      });
  }
}

export async function getPersistedPortalState(db: PortalDb): Promise<Partial<PersistedPortalState>> {
  const [
    scheduleRows,
    stateRows,
    automationRows,
    activityRows,
    detectionRows,
    verificationRows,
    systemEventRows,
  ] = await Promise.all([
    db.select().from(gateSchedules),
    db.select().from(gateStates),
    db.select().from(automationRules),
    db.select().from(activityLog).orderBy(desc(activityLog.timestamp), desc(activityLog.id)).limit(150),
    db.select().from(detectionEvents).orderBy(desc(detectionEvents.timestamp)).limit(50),
    db.select().from(alertVerifications).orderBy(desc(alertVerifications.timestamp)).limit(50),
    db.select().from(systemEvents).orderBy(desc(systemEvents.timestamp)).limit(50),
  ]);

  const schedules = (scheduleRows as Array<typeof gateSchedules.$inferSelect>).reduce(
    (accumulator, row) => {
      accumulator[row.gateId] ??= {} as WeekPlan;
      accumulator[row.gateId][row.day as keyof WeekPlan] = {
        enabled: row.enabled,
        open: row.openTime,
        close: row.closeTime,
      };
      return accumulator;
    },
    {} as Record<string, WeekPlan>,
  );
  const typedStateRows = stateRows as Array<typeof gateStates.$inferSelect>;
  const typedAutomationRows = automationRows as PersistedPortalState["automations"];
  const typedActivityRows = activityRows as Array<typeof activityLog.$inferSelect>;
  const typedDetectionRows = detectionRows as Array<typeof detectionEvents.$inferSelect>;
  const typedVerificationRows =
    verificationRows as PersistedPortalState["alertVerifications"];
  const typedSystemEventRows = systemEventRows as PersistedPortalState["systemEvents"];

  return {
    systemMode:
      (typedSystemEventRows[0]?.mode ?? "normal") as PersistedPortalState["systemMode"],
    gateOverrides: Object.fromEntries(
      typedStateRows.map((row) => [
        row.gateId,
        row.position as PersistedPortalState["gateOverrides"][string],
      ]),
    ) as PersistedPortalState["gateOverrides"],
    perimeterStates: Object.fromEntries(
      typedStateRows.map((row) => [
        row.gateId,
        row.perimeterState as PersistedPortalState["perimeterStates"][string],
      ]),
    ) as PersistedPortalState["perimeterStates"],
    schedules,
    automations: typedAutomationRows,
    activity: typedActivityRows.map((row) => ({
      id: row.id,
      action: row.action,
      detail: row.detail,
      source: row.source ?? undefined,
      timestamp: row.timestamp,
      time: new Intl.DateTimeFormat("en-AU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Australia/Melbourne",
      }).format(new Date(row.timestamp)),
    })),
    detectionEvents: typedDetectionRows.map((row) => ({
      id: row.id,
      type: row.type as PersistedPortalState["detectionEvents"][number]["type"],
      source: row.source,
      confidence: row.confidence,
      incidentLocation: row.incidentLocation,
      snapshotLabel: row.imageReference,
      camera: row.camera,
      status: row.status as PersistedPortalState["detectionEvents"][number]["status"],
      timestamp: row.timestamp,
      notes: row.notes ?? undefined,
    })),
    alertVerifications: typedVerificationRows,
    systemEvents: typedSystemEventRows,
  };
}

export async function listActivityAuditTrail(db: PortalDb, limit = 100) {
  return db.select().from(activityLog).orderBy(desc(activityLog.timestamp)).limit(limit);
}
