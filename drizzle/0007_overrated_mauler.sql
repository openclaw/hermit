ALTER TABLE `nominations` ADD `message_id` text;--> statement-breakpoint
ALTER TABLE `nominations` ADD `expires_at` text;--> statement-breakpoint
UPDATE `nominations` SET `expires_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+48 hours') WHERE `expires_at` IS NULL;
