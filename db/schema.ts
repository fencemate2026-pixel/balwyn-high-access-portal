import { relations, sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gatesConfig = sqliteTable("gates_config", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  area: text("area").notNull(),
  type: text("type").notNull(),
  group: text("group").notNull(),
  defaultPosition: text("default_position").notNull(),
  forceGate: integer("force_gate", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const gateSchedules = sqliteTable("gate_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gateId: text("gate_id")
    .notNull()
    .references(() => gatesConfig.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
});

export const gateStates = sqliteTable("gate_states", {
  gateId: text("gate_id")
    .primaryKey()
    .references(() => gatesConfig.id, { onDelete: "cascade" }),
  position: text("position").notNull(),
  perimeterState: text("perimeter_state").notNull().default("normal"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastOperator: text("last_operator").notNull().default("system"),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  operator: text("operator").notNull(),
  source: text("source"),
  timestamp: text("timestamp").notNull(),
});

export const automationRules = sqliteTable("automation_rules", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const detectionEvents = sqliteTable("detection_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  source: text("source").notNull(),
  confidence: real("confidence").notNull(),
  incidentLocation: text("incident_location").notNull(),
  imageReference: text("image_reference").notNull(),
  camera: text("camera").notNull(),
  status: text("status").notNull().default("pending"),
  timestamp: text("timestamp").notNull(),
  notes: text("notes"),
});

export const alertVerifications = sqliteTable("alert_verifications", {
  id: text("id").primaryKey(),
  detectionEventId: text("detection_event_id")
    .notNull()
    .references(() => detectionEvents.id, { onDelete: "cascade" }),
  operator: text("operator").notNull(),
  decision: text("decision").notNull(),
  notes: text("notes").notNull(),
  actionTaken: text("action_taken").notNull(),
  timestamp: text("timestamp").notNull(),
});

export const systemEvents = sqliteTable("system_events", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  mode: text("mode").notNull(),
  detail: text("detail").notNull(),
  timestamp: text("timestamp").notNull(),
});

export const gatesConfigRelations = relations(gatesConfig, ({ many, one }) => ({
  schedules: many(gateSchedules),
  state: one(gateStates, {
    fields: [gatesConfig.id],
    references: [gateStates.gateId],
  }),
}));

export const gateSchedulesRelations = relations(gateSchedules, ({ one }) => ({
  gate: one(gatesConfig, {
    fields: [gateSchedules.gateId],
    references: [gatesConfig.id],
  }),
}));

export const gateStatesRelations = relations(gateStates, ({ one }) => ({
  gate: one(gatesConfig, {
    fields: [gateStates.gateId],
    references: [gatesConfig.id],
  }),
}));

export const detectionEventsRelations = relations(detectionEvents, ({ many }) => ({
  verifications: many(alertVerifications),
}));

export const alertVerificationsRelations = relations(alertVerifications, ({ one }) => ({
  detectionEvent: one(detectionEvents, {
    fields: [alertVerifications.detectionEventId],
    references: [detectionEvents.id],
  }),
}));
