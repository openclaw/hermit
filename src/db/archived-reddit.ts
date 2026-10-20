// Schema archive only: no Worker imports, handlers or moderation actions.
// Preserve existing D1 history and prevent future Drizzle generation from dropping it.
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

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
