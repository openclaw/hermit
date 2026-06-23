import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { nominationConfig } from "../src/config/nominations.js"

const nominationMigrationPaths = readdirSync("drizzle")
	.filter((file) => /000[456]_.*\.sql/.test(file))
	.sort()

if (nominationMigrationPaths.length !== 3) {
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
	it("requires two configured approvals", () => {
		expect(nominationConfig.requiredApprovals).toBe(2)
		expect(nominationConfig.maxReasonLength).toBeLessThanOrEqual(500)
	})

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
			.query("select reason, required_approvals as requiredApprovals from nominations where id = ?")
			.get(nominationId) as { reason: string; requiredApprovals: number }

		expect(row.count).toBe(2)
		expect(nomination.reason).toBe("excellent shell judgment")
		expect(nomination.requiredApprovals).toBe(2)
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

	it("allows only one submitted nomination per nominee and target role", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		createNomination(database)

		expect(() => createNomination(database)).toThrow()
	})

	it("allows a new nomination after the previous nomination is approved", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		const nominationId = createNomination(database)
		database.run("update nominations set status = ? where id = ?", [
			"approved",
			nominationId
		])

		createNomination(database)

		const row = database
			.query("select count(*) as count from nominations")
			.get() as { count: number }
		expect(row.count).toBe(2)
	})
})
