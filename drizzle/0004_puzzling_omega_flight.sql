CREATE TABLE `nomination_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nomination_id` integer NOT NULL,
	`approver_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_nomination_approvals_nomination_approver` ON `nomination_approvals` (`nomination_id`,`approver_id`);--> statement-breakpoint
CREATE INDEX `idx_nomination_approvals_nomination_id` ON `nomination_approvals` (`nomination_id`);--> statement-breakpoint
CREATE TABLE `nominations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`nominee_id` text NOT NULL,
	`nominator_id` text NOT NULL,
	`target_role_id` text NOT NULL,
	`required_approvals` integer NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nominations_guild_nominee_status` ON `nominations` (`guild_id`,`nominee_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_nominations_status` ON `nominations` (`status`);