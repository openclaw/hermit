CREATE TABLE `slap_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interaction_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`target_is_bot` integer DEFAULT false NOT NULL,
	`fish_slug` text NOT NULL,
	`fish_name` text NOT NULL,
	`rarity` text NOT NULL,
	`outcome` text NOT NULL,
	`headline` text NOT NULL,
	`narrative` text NOT NULL,
	`impact` integer NOT NULL,
	`dignity_remaining` integer NOT NULL,
	`fish_condition` text NOT NULL,
	`image_url` text NOT NULL,
	`counter_actor_id` text,
	`counter_target_id` text,
	`counter_fish_slug` text,
	`counter_fish_name` text,
	`counter_rarity` text,
	`counter_outcome` text,
	`counter_headline` text,
	`counter_narrative` text,
	`counter_impact` integer,
	`counter_dignity_remaining` integer,
	`counter_fish_condition` text,
	`counter_image_url` text,
	`countered_at` text,
	`appealed_by_id` text,
	`appeal_ruling` text,
	`appealed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slap_events_interaction_id_unique` ON `slap_events` (`interaction_id`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_actor_cooldown` ON `slap_events` (`guild_id`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_target_cooldown` ON `slap_events` (`guild_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_channel_cooldown` ON `slap_events` (`guild_id`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_message` ON `slap_events` (`guild_id`,`channel_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_outcome` ON `slap_events` (`outcome`);--> statement-breakpoint
CREATE INDEX `idx_slap_events_rarity` ON `slap_events` (`rarity`);