CREATE TABLE `claim_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`github_username` text,
	`merged_pr_count` integer,
	`review_message_id` text,
	`review_thread_id` text,
	`decided_at` text,
	`decided_by_id` text,
	`decision_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_claim_requests_guild_user` ON `claim_requests` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_claim_requests_user_id` ON `claim_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_claim_requests_status` ON `claim_requests` (`status`);