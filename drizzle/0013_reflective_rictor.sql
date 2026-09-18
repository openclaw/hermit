CREATE TABLE `review_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`heuristic_score` integer NOT NULL,
	`concordance` text NOT NULL,
	`behavioral_families` text NOT NULL,
	`evidence_message_id` text,
	`krill_probability` text,
	`krill_brief` text,
	`krill_model` text,
	`review_message_id` text,
	`review_channel_id` text,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`previous_delivery_status` text DEFAULT 'pending' NOT NULL,
	`card_revision` integer DEFAULT 1 NOT NULL,
	`synced_card_revision` integer DEFAULT 1 NOT NULL,
	`expires_at` text,
	`decided_by_id` text,
	`decision_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_cases_case_id_unique` ON `review_cases` (`case_id`);--> statement-breakpoint
CREATE INDEX `idx_review_cases_guild_target` ON `review_cases` (`guild_id`,`target_user_id`);--> statement-breakpoint
CREATE INDEX `idx_review_cases_status` ON `review_cases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_review_cases_review_msg` ON `review_cases` (`review_message_id`);--> statement-breakpoint
CREATE TABLE `review_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	`reply_to_id` text,
	`content_length` integer NOT NULL,
	`line_count` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`artifacts` text NOT NULL,
	`similarity` text,
	`semantic_score` integer,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_observations_message_id_unique` ON `review_observations` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_review_obs_guild_author` ON `review_observations` (`guild_id`,`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_review_obs_author` ON `review_observations` (`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_review_obs_channel` ON `review_observations` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_review_obs_message` ON `review_observations` (`message_id`);