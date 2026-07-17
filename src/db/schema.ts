import { sql } from "drizzle-orm"
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex
} from "drizzle-orm/sqlite-core"

export const keyValue = sqliteTable("keyValue", {
	key: text().primaryKey(),
	value: text().notNull(),
	createdAt: integer({ mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer({ mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
})

export const helperEvents = sqliteTable(
	"helper_events",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		eventType: text("event_type").notNull().default("helper_command"),
		threadId: text("thread_id"),
		messageCount: integer("message_count"),
		eventTime: text("event_time").notNull(),
		command: text().notNull(),
		invokedById: text("invoked_by_id"),
		invokedByUsername: text("invoked_by_username"),
		invokedByGlobalName: text("invoked_by_global_name"),
		receivedAt: text("received_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		rawPayload: text("raw_payload").notNull()
	},
	(table) => [
		index("idx_helper_events_event_time").on(table.eventTime),
		index("idx_helper_events_command").on(table.command),
		index("idx_helper_events_thread_id").on(table.threadId),
		index("idx_helper_events_invoked_by_id").on(table.invokedById),
		index("idx_helper_events_event_type").on(table.eventType),
		index("idx_helper_events_thread_time").on(table.threadId, table.eventTime)
	]
)

export const trackedThreads = sqliteTable(
	"tracked_threads",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		threadId: text("thread_id").notNull().unique(),
		createdAt: text("created_at").notNull(),
		lastChecked: text("last_checked"),
		solved: integer().notNull().default(0),
		warningLevel: integer("warning_level").notNull().default(0),
		closed: integer().notNull().default(0),
		lastMessageCount: integer("last_message_count"),
		receivedAt: text("received_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		rawPayload: text("raw_payload").notNull()
	},
	(table) => [
		index("idx_tracked_threads_solved").on(table.solved),
		index("idx_tracked_threads_last_checked").on(table.lastChecked),
		index("idx_tracked_threads_received_at").on(table.receivedAt),
		index("idx_tracked_threads_closed").on(table.closed),
		index("idx_tracked_threads_warning_level").on(table.warningLevel)
	]
)

export const redditModerationContexts = sqliteTable(
	"reddit_moderation_contexts",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		subreddit: text().notNull(),
		username: text().notNull(),
		action: text().notNull().default("moderated"),
		unaction: text().notNull().default("reviewed"),
		banReason: text("ban_reason"),
		moderator: text(),
		bannedAt: text("banned_at"),
		expiresAt: text("expires_at"),
		rawPayload: text("raw_payload"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex("idx_reddit_moderation_contexts_subreddit_username").on(table.subreddit, table.username),
		index("idx_reddit_moderation_contexts_username").on(table.username),
		index("idx_reddit_moderation_contexts_action").on(table.action)
	]
)

export const formSubmissions = sqliteTable(
	"form_submissions",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		formId: text("form_id").notNull(),
		status: text().notNull().default("submitted"),
		authProvider: text("auth_provider"),
		applicantId: text("applicant_id"),
		applicantUsername: text("applicant_username"),
		payload: text().notNull(),
		reviewChannelId: text("review_channel_id").notNull(),
		reviewMessageId: text("review_message_id"),
		reviewThreadId: text("review_thread_id"),
		decidedAt: text("decided_at"),
		decidedById: text("decided_by_id"),
		decisionReason: text("decision_reason"),
		actionResult: text("action_result"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_form_submissions_form_id").on(table.formId),
		index("idx_form_submissions_status").on(table.status),
		index("idx_form_submissions_applicant_id").on(table.applicantId),
		index("idx_form_submissions_review_message_id").on(table.reviewMessageId)
	]
)

export const clawhubContentRightsCases = sqliteTable(
	"clawhub_content_rights_cases",
	{
		caseId: text("case_id").primaryKey(),
		formSubmissionId: integer("form_submission_id").notNull().unique(),
		status: text().notNull().default("submitted"),
		requesterName: text("requester_name").notNull(),
		organization: text().notNull(),
		email: text().notNull(),
		clawhubUrls: text("clawhub_urls").notNull(),
		explanation: text().notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_clawhub_content_rights_cases_status").on(table.status),
		index("idx_clawhub_content_rights_cases_email").on(table.email)
	]
)

export const clawhubContentRightsFiles = sqliteTable(
	"clawhub_content_rights_files",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		caseId: text("case_id").notNull(),
		objectKey: text("object_key").notNull().unique(),
		kind: text().notNull(),
		originalName: text("original_name").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		sha256: text().notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_clawhub_content_rights_files_case_id").on(table.caseId)
	]
)

export const clawhubContentRightsEvents = sqliteTable(
	"clawhub_content_rights_events",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		caseId: text("case_id").notNull(),
		eventType: text("event_type").notNull(),
		actor: text(),
		metadata: text().notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_clawhub_content_rights_events_case_id").on(table.caseId),
		index("idx_clawhub_content_rights_events_event_type").on(table.eventType)
	]
)

export const claimRequests = sqliteTable(
	"claim_requests",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		guildId: text("guild_id").notNull(),
		userId: text("user_id").notNull(),
		status: text().notNull().default("submitted"),
		githubUsername: text("github_username"),
		mergedPrCount: integer("merged_pr_count"),
		reviewMessageId: text("review_message_id"),
		reviewThreadId: text("review_thread_id"),
		decidedAt: text("decided_at"),
		decidedById: text("decided_by_id"),
		decisionReason: text("decision_reason"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex("idx_claim_requests_guild_user").on(table.guildId, table.userId),
		index("idx_claim_requests_user_id").on(table.userId),
		index("idx_claim_requests_status").on(table.status)
	]
)

export const nominations = sqliteTable(
	"nominations",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		guildId: text("guild_id").notNull(),
		channelId: text("channel_id").notNull(),
		nomineeId: text("nominee_id").notNull(),
		nominatorId: text("nominator_id").notNull(),
		reason: text().notNull().default("No reason provided."),
		messageId: text("message_id"),
		targetRoleId: text("target_role_id").notNull(),
		requiredApprovals: integer("required_approvals").notNull(),
		status: text().notNull().default("submitted"),
		expiresAt: text("expires_at"),
		completedAt: text("completed_at"),
		desiredCardRevision: integer("desired_card_revision").notNull().default(0),
		syncedCardRevision: integer("synced_card_revision").notNull().default(0),
		cardSyncStartedAt: text("card_sync_started_at"),
		cardSyncFailureCount: integer("card_sync_failure_count").notNull().default(0),
		grantStartedAt: text("grant_started_at"),
		grantFailureCount: integer("grant_failure_count").notNull().default(0),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex("idx_nominations_active_unique")
			.on(table.guildId, table.nomineeId, table.targetRoleId)
			.where(sql`${table.status} in ('submitted', 'granting')`),
		index("idx_nominations_status").on(table.status),
		index("idx_nominations_card_sync").on(
			table.desiredCardRevision,
			table.syncedCardRevision
		)
	]
)

export const nominationApprovals = sqliteTable(
	"nomination_approvals",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		nominationId: integer("nomination_id").notNull(),
		approverId: text("approver_id").notNull(),
		voteChoice: text("vote_choice").notNull().default("approve"),
		mutationId: text("mutation_id"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex("idx_nomination_approvals_nomination_approver").on(table.nominationId, table.approverId),
		index("idx_nomination_approvals_nomination_id").on(table.nominationId)
	]
)

export const slapEvents = sqliteTable(
	"slap_events",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		interactionId: text("interaction_id").notNull().unique(),
		guildId: text("guild_id").notNull(),
		channelId: text("channel_id").notNull(),
		messageId: text("message_id"),
		actorId: text("actor_id").notNull(),
		targetId: text("target_id").notNull(),
		targetIsBot: integer("target_is_bot", { mode: "boolean" })
			.notNull()
			.default(false),
		fishSlug: text("fish_slug").notNull(),
		fishName: text("fish_name").notNull(),
		rarity: text().notNull(),
		outcome: text().notNull(),
		headline: text().notNull(),
		narrative: text().notNull(),
		impact: integer().notNull(),
		dignityRemaining: integer("dignity_remaining").notNull(),
		fishCondition: text("fish_condition").notNull(),
		imageUrl: text("image_url").notNull(),
		counterActorId: text("counter_actor_id"),
		counterTargetId: text("counter_target_id"),
		counterFishSlug: text("counter_fish_slug"),
		counterFishName: text("counter_fish_name"),
		counterRarity: text("counter_rarity"),
		counterOutcome: text("counter_outcome"),
		counterHeadline: text("counter_headline"),
		counterNarrative: text("counter_narrative"),
		counterImpact: integer("counter_impact"),
		counterDignityRemaining: integer("counter_dignity_remaining"),
		counterFishCondition: text("counter_fish_condition"),
		counterImageUrl: text("counter_image_url"),
		counteredAt: text("countered_at"),
		appealedById: text("appealed_by_id"),
		appealRuling: text("appeal_ruling"),
		appealedAt: text("appealed_at"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_slap_events_actor_cooldown").on(
			table.guildId,
			table.actorId,
			table.createdAt
		),
		index("idx_slap_events_target_cooldown").on(
			table.guildId,
			table.targetId,
			table.createdAt
		),
		index("idx_slap_events_channel_cooldown").on(
			table.guildId,
			table.channelId,
			table.createdAt
		),
		index("idx_slap_events_message").on(table.guildId, table.channelId, table.messageId),
		index("idx_slap_events_outcome").on(table.outcome),
		index("idx_slap_events_rarity").on(table.rarity)
	]
)

export const actionCooldownEvents = sqliteTable(
	"action_cooldown_events",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		interactionId: text("interaction_id").notNull().unique(),
		actionKind: text("action_kind").notNull(),
		guildId: text("guild_id").notNull(),
		channelId: text("channel_id").notNull(),
		actorId: text("actor_id").notNull(),
		targetId: text("target_id").notNull(),
		actorExpiresAt: text("actor_expires_at").notNull(),
		targetExpiresAt: text("target_expires_at").notNull(),
		channelExpiresAt: text("channel_expires_at").notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_action_cooldowns_actor").on(
			table.guildId,
			table.actorId,
			table.actorExpiresAt
		),
		index("idx_action_cooldowns_target").on(
			table.guildId,
			table.targetId,
			table.targetExpiresAt
		),
		index("idx_action_cooldowns_channel").on(
			table.guildId,
			table.channelId,
			table.channelExpiresAt
		)
	]
)

export const lobsterEncounters = sqliteTable(
	"lobster_encounters",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		interactionId: text("interaction_id").notNull().unique(),
		cooldownEventId: integer("cooldown_event_id").notNull().unique(),
		guildId: text("guild_id").notNull(),
		channelId: text("channel_id").notNull(),
		messageId: text("message_id"),
		actorId: text("actor_id").notNull(),
		targetId: text("target_id").notNull(),
		targetIsBot: integer("target_is_bot", { mode: "boolean" })
			.notNull()
			.default(false),
		taxonomySnapshotId: text("taxonomy_snapshot_id").notNull(),
		speciesAphiaId: integer("species_aphia_id").notNull(),
		speciesAcceptedName: text("species_accepted_name").notNull(),
		speciesDisplayName: text("species_display_name").notNull(),
		speciesFamily: text("species_family").notNull(),
		sceneId: text("scene_id").notNull(),
		assetUrl: text("asset_url").notNull(),
		assetChecksum: text("asset_checksum").notNull(),
		headline: text().notNull(),
		narrative: text().notNull(),
		metricsJson: text("metrics_json").notNull(),
		accessibilityDescription: text("accessibility_description").notNull(),
		publicationStatus: text("publication_status").notNull().default("pending"),
		publicationFailure: text("publication_failure"),
		publicationFailedAt: text("publication_failed_at"),
		messageBoundAt: text("message_bound_at"),
		responseStatus: text("response_status").notNull().default("pending"),
		responseType: text("response_type"),
		responseActorId: text("response_actor_id"),
		respondedAt: text("responded_at"),
		responseResultJson: text("response_result_json"),
		counterActorId: text("counter_actor_id"),
		counterTargetId: text("counter_target_id"),
		counterSceneId: text("counter_scene_id"),
		counterAssetUrl: text("counter_asset_url"),
		counterAssetChecksum: text("counter_asset_checksum"),
		counterHeadline: text("counter_headline"),
		counterNarrative: text("counter_narrative"),
		counterMetricsJson: text("counter_metrics_json"),
		counterAccessibilityDescription: text("counter_accessibility_description"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index("idx_lobster_encounters_message").on(
			table.guildId,
			table.channelId,
			table.messageId
		),
		index("idx_lobster_encounters_species").on(table.speciesAphiaId),
		index("idx_lobster_encounters_publication").on(table.publicationStatus),
		index("idx_lobster_encounters_response").on(table.responseStatus)
	]
)

export type KeyValue = typeof keyValue.$inferSelect
export type NewKeyValue = typeof keyValue.$inferInsert
export type HelperEvent = typeof helperEvents.$inferSelect
export type NewHelperEvent = typeof helperEvents.$inferInsert
export type TrackedThread = typeof trackedThreads.$inferSelect
export type NewTrackedThread = typeof trackedThreads.$inferInsert
export type RedditModerationContext = typeof redditModerationContexts.$inferSelect
export type NewRedditModerationContext = typeof redditModerationContexts.$inferInsert
export type FormSubmission = typeof formSubmissions.$inferSelect
export type NewFormSubmission = typeof formSubmissions.$inferInsert
export type ClawhubContentRightsCase = typeof clawhubContentRightsCases.$inferSelect
export type NewClawhubContentRightsCase = typeof clawhubContentRightsCases.$inferInsert
export type ClawhubContentRightsFile = typeof clawhubContentRightsFiles.$inferSelect
export type NewClawhubContentRightsFile = typeof clawhubContentRightsFiles.$inferInsert
export type ClawhubContentRightsEvent = typeof clawhubContentRightsEvents.$inferSelect
export type NewClawhubContentRightsEvent = typeof clawhubContentRightsEvents.$inferInsert
export type ClaimRequest = typeof claimRequests.$inferSelect
export type NewClaimRequest = typeof claimRequests.$inferInsert
export type Nomination = typeof nominations.$inferSelect
export type NewNomination = typeof nominations.$inferInsert
export type NominationApproval = typeof nominationApprovals.$inferSelect
export type NewNominationApproval = typeof nominationApprovals.$inferInsert
export type SlapEvent = typeof slapEvents.$inferSelect
export type NewSlapEvent = typeof slapEvents.$inferInsert
export type ActionCooldownEvent = typeof actionCooldownEvents.$inferSelect
export type NewActionCooldownEvent = typeof actionCooldownEvents.$inferInsert
export type LobsterEncounter = typeof lobsterEncounters.$inferSelect
export type NewLobsterEncounter = typeof lobsterEncounters.$inferInsert
