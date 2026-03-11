import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

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

export type KeyValue = typeof keyValue.$inferSelect
export type NewKeyValue = typeof keyValue.$inferInsert
export type HelperEvent = typeof helperEvents.$inferSelect
export type NewHelperEvent = typeof helperEvents.$inferInsert
export type TrackedThread = typeof trackedThreads.$inferSelect
export type NewTrackedThread = typeof trackedThreads.$inferInsert
