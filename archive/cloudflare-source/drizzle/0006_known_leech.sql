CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`account_key` text NOT NULL,
	`display_name` text NOT NULL,
	`username` text,
	`contact_email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`avatar_key` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_profiles_account` ON `user_profiles` (`account_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_profiles_username` ON `user_profiles` (`username`);