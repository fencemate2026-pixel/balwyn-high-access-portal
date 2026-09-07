CREATE TABLE `gates_config` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `area` text NOT NULL,
  `type` text NOT NULL,
  `group` text NOT NULL,
  `default_position` text NOT NULL,
  `force_gate` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `gate_schedules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `gate_id` text NOT NULL,
  `day` text NOT NULL,
  `enabled` integer DEFAULT false NOT NULL,
  `open_time` text NOT NULL,
  `close_time` text NOT NULL,
  FOREIGN KEY (`gate_id`) REFERENCES `gates_config`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `gate_states` (
  `gate_id` text PRIMARY KEY NOT NULL,
  `position` text NOT NULL,
  `perimeter_state` text DEFAULT 'normal' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_operator` text DEFAULT 'system' NOT NULL,
  FOREIGN KEY (`gate_id`) REFERENCES `gates_config`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `activity_log` (
  `id` integer PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `detail` text NOT NULL,
  `operator` text NOT NULL,
  `source` text,
  `timestamp` text NOT NULL
);

CREATE TABLE `automation_rules` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `trigger` text NOT NULL,
  `action` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL
);

CREATE TABLE `detection_events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `source` text NOT NULL,
  `confidence` real NOT NULL,
  `incident_location` text NOT NULL,
  `image_reference` text NOT NULL,
  `camera` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `timestamp` text NOT NULL,
  `notes` text
);

CREATE TABLE `alert_verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `detection_event_id` text NOT NULL,
  `operator` text NOT NULL,
  `decision` text NOT NULL,
  `notes` text NOT NULL,
  `action_taken` text NOT NULL,
  `timestamp` text NOT NULL,
  FOREIGN KEY (`detection_event_id`) REFERENCES `detection_events`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `system_events` (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL,
  `mode` text NOT NULL,
  `detail` text NOT NULL,
  `timestamp` text NOT NULL
);
