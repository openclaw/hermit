import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/d1"
import {
	markNominationCardStaleWrite,
	markNominationCardSynced,
	markNominationExpired,
	recordNominationVote,
	type NominationDatabase
} from "../src/data/nominations.js"
import * as schema from "../src/db/schema.js"
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

const createHarness = () => {
	const owner = new SqliteD1Database()
	applyMigrations(owner.database)
	const database = drizzle(owner as unknown as D1Database, {
		schema
	}) as NominationDatabase

	return { owner, database }
}

const createNomination = (
	database: Database,
	options: {
		nomineeId?: string
		expiresAt?: string
		desiredCardRevision?: number
		syncedCardRevision?: number
	} = {}
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
			synced_card_revision
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			"guild-1",
			"review-channel-1",
			options.nomineeId ?? "nominee-1",
			"nominator-1",
			"excellent shell judgment",
			"message-1",
			options.expiresAt ?? "2099-01-01T00:00:00.000Z",
			"role-1",
			3,
			"submitted",
			options.desiredCardRevision ?? 1,
			options.syncedCardRevision ?? 1
		]
	)

	return Number(database.query("select last_insert_rowid() as id").get()?.id)
}

const nominationRow = (database: Database, nominationId: number) =>
	database
		.query(
			`select
				status,
				desired_card_revision as desiredCardRevision,
				synced_card_revision as syncedCardRevision
			from nominations where id = ?`
		)
		.get(nominationId) as {
			status: string
			desiredCardRevision: number
			syncedCardRevision: number
		}

describe("nomination voting", () => {
	it("keeps one active vote and treats a repeated vote as a no-op", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database)
			const first = await recordNominationVote(
				nominationId,
				"reviewer-1",
				"approve",
				new Date("2026-07-10T00:00:00.000Z"),
				database
			)
			const repeated = await recordNominationVote(
				nominationId,
				"reviewer-1",
				"approve",
				new Date("2026-07-10T00:01:00.000Z"),
				database
			)
			const switched = await recordNominationVote(
				nominationId,
				"reviewer-1",
				"decline",
				new Date("2026-07-10T00:02:00.000Z"),
				database
			)

			expect(first).toMatchObject({
				kind: "recorded",
				totals: { approvals: 1, declines: 0 }
			})
			expect(repeated).toMatchObject({
				kind: "unchanged",
				totals: { approvals: 1, declines: 0 }
			})
			expect(switched).toMatchObject({
				kind: "switched",
				previousChoice: "approve",
				totals: { approvals: 0, declines: 1 }
			})
			expect(nominationRow(owner.database, nominationId).desiredCardRevision).toBe(3)
			const votes = owner.database
				.query(
					"select approver_id as reviewerId, vote_choice as choice from nomination_approvals"
				)
				.all()
			expect(votes).toEqual([
				{ reviewerId: "reviewer-1", choice: "decline" }
			])
		} finally {
			owner.close()
		}
	})

	it("serializes concurrent approvals into one granting transition", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database)
			const results = await Promise.all(
				["reviewer-1", "reviewer-2", "reviewer-3"].map((reviewerId) =>
					recordNominationVote(
						nominationId,
						reviewerId,
						"approve",
						new Date("2026-07-10T00:00:00.000Z"),
						database
					)
				)
			)

			expect(results.filter((result) => result.kind === "granting")).toHaveLength(1)
			expect(nominationRow(owner.database, nominationId).status).toBe("granting")
			const count = owner.database
				.query("select count(*) as count from nomination_approvals")
				.get() as { count: number }
			expect(count.count).toBe(3)
		} finally {
			owner.close()
		}
	})

	it("declines after three distinct decline votes and rejects later votes", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database)
			const results = []
			for (const reviewerId of ["reviewer-1", "reviewer-2", "reviewer-3"]) {
				results.push(
					await recordNominationVote(
						nominationId,
						reviewerId,
						"decline",
						new Date("2026-07-10T00:00:00.000Z"),
						database
					)
				)
			}
			const lateVote = await recordNominationVote(
				nominationId,
				"reviewer-4",
				"approve",
				new Date("2026-07-10T00:01:00.000Z"),
				database
			)

			expect(results.at(-1)).toMatchObject({
				kind: "declined",
				totals: { approvals: 0, declines: 3 }
			})
			expect(lateVote).toMatchObject({
				kind: "closed",
				totals: { approvals: 0, declines: 3 }
			})
			expect(nominationRow(owner.database, nominationId).status).toBe("declined")
		} finally {
			owner.close()
		}
	})

	it("switches votes in both directions while mixed votes remain open", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database)
			await recordNominationVote(
				nominationId,
				"reviewer-1",
				"decline",
				new Date("2026-07-10T00:00:00.000Z"),
				database
			)
			const switched = await recordNominationVote(
				nominationId,
				"reviewer-1",
				"approve",
				new Date("2026-07-10T00:01:00.000Z"),
				database
			)
			const mixed = await recordNominationVote(
				nominationId,
				"reviewer-2",
				"decline",
				new Date("2026-07-10T00:02:00.000Z"),
				database
			)

			expect(switched).toMatchObject({
				kind: "switched",
				previousChoice: "decline",
				totals: { approvals: 1, declines: 0 }
			})
			expect(mixed).toMatchObject({
				kind: "recorded",
				totals: { approvals: 1, declines: 1 }
			})
			expect(nominationRow(owner.database, nominationId).status).toBe("submitted")
		} finally {
			owner.close()
		}
	})

	it("lets only the first opposing threshold attempt become terminal", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database)
			for (const [reviewerId, choice] of [
				["approve-1", "approve"],
				["approve-2", "approve"],
				["decline-1", "decline"],
				["decline-2", "decline"]
			] as const) {
				await recordNominationVote(
					nominationId,
					reviewerId,
					choice,
					new Date("2026-07-10T00:00:00.000Z"),
					database
				)
			}

			const results = await Promise.all([
				recordNominationVote(
					nominationId,
					"approve-3",
					"approve",
					new Date("2026-07-10T00:01:00.000Z"),
					database
				),
				recordNominationVote(
					nominationId,
					"decline-3",
					"decline",
					new Date("2026-07-10T00:01:00.000Z"),
					database
				)
			])

			const terminal = results.filter(
				(result) => result.kind === "granting" || result.kind === "declined"
			)
			expect(terminal).toHaveLength(1)
			expect(results.filter((result) => result.kind === "closed")).toHaveLength(1)
			expect(["granting", "declined"]).toContain(
				nominationRow(owner.database, nominationId).status
			)
			const count = owner.database
				.query("select count(*) as count from nomination_approvals")
				.get() as { count: number }
			expect(count.count).toBe(5)
		} finally {
			owner.close()
		}
	})

	it("expires before storing a late vote", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database, {
				expiresAt: "2026-07-09T00:00:00.000Z"
			})
			const result = await recordNominationVote(
				nominationId,
				"reviewer-1",
				"approve",
				new Date("2026-07-10T00:00:00.000Z"),
				database
			)

			expect(result).toMatchObject({
				kind: "expired",
				totals: { approvals: 0, declines: 0 }
			})
			expect(nominationRow(owner.database, nominationId).status).toBe("expired")
		} finally {
			owner.close()
		}
	})

	it("resolves a threshold vote racing expiry to exactly one terminal state", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database, {
				expiresAt: "2026-07-10T00:01:00.000Z"
			})
			for (const reviewerId of ["reviewer-1", "reviewer-2"]) {
				await recordNominationVote(
					nominationId,
					reviewerId,
					"approve",
					new Date("2026-07-10T00:00:00.000Z"),
					database
				)
			}

			const [voteResult, expiryResult] = await Promise.all([
				recordNominationVote(
					nominationId,
					"reviewer-3",
					"approve",
					new Date("2026-07-10T00:00:59.000Z"),
					database
				),
				markNominationExpired(
					nominationId,
					new Date("2026-07-10T00:01:00.000Z"),
					database
				)
			])
			const finalStatus = nominationRow(owner.database, nominationId).status

			expect(["granting", "expired"]).toContain(finalStatus)
			if (finalStatus === "granting") {
				expect(voteResult.kind).toBe("granting")
				expect(expiryResult).toBeNull()
			} else {
				expect(voteResult.kind).toBe("closed")
				expect(expiryResult?.status).toBe("expired")
			}
		} finally {
			owner.close()
		}
	})

	for (const status of ["granting", "approved", "expired"] as const) {
		it(`does not store a vote after the nomination is ${status}`, async () => {
			const { owner, database } = createHarness()
			try {
				const nominationId = createNomination(owner.database)
				owner.database.run(
					"update nominations set status = ? where id = ?",
					[status, nominationId]
				)

				const result = await recordNominationVote(
					nominationId,
					"late-reviewer",
					"approve",
					new Date("2026-07-10T00:00:00.000Z"),
					database
				)

				expect(result).toMatchObject({
					kind: "closed",
					totals: { approvals: 0, declines: 0 }
				})
				const count = owner.database
					.query("select count(*) as count from nomination_approvals")
					.get() as { count: number }
				expect(count.count).toBe(0)
			} finally {
				owner.close()
			}
		})
	}

	it("marks a newer revision pending after a stale Discord write", async () => {
		const { owner, database } = createHarness()
		try {
			const nominationId = createNomination(owner.database, {
				desiredCardRevision: 3,
				syncedCardRevision: 3
			})

			expect(
				await markNominationCardSynced(nominationId, 2, database)
			).toBeNull()
			const stale = await markNominationCardStaleWrite(
				nominationId,
				2,
				database
			)

			expect(stale).toMatchObject({
				desiredCardRevision: 4,
				syncedCardRevision: 3
			})
			expect(nominationRow(owner.database, nominationId)).toMatchObject({
				desiredCardRevision: 4,
				syncedCardRevision: 3
			})
		} finally {
			owner.close()
		}
	})
})
