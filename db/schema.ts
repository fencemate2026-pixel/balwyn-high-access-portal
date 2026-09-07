import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const threatDetections = sqliteTable("threat_detections", {
  id: text("id").primaryKey(),
  threatId: text("threat_id").notNull(),
  detectionTime: integer("detection_time").notNull(),
  thermalConfidence: real("thermal_confidence"),
  radarConfidence: real("radar_confidence"),
  videoConfidence: real("video_confidence"),
  layer1SensorFusion: real("layer_1_sensor_fusion"),
  layer2Occupancy: real("layer_2_occupancy"),
  layer3Historical: real("layer_3_historical"),
  layer4Secondary: real("layer_4_secondary"),
  layer5Safety: real("layer_5_safety"),
  finalConfidence: real("final_confidence"),
  meets98Threshold: integer("meets_98_threshold", { mode: "boolean" }),
  recommendation: text("recommendation"),
  recommendationEligible: integer("recommendation_eligible", { mode: "boolean" }),
  operatorDecision: text("operator_decision"),
  operatorId: text("operator_id"),
  decisionTime: integer("decision_time"),
  createdAt: integer("created_at").notNull(),
});

export const confidenceScoringLog = sqliteTable("confidence_scoring_log", {
  id: text("id").primaryKey(),
  threatId: text("threat_id"),
  layerName: text("layer_name"),
  score: real("score"),
  threshold: real("threshold"),
  meetsThreshold: integer("meets_threshold", { mode: "boolean" }),
  reasoning: text("reasoning"),
  timestamp: integer("timestamp").notNull(),
});
