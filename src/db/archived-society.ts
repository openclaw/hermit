// Schema archive only: no Worker imports, handlers, jobs or role actions.
// Preserve existing D1 history and prevent a future Drizzle generation from dropping it.
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

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
