import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const perimeter_threat_detections = sqliteTable(
  "perimeter_threat_detections",
  {
    id: text("id").primaryKey(),
    threat_id: text("threat_id").notNull(),
    detection_time: integer("detection_time").notNull(),
    detection_layer: text("detection_layer"),
    threat_location_status: text("threat_location_status"),
    gate_approach: text("gate_approach"),
    distance_from_gate: real("distance_from_gate"),
    approach_speed: real("approach_speed"),
    time_to_gate_contact: real("time_to_gate_contact"),
    detection_confidence: real("detection_confidence"),
    weapon_identified: integer("weapon_identified", { mode: "boolean" }),
    operator_decision: text("operator_decision"),
    operator_id: text("operator_id"),
    all_gates_locked: integer("all_gates_locked", { mode: "boolean" }),
    evacuation_initiated: integer("evacuation_initiated", { mode: "boolean" }),
    occupants_evacuated: integer("occupants_evacuated"),
    created_at: integer("created_at").notNull(),
  },
);

export const evacuation_events = sqliteTable("evacuation_events", {
  id: text("id").primaryKey(),
  threat_id: text("threat_id"),
  evacuation_type: text("evacuation_type"),
  start_time: integer("start_time"),
  end_time: integer("end_time"),
  total_occupancy: integer("total_occupancy"),
  occupancy_evacuated: integer("occupancy_evacuated"),
  evacuation_time_seconds: integer("evacuation_time_seconds"),
  assembly_point: text("assembly_point"),
  created_at: integer("created_at").notNull(),
});
