import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const perimeterThreats = sqliteTable("perimeter_threats", {
  id: text("id").primaryKey(),
  detectedAt: text("detected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  threatType: text("threat_type").notNull(),
  location: text("location").notNull(),
  detectedZone: text("detected_zone").notNull(),
  thermalConfidencePercent: real("thermal_confidence_percent").notNull(),
  radarConfidencePercent: real("radar_confidence_percent").notNull(),
  videoConfidencePercent: real("video_confidence_percent").notNull(),
  sensorFusionConfidencePercent: real("sensor_fusion_confidence_percent").notNull(),
  historicalAccuracyPercent: real("historical_accuracy_percent").notNull(),
  recommendationConfidencePercent: real("recommendation_confidence_percent").notNull(),
  approachSpeedMps: real("approach_speed_mps"),
  etaToPerimeterSeconds: real("eta_to_perimeter_seconds"),
  predictedDestination: text("predicted_destination"),
  recommendedStrategy: text("recommended_strategy"),
  operatorApprovalRequired: integer("operator_approval_required", { mode: "boolean" })
    .notNull()
    .default(true),
});

export const emergencyResponses = sqliteTable("emergency_responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threatId: text("threat_id")
    .notNull()
    .references(() => perimeterThreats.id, { onDelete: "cascade" }),
  strategy: text("strategy").notNull(),
  operatorId: text("operator_id").notNull(),
  approved: integer("approved", { mode: "boolean" }).notNull(),
  lockDurationMs: integer("lock_duration_ms"),
  evacuationProgressPercent: real("evacuation_progress_percent"),
  policeAlerted: integer("police_alerted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  auditTrailJson: text("audit_trail_json").notNull(),
});

export const aiLearningLog = sqliteTable("ai_learning_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threatId: text("threat_id")
    .notNull()
    .references(() => perimeterThreats.id, { onDelete: "cascade" }),
  learningCategory: text("learning_category").notNull(),
  learnedDataJson: text("learned_data_json").notNull(),
  effectivenessScorePercent: real("effectiveness_score_percent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
