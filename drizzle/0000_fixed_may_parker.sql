CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`team` text NOT NULL,
	`timezone` text DEFAULT '' NOT NULL,
	`availability` text DEFAULT '' NOT NULL,
	`motivation` text DEFAULT '' NOT NULL,
	`custom_fields` text DEFAULT '{}',
	`status` text DEFAULT 'FORM_SENT' NOT NULL,
	`initiated_by` text NOT NULL,
	`approved_by` text DEFAULT '[]',
	`denied_by` text,
	`reviewed_at` integer,
	`review_message_id` text,
	`vote_message_id` text,
	`lead_approval_deadline` integer,
	`lead_decision_by` text,
	`lead_decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`trial_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text DEFAULT '{}',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `keyValue` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `promotion_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`vote` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_app_voter` ON `promotion_votes` (`application_id`,`voter_id`);--> statement-breakpoint
CREATE TABLE `trials` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`metrics` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
