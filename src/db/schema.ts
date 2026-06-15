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
