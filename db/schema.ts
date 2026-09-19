import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const systemState = sqliteTable("system_state", {
  id: integer("id").primaryKey(),
  mode: text("mode").notNull().default("normal"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const gateStates = sqliteTable("gate_states", {
  gateId: text("gate_id").primaryKey(),
  commandedPosition: text("commanded_position").notNull().default("closed"),
  reportedPosition: text("reported_position").notNull().default("unknown"),
  controllerState: text("controller_state").notNull().default("uncommissioned"),
  commissioned: integer("commissioned", { mode: "boolean" }).notNull().default(false),
  safetyOk: integer("safety_ok", { mode: "boolean" }),
  controllerTokenHash: text("controller_token_hash"),
  lastSeen: text("last_seen"),
  lastCommandId: integer("last_command_id"),
  lastCommandState: text("last_command_state").notNull().default("idle"),
  lastError: text("last_error"),
  softwareVersion: text("software_version"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const schedules = sqliteTable("gate_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gateId: text("gate_id").notNull(),
  day: text("day").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull().default("system"),
}, (table) => [
  uniqueIndex("idx_gate_schedules_gate_day").on(table.gateId, table.day),
]);

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  category: text("category").notNull(),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_activity_log_created_at").on(table.createdAt),
]);

export const automationRules = sqliteTable("automation_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull().default("system"),
}, (table) => [
  uniqueIndex("idx_automation_rules_name").on(table.name),
]);

export const portalSettings = sqliteTable("portal_settings", {
  id: integer("id").primaryKey(),
  positionMonitoring: integer("position_monitoring", { mode: "boolean" }).notNull().default(true),
  faultAlerts: integer("fault_alerts", { mode: "boolean" }).notNull().default(true),
  voiceAnnouncements: integer("voice_announcements", { mode: "boolean" }).notNull().default(true),
  equipment: text("equipment"),
  enabledModules: text("enabled_modules").notNull().default('["mobile"]'),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const commandQueue = sqliteTable("command_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  correlationId: text("correlation_id").notNull(),
  gateId: text("gate_id").notNull(),
  command: text("command").notNull(),
  source: text("source").notNull().default("manual"),
  state: text("state").notNull().default("queued"),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  dispatchedAt: text("dispatched_at"),
  acknowledgedAt: text("acknowledged_at"),
  detail: text("detail"),
}, (table) => [
  uniqueIndex("idx_command_queue_correlation_gate").on(table.correlationId, table.gateId),
  index("idx_command_queue_gate_state").on(table.gateId, table.state),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fingerprint: text("fingerprint").notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_auth_attempts_fingerprint_time").on(table.fingerprint, table.createdAt),
]);

export const operatorTotp = sqliteTable("operator_totp", {
  username: text("username").primaryKey(),
  encryptedSecret: text("encrypted_secret").notNull(),
  enrolledAt: text("enrolled_at"),
  lastUsedCounter: integer("last_used_counter").notNull().default(-1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const googleLoginChallenges = sqliteTable("google_login_challenges", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("idx_google_login_challenges_expiry").on(table.expiresAt),
]);

export const microsoftLoginChallenges = sqliteTable("microsoft_login_challenges", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  nonce: text("nonce").notNull(),
  verifier: text("verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("idx_microsoft_login_challenges_expiry").on(table.expiresAt),
]);

export const userProfiles = sqliteTable("user_profiles", {
  id: text("id").primaryKey(),
  accountKey: text("account_key").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  contactEmail: text("contact_email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  jobTitle: text("job_title").notNull().default(""),
  avatarKey: text("avatar_key"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_user_profiles_account").on(table.accountKey),
  uniqueIndex("idx_user_profiles_username").on(table.username),
]);
