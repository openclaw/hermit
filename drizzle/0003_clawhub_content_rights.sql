CREATE TABLE `clawhub_content_rights_cases` (
	`case_id` text PRIMARY KEY NOT NULL,
	`form_submission_id` integer NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`requester_name` text NOT NULL,
	`organization` text NOT NULL,
	`email` text NOT NULL,
	`clawhub_urls` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clawhub_content_rights_cases_form_submission_id_unique` ON `clawhub_content_rights_cases` (`form_submission_id`);--> statement-breakpoint
CREATE INDEX `idx_clawhub_content_rights_cases_status` ON `clawhub_content_rights_cases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_clawhub_content_rights_cases_email` ON `clawhub_content_rights_cases` (`email`);--> statement-breakpoint
CREATE TABLE `clawhub_content_rights_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor` text,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_clawhub_content_rights_events_case_id` ON `clawhub_content_rights_events` (`case_id`);--> statement-breakpoint
CREATE INDEX `idx_clawhub_content_rights_events_event_type` ON `clawhub_content_rights_events` (`event_type`);--> statement-breakpoint
CREATE TABLE `clawhub_content_rights_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` text NOT NULL,
	`object_key` text NOT NULL,
	`kind` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clawhub_content_rights_files_object_key_unique` ON `clawhub_content_rights_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_clawhub_content_rights_files_case_id` ON `clawhub_content_rights_files` (`case_id`);