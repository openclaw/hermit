CREATE TABLE `endor_notification_deliveries` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`payload_digest` text NOT NULL,
	`nonce` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_endor_notification_deliveries_status` ON `endor_notification_deliveries` (`status`);