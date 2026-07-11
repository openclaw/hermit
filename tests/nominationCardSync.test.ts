import { Database } from "bun:sqlite"
import { describe, expect, it, spyOn } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { nominationConfig } from "../src/config/nominations.js"
import {
	listPendingNominationCardSyncs,
	markNominationCardSyncFailed
} from "../src/data/nominations.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import {
	runNominationCardSyncRecovery,
	syncNominationReviewCard
} from "../src/services/nominationCardSync.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const migrationPaths = readdirSync("drizzle")
	.filter((file) => /000[4-9]_.*\.sql/.test(file))
	.sort()

const applyMigrations = (database: Database) => {
	for (const path of migrationPaths) {
		const migration = readFileSync(`drizzle/${path}`, "utf8")
		for (const statement of migration.split("--> statement-breakpoint")) {
			const trimmed = statement.trim()
			if (trimmed) {
				database.run(trimmed)
			}
		}
	}
}

const createNomination = (
	database: Database,
	desiredCardRevision = 2,
	syncedCardRevision = 1,
	channelId = nominationConfig.reviewChannelId,
	nomineeId = "nominee-1"
) => {
	database.run(
		`insert into nominations (
			guild_id,
			channel_id,
			nominee_id,
			nominator_id,
			reason,
			message_id,
			expires_at,
			target_role_id,
			required_approvals,
			status,
			desired_card_revision,
			synced_card_revision,
			card_sync_started_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			nominationConfig.guildId,
			channelId,
			nomineeId,
			"nominator-1",
			"excellent shell judgment",
			"review-message-1",
			"2099-01-01T00:00:00.000Z",
			nominationConfig.targetRoleId,
			3,
			"submitted",
			desiredCardRevision,
			syncedCardRevision,
			"2026-07-10T00:00:00.000Z"
		]
	)
	const nominationId = Number(
		database.query("select last_insert_rowid() as id").get()?.id
	)
	database.run(
		"insert into nomination_approvals (nomination_id, approver_id, vote_choice) values (?, ?, ?)",
		[nominationId, "reviewer-1", "approve"]
	)
	return nominationId
}

const cardState = (database: Database, nominationId: number) =>
	database
		.query(
			`select
				desired_card_revision as desiredCardRevision,
				synced_card_revision as syncedCardRevision,
				card_sync_failure_count as failureCount,
				card_sync_started_at as startedAt
			from nominations where id = ?`
		)
		.get(nominationId)

describe("nomination card synchronization", () => {
	it("renders fresh persisted state and marks that exact revision synchronized", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(owner.database)
		const patches: unknown[] = []
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			const result = await syncNominationReviewCard(
				{
					rest: {
						patch: async (_route: string, payload: unknown) => {
							patches.push(payload)
						}
					}
				} as never,
				nominationId
			)

			expect(result).toEqual({ status: "synced" })
			expect(patches).toHaveLength(1)
			expect(JSON.stringify(patches[0])).toContain("👍 Approvals: 1/3")
			expect(cardState(owner.database, nominationId)).toEqual({
				desiredCardRevision: 2,
				syncedCardRevision: 2,
				failureCount: 0,
				startedAt: null
			})
		} finally {
			consoleLog.mockRestore()
			owner.close()
		}
	})

	it("keeps a failed or missing Discord card pending for scheduled recovery", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(owner.database)
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await syncNominationReviewCard(
				{
					rest: {
						patch: async () => {
							throw { status: 404 }
						}
					}
				} as never,
				nominationId
			)

			expect(result).toEqual({ status: "failed" })
			expect(cardState(owner.database, nominationId)).toMatchObject({
				desiredCardRevision: 2,
				syncedCardRevision: 1,
				failureCount: 1
			})
			expect(consoleError).toHaveBeenCalledTimes(1)
		} finally {
			consoleError.mockRestore()
			owner.close()
		}
	})

	it("retries a pending card through scheduled recovery", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(owner.database)
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			await syncNominationReviewCard(
				{
					rest: {
						patch: async () => {
							throw { status: 500 }
						}
					}
				} as never,
				nominationId
			)

			await runNominationCardSyncRecovery(
				{
					rest: {
						patch: async () => {}
					}
				} as never
			)

			expect(cardState(owner.database, nominationId)).toEqual({
				desiredCardRevision: 2,
				syncedCardRevision: 2,
				failureCount: 0,
				startedAt: null
			})
		} finally {
			consoleLog.mockRestore()
			consoleError.mockRestore()
			owner.close()
		}
	})

	it("never edits a legacy nomination card outside CT general", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(
			owner.database,
			2,
			1,
			nominationConfig.nominationChannelId
		)
		let patchCount = 0
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await syncNominationReviewCard(
				{
					rest: {
						patch: async () => {
							patchCount += 1
						}
					}
				} as never,
				nominationId
			)

			expect(result).toEqual({ status: "failed" })
			expect(patchCount).toBe(0)
			expect(cardState(owner.database, nominationId)).toMatchObject({
				desiredCardRevision: 2,
				syncedCardRevision: 1,
				failureCount: 1
			})
			expect(String(consoleError.mock.calls[0]?.[0])).toContain(
				'"discordResponseStatus":"unexpected_channel"'
			)
		} finally {
			consoleError.mockRestore()
			owner.close()
		}
	})

	it("keeps a newer revision pending when an older sync acknowledgement fails", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(owner.database)
		let patchCount = 0
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await syncNominationReviewCard(
				{
					rest: {
						patch: async () => {
							patchCount += 1
						}
					}
				} as never,
				nominationId,
				3,
				{
					markNominationCardSynced: async () => {
						owner.database.run(
							`update nominations
								set desired_card_revision = 3,
									synced_card_revision = 3
								where id = ?`,
							[nominationId]
						)
						throw new Error("acknowledgement failed")
					}
				}
			)

			expect(result).toEqual({ status: "failed" })
			expect(patchCount).toBe(1)
			expect(cardState(owner.database, nominationId)).toMatchObject({
				desiredCardRevision: 4,
				syncedCardRevision: 3,
				failureCount: 0
			})
		} finally {
			consoleError.mockRestore()
			owner.close()
		}
	})

	it("rotates failed card syncs behind older pending work", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const firstId = createNomination(
			owner.database,
			2,
			1,
			nominationConfig.reviewChannelId,
			"nominee-1"
		)
		const secondId = createNomination(
			owner.database,
			2,
			1,
			nominationConfig.reviewChannelId,
			"nominee-2"
		)
		owner.database.run(
			"update nominations set updated_at = ? where id = ?",
			["2026-07-09T00:00:00.000Z", firstId]
		)
		owner.database.run(
			"update nominations set updated_at = ? where id = ?",
			["2026-07-09T01:00:00.000Z", secondId]
		)
		try {
			expect((await listPendingNominationCardSyncs(1))[0]?.id).toBe(firstId)

			await markNominationCardSyncFailed(firstId, 2)

			expect((await listPendingNominationCardSyncs(1))[0]?.id).toBe(secondId)
		} finally {
			owner.close()
		}
	})

	it("re-renders after an older Discord edit completes against newer state", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createNomination(owner.database)
		let patchCount = 0
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await syncNominationReviewCard(
				{
					rest: {
						patch: async () => {
							patchCount += 1
							if (patchCount === 1) {
								owner.database.run(
									"update nominations set desired_card_revision = 3 where id = ?",
									[nominationId]
								)
							}
						}
					}
				} as never,
				nominationId
			)

			expect(result).toEqual({ status: "synced" })
			expect(patchCount).toBe(2)
			expect(cardState(owner.database, nominationId)).toEqual({
				desiredCardRevision: 4,
				syncedCardRevision: 4,
				failureCount: 0,
				startedAt: null
			})
		} finally {
			consoleLog.mockRestore()
			consoleError.mockRestore()
			owner.close()
		}
	})
})
