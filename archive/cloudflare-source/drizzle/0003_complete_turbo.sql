CREATE TABLE `operator_totp` (
	`username` text PRIMARY KEY NOT NULL,
	`encrypted_secret` text NOT NULL,
	`enrolled_at` text,
	`last_used_counter` integer DEFAULT -1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
