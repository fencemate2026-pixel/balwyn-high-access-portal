CREATE TABLE `microsoft_login_challenges` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_microsoft_login_challenges_expiry` ON `microsoft_login_challenges` (`expires_at`);