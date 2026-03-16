import { sql } from "drizzle-orm"
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

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

export type KeyValue = typeof keyValue.$inferSelect
export type NewKeyValue = typeof keyValue.$inferInsert

export const applications = sqliteTable("applications", {
  id: text().primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  team: text("team", {
    enum: ["discord_mod", "vc_mod", "helper", "configurator"] as const,
  }).notNull(),
  timezone: text().notNull().default(""),
  availability: text().notNull().default(""),
  motivation: text().notNull().default(""),
  customFields: text("custom_fields", { mode: "json" })
    .$type<Record<string, string>>()
    .default(sql`'{}'`),
  status: text("status", {
    enum: [
      "FORM_SENT",
      "APPLICATION_PENDING_REVIEW",
      "APPLICATION_DENIED",
      "TRIAL_ACTIVE",
      "TRIAL_FAILED",
      "AWAITING_TEAM_VOTE",
      "VOTE_FAILED",
      "AWAITING_LEAD_APPROVAL",
      "PROMOTED_BY_LEAD",
      "PROMOTED_BY_LEAD_INACTION",
      "DENIED_BY_LEAD",
    ] as const,
  })
    .notNull()
    .default("FORM_SENT"),
  initiatedBy: text("initiated_by").notNull(),
  approvedBy: text("approved_by", { mode: "json" })
    .$type<string[]>()
    .default(sql`'[]'`),
  deniedBy: text("denied_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  reviewMessageId: text("review_message_id"),
  voteMessageId: text("vote_message_id"),
  leadApprovalDeadline: integer("lead_approval_deadline", {
    mode: "timestamp_ms",
  }),
  leadDecisionBy: text("lead_decision_by"),
  leadDecidedAt: integer("lead_decided_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const trials = sqliteTable("trials", {
  id: text().primaryKey().$defaultFn(() => crypto.randomUUID()),
  applicationId: text("application_id")
    .notNull()
    .references(() => applications.id),
  userId: text("user_id").notNull(),
  team: text("team", {
    enum: ["discord_mod", "vc_mod", "helper", "configurator"] as const,
  }).notNull(),
  startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp_ms" }),
  status: text("status", {
    enum: ["ACTIVE", "COMPLETED", "FAILED"] as const,
  })
    .notNull()
    .default("ACTIVE"),
  metrics: text("metrics", { mode: "json" })
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const promotionVotes = sqliteTable(
  "promotion_votes",
  {
    id: text().primaryKey().$defaultFn(() => crypto.randomUUID()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    voterId: text("voter_id").notNull(),
    vote: text("vote", { enum: ["APPROVE", "DENY"] as const }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex("uniq_app_voter").on(t.applicationId, t.voterId)],
)

export const auditLogs = sqliteTable("audit_logs", {
  id: text().primaryKey().$defaultFn(() => crypto.randomUUID()),
  applicationId: text("application_id"),
  trialId: text("trial_id"),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  details: text("details", { mode: "json" })
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

// Inferred types
export type Application = typeof applications.$inferSelect
export type NewApplication = typeof applications.$inferInsert
export type Trial = typeof trials.$inferSelect
export type NewTrial = typeof trials.$inferInsert
export type PromotionVote = typeof promotionVotes.$inferSelect
export type NewPromotionVote = typeof promotionVotes.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
