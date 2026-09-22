CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`category` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_log_created_at` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_attempts_fingerprint_time` ON `auth_attempts` (`fingerprint`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`action` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`correlation_id` text NOT NULL,
	`gate_id` text NOT NULL,
	`command` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`dispatched_at` text,
	`acknowledged_at` text,
	`detail` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_command_queue_correlation_gate` ON `command_queue` (`correlation_id`,`gate_id`);--> statement-breakpoint
CREATE INDEX `idx_command_queue_gate_state` ON `command_queue` (`gate_id`,`state`);--> statement-breakpoint
CREATE TABLE `gate_states` (
	`gate_id` text PRIMARY KEY NOT NULL,
	`commanded_position` text DEFAULT 'closed' NOT NULL,
	`reported_position` text DEFAULT 'unknown' NOT NULL,
	`controller_state` text DEFAULT 'uncommissioned' NOT NULL,
	`commissioned` integer DEFAULT false NOT NULL,
	`safety_ok` integer,
	`controller_token_hash` text,
	`last_seen` text,
	`last_command_id` integer,
	`last_command_state` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`software_version` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`position_monitoring` integer DEFAULT true NOT NULL,
	`fault_alerts` integer DEFAULT true NOT NULL,
	`voice_announcements` integer DEFAULT true NOT NULL,
	`enabled_modules` text DEFAULT '["mobile"]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gate_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gate_id` text NOT NULL,
	`day` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`open_time` text NOT NULL,
	`close_time` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gate_schedules_gate_day` ON `gate_schedules` (`gate_id`,`day`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'normal' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
