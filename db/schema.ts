import { sql } from "drizzle-orm";
import { bigint, customType, index, integer, pgSchema, text, uniqueIndex } from "drizzle-orm/pg-core";

const portal = pgSchema("balwyn_portal");
// Keep 0/1 storage compatible with the imported portal records and raw statements.
const integerBoolean = customType<{ data: boolean; driverData: number }>({
  dataType: () => "integer",
  toDriver: value => value ? 1 : 0,
  fromDriver: value => Number(value) === 1,
});

export const systemState = portal.table("system_state", {
  id: integer("id").primaryKey(),
  mode: text("mode").notNull().default("normal"),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const gateStates = portal.table("gate_states", {
  gateId: text("gate_id").primaryKey(),
  commandedPosition: text("commanded_position").notNull().default("closed"),
  reportedPosition: text("reported_position").notNull().default("unknown"),
  controllerState: text("controller_state").notNull().default("uncommissioned"),
  commissioned: integerBoolean("commissioned").notNull().default(false),
  safetyOk: integerBoolean("safety_ok"),
  controllerTokenHash: text("controller_token_hash"),
  lastSeen: text("last_seen"),
  lastCommandId: integer("last_command_id"),
  lastCommandState: text("last_command_state").notNull().default("idle"),
  lastError: text("last_error"),
  softwareVersion: text("software_version"),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
});

export const schedules = portal.table("gate_schedules", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  gateId: text("gate_id").notNull(),
  day: text("day").notNull(),
  enabled: integerBoolean("enabled").notNull().default(false),
  openTime: text("open_time").notNull(),
  closeTime: text("close_time").notNull(),
  /** Optional name for the day's window (display only, max SCHEDULE_LABEL_MAX). */
  label: text("label").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  updatedBy: text("updated_by").notNull().default("system"),
}, (table) => [
  uniqueIndex("idx_gate_schedules_gate_day").on(table.gateId, table.day),
]);

export const activityLog = portal.table("activity_log", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  category: text("category").notNull(),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  createdAt: text("created_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
}, (table) => [
  index("idx_activity_log_created_at").on(table.createdAt),
]);

export const automationRules = portal.table("automation_rules", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  /** "note" (stored text, never executed) or "gate_window" (see lib/gate-windows.ts). */
  kind: text("kind").notNull().default("note"),
  /** JSON config for executable kinds; validated by parseGateWindowConfig before storage and again before use. */
  config: text("config"),
  enabled: integerBoolean("enabled").notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  updatedBy: text("updated_by").notNull().default("system"),
}, (table) => [
  uniqueIndex("idx_automation_rules_name").on(table.name),
]);

export const portalSettings = portal.table("portal_settings", {
  id: integer("id").primaryKey(),
  positionMonitoring: integerBoolean("position_monitoring").notNull().default(true),
  faultAlerts: integerBoolean("fault_alerts").notNull().default(true),
  voiceAnnouncements: integerBoolean("voice_announcements").notNull().default(true),
  equipment: text("equipment"),
  enabledModules: text("enabled_modules").notNull().default('["mobile"]'),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const commandQueue = portal.table("command_queue", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  correlationId: text("correlation_id").notNull(),
  gateId: text("gate_id").notNull(),
  command: text("command").notNull(),
  source: text("source").notNull().default("manual"),
  state: text("state").notNull().default("queued"),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  expiresAt: text("expires_at").notNull(),
  dispatchedAt: text("dispatched_at"),
  acknowledgedAt: text("acknowledged_at"),
  detail: text("detail"),
}, (table) => [
  uniqueIndex("idx_command_queue_correlation_gate").on(table.correlationId, table.gateId),
  index("idx_command_queue_gate_state").on(table.gateId, table.state),
]);

export const authAttempts = portal.table("auth_attempts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  fingerprint: text("fingerprint").notNull(),
  success: integerBoolean("success").notNull(),
  createdAt: text("created_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
}, (table) => [
  index("idx_auth_attempts_fingerprint_time").on(table.fingerprint, table.createdAt),
]);

export const operatorTotp = portal.table("operator_totp", {
  username: text("username").primaryKey(),
  encryptedSecret: text("encrypted_secret").notNull(),
  enrolledAt: text("enrolled_at"),
  lastUsedCounter: integer("last_used_counter").notNull().default(-1),
  createdAt: text("created_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
});

export const googleLoginChallenges = portal.table("google_login_challenges", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => [
  index("idx_google_login_challenges_expiry").on(table.expiresAt),
]);

export const microsoftLoginChallenges = portal.table("microsoft_login_challenges", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  nonce: text("nonce").notNull(),
  verifier: text("verifier").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => [
  index("idx_microsoft_login_challenges_expiry").on(table.expiresAt),
]);

export const userProfiles = portal.table("user_profiles", {
  id: text("id").primaryKey(),
  accountKey: text("account_key").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  contactEmail: text("contact_email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  jobTitle: text("job_title").notNull().default(""),
  avatarKey: text("avatar_key"),
  updatedAt: text("updated_at").notNull().default(sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
}, (table) => [
  uniqueIndex("idx_user_profiles_account").on(table.accountKey),
  uniqueIndex("idx_user_profiles_username").on(table.username),
]);
