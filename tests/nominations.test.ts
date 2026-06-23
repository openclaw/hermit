import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"

const nominationMigrationPaths = readdirSync("drizzle")
	.filter((file) => /000[45]_.*\.sql/.test(file))
	.sort()

if (nominationMigrationPaths.length !== 2) {
	throw new Error("Could not find nomination migrations")
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

const createNomination = (database: Database) => {
	database.run(
		`insert into nominations (
			guild_id,
			channel_id,
			nominee_id,
			nominator_id,
			reason,
			target_role_id,
			required_approvals,
			status
		) values (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			"guild-1",
			"channel-1",
			"nominee-1",
			"nominator-1",
			"excellent shell judgment",
			"role-1",
			2,
			"submitted"
		]
	)

	return Number(database.query("select last_insert_rowid() as id").get()?.id)
}

describe("nomination migration", () => {
	it("allows two distinct approvers for one nomination", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		const nominationId = createNomination(database)

		database.run(
			"insert into nomination_approvals (nomination_id, approver_id) values (?, ?)",
			[nominationId, "approver-1"]
		)
		database.run(
			"insert into nomination_approvals (nomination_id, approver_id) values (?, ?)",
			[nominationId, "approver-2"]
		)

		const row = database
			.query("select count(*) as count from nomination_approvals")
			.get() as { count: number }
		const nomination = database
			.query("select reason from nominations where id = ?")
			.get(nominationId) as { reason: string }

		expect(row.count).toBe(2)
		expect(nomination.reason).toBe("excellent shell judgment")
	})

	it("rejects duplicate approval from the same approver", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		const nominationId = createNomination(database)

		database.run(
			"insert into nomination_approvals (nomination_id, approver_id) values (?, ?)",
			[nominationId, "approver-1"]
		)

		expect(() =>
			database.run(
				"insert into nomination_approvals (nomination_id, approver_id) values (?, ?)",
				[nominationId, "approver-1"]
			)
		).toThrow()
	})
})
