ALTER TABLE `nomination_approvals` ADD `vote_choice` text DEFAULT 'approve' NOT NULL;--> statement-breakpoint
ALTER TABLE `nomination_approvals` ADD `mutation_id` text;--> statement-breakpoint
ALTER TABLE `nominations` ADD `desired_card_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `nominations` ADD `synced_card_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `nominations` ADD `card_sync_started_at` text;--> statement-breakpoint
ALTER TABLE `nominations` ADD `card_sync_failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `nominations` ADD `grant_started_at` text;--> statement-breakpoint
ALTER TABLE `nominations` ADD `grant_failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_nominations_card_sync` ON `nominations` (`desired_card_revision`,`synced_card_revision`);