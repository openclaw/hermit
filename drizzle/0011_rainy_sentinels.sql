CREATE TABLE `action_cooldown_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interaction_id` text NOT NULL,
	`action_kind` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`actor_expires_at` text NOT NULL,
	`target_expires_at` text NOT NULL,
	`channel_expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_cooldown_events_interaction_id_unique` ON `action_cooldown_events` (`interaction_id`);--> statement-breakpoint
CREATE INDEX `idx_action_cooldowns_actor` ON `action_cooldown_events` (`guild_id`,`actor_id`,`actor_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_action_cooldowns_target` ON `action_cooldown_events` (`guild_id`,`target_id`,`target_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_action_cooldowns_channel` ON `action_cooldown_events` (`guild_id`,`channel_id`,`channel_expires_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `action_cooldown_events` (
	`interaction_id`,
	`action_kind`,
	`guild_id`,
	`channel_id`,
	`actor_id`,
	`target_id`,
	`actor_expires_at`,
	`target_expires_at`,
	`channel_expires_at`,
	`created_at`
)
SELECT
	`interaction_id`,
	'slap',
	`guild_id`,
	`channel_id`,
	`actor_id`,
	`target_id`,
	strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+30 seconds'),
	strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+90 seconds'),
	strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+12 seconds'),
	`created_at`
FROM `slap_events`;--> statement-breakpoint
CREATE TABLE `lobster_encounters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interaction_id` text NOT NULL,
	`cooldown_event_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`target_is_bot` integer DEFAULT false NOT NULL,
	`taxonomy_snapshot_id` text NOT NULL,
	`species_aphia_id` integer NOT NULL,
	`species_accepted_name` text NOT NULL,
	`species_display_name` text NOT NULL,
	`species_family` text NOT NULL,
	`scene_id` text NOT NULL,
	`asset_url` text NOT NULL,
	`asset_checksum` text NOT NULL,
	`headline` text NOT NULL,
	`narrative` text NOT NULL,
	`metrics_json` text NOT NULL,
	`accessibility_description` text NOT NULL,
	`publication_status` text DEFAULT 'pending' NOT NULL,
	`publication_failure` text,
	`publication_failed_at` text,
	`message_bound_at` text,
	`response_status` text DEFAULT 'pending' NOT NULL,
	`response_type` text,
	`response_actor_id` text,
	`responded_at` text,
	`response_result_json` text,
	`counter_actor_id` text,
	`counter_target_id` text,
	`counter_scene_id` text,
	`counter_asset_url` text,
	`counter_asset_checksum` text,
	`counter_headline` text,
	`counter_narrative` text,
	`counter_metrics_json` text,
	`counter_accessibility_description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lobster_encounters_interaction_id_unique` ON `lobster_encounters` (`interaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lobster_encounters_cooldown_event_id_unique` ON `lobster_encounters` (`cooldown_event_id`);--> statement-breakpoint
CREATE INDEX `idx_lobster_encounters_message` ON `lobster_encounters` (`guild_id`,`channel_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `idx_lobster_encounters_species` ON `lobster_encounters` (`species_aphia_id`);--> statement-breakpoint
CREATE INDEX `idx_lobster_encounters_publication` ON `lobster_encounters` (`publication_status`);--> statement-breakpoint
CREATE INDEX `idx_lobster_encounters_response` ON `lobster_encounters` (`response_status`);
