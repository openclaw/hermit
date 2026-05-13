import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"

const claimRequestsMigrationPath = readdirSync("drizzle")
	.find((file) => file.startsWith("0001_") && file.endsWith(".sql"))

if (!claimRequestsMigrationPath) {
	throw new Error("Could not find claim requests migration")
}

const applyMigration = (database: Database, path: string) => {
	const migration = readFileSync(path, "utf8")
	for (const statement of migration.split("--> statement-breakpoint")) {
		const trimmed = statement.trim()
		if (trimmed.length > 0) {
			database.run(trimmed)
		}
	}
}

describe("claim request dedupe migration", () => {
	it("allows only one claim per user per guild", () => {
		const database = new Database(":memory:")
		applyMigration(database, `drizzle/${claimRequestsMigrationPath}`)

		database.run(
			"insert into claim_requests (guild_id, user_id, status, created_at, updated_at) values (?, ?, ?, ?, ?)",
			["guild-1", "user-1", "submitted", "2026-05-12T00:00:00.000Z", "2026-05-12T00:00:00.000Z"]
		)

		expect(() =>
			database.run(
				"insert into claim_requests (guild_id, user_id, status, created_at, updated_at) values (?, ?, ?, ?, ?)",
				["guild-1", "user-1", "submitted", "2026-05-12T00:01:00.000Z", "2026-05-12T00:01:00.000Z"]
			)
		).toThrow()
	})

	it("allows the same user to claim in a different guild", () => {
		const database = new Database(":memory:")
		applyMigration(database, `drizzle/${claimRequestsMigrationPath}`)

		database.run(
			"insert into claim_requests (guild_id, user_id, status, created_at, updated_at) values (?, ?, ?, ?, ?)",
			["guild-1", "user-1", "submitted", "2026-05-12T00:00:00.000Z", "2026-05-12T00:00:00.000Z"]
		)
		database.run(
			"insert into claim_requests (guild_id, user_id, status, created_at, updated_at) values (?, ?, ?, ?, ?)",
			["guild-2", "user-1", "submitted", "2026-05-12T00:01:00.000Z", "2026-05-12T00:01:00.000Z"]
		)

		const row = database
			.query("select count(*) as count from claim_requests")
			.get() as { count: number }

		expect(row.count).toBe(2)
	})
})
