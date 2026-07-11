import { Database } from "bun:sqlite"
import { describe, expect, it, spyOn } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { nominationConfig } from "../src/config/nominations.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import {
	runNominationExpiry,
	runNominationGrantRecovery
} from "../src/services/nominationExpiry.js"
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

const createUnpublishedNomination = (
	database: Database,
	nomineeId: string,
	createdAt: string
) => {
	database.run(
		`insert into nominations (
			guild_id,
			channel_id,
			nominee_id,
			nominator_id,
			reason,
			expires_at,
			target_role_id,
			required_approvals,
			status,
			created_at,
			updated_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
		[
			nominationConfig.guildId,
			nominationConfig.reviewChannelId,
			nomineeId,
			"nominator-1",
			"excellent shell judgment",
			"2099-01-01T00:00:00.000Z",
			nominationConfig.targetRoleId,
			3,
			createdAt,
			createdAt
		]
	)
}

describe("nomination expiry recovery", () => {
	it("releases stale unpublished nominations without racing fresh submissions", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		createUnpublishedNomination(
			owner.database,
			"stale-nominee",
			"2026-07-10T00:00:00.000Z"
		)
		createUnpublishedNomination(
			owner.database,
			"fresh-nominee",
			new Date().toISOString()
		)

		try {
			await runNominationExpiry(
				{
					rest: {
						patch: async () => {
							throw new Error("no card should be edited")
						}
					}
				} as never
			)

			const statuses = owner.database
				.query(
					"select nominee_id as nomineeId, status from nominations order by nominee_id"
				)
				.all()
			expect(statuses).toEqual([
				{ nomineeId: "fresh-nominee", status: "submitted" },
				{ nomineeId: "stale-nominee", status: "expired" }
			])
		} finally {
			owner.close()
		}
	})

	it("retries a failed role grant and synchronizes the approved card", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({
			DB: owner as unknown as D1Database,
			DISCORD_BOT_TOKEN: "test-token"
		} as Env)
		owner.database.run(
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
				synced_card_revision
			) values (?, ?, ?, ?, ?, ?, ?, ?, 3, 'granting', 1, 1)`,
			[
				nominationConfig.guildId,
				nominationConfig.reviewChannelId,
				"nominee-1",
				"nominator-1",
				"excellent shell judgment",
				"review-message-1",
				"2099-01-01T00:00:00.000Z",
				nominationConfig.targetRoleId
			]
		)
		const nominationId = Number(
			owner.database.query("select last_insert_rowid() as id").get()?.id
		)
		for (const reviewerId of ["reviewer-1", "reviewer-2", "reviewer-3"]) {
			owner.database.run(
				"insert into nomination_approvals (nomination_id, approver_id, vote_choice) values (?, ?, 'approve')",
				[nominationId, reviewerId]
			)
		}

		let roleAttempt = 0
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
			roleAttempt += 1
			return new Response(null, { status: roleAttempt === 1 ? 500 : 204 })
		})
		const patchRoutes: string[] = []
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			const client = {
				rest: {
					patch: async (route: string) => {
						patchRoutes.push(route)
					}
				}
			} as never

			await runNominationGrantRecovery(client)
			await runNominationGrantRecovery(client)

			const nomination = owner.database
				.query(
					`select
						status,
						grant_failure_count as grantFailureCount,
						desired_card_revision as desiredCardRevision,
						synced_card_revision as syncedCardRevision
					from nominations where id = ?`
				)
				.get(nominationId)
			expect(nomination).toEqual({
				status: "approved",
				grantFailureCount: 0,
				desiredCardRevision: 2,
				syncedCardRevision: 2
			})
			expect(fetchSpy).toHaveBeenCalledTimes(2)
			expect(patchRoutes).toHaveLength(1)
		} finally {
			consoleLog.mockRestore()
			consoleError.mockRestore()
			fetchSpy.mockRestore()
			owner.close()
		}
	})
})
