import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { nominationConfig } from "../src/config/nominations.js"

const nominationMigrationPaths = readdirSync("drizzle")
	.filter((file) => /000[4-8]_.*\.sql/.test(file))
	.sort()

if (nominationMigrationPaths.length !== 5) {
	throw new Error("Could not find nomination migrations")
}

const nominationExpiryMigrationPath = nominationMigrationPaths.find((path) =>
	path.startsWith("0007_")
)

if (!nominationExpiryMigrationPath) {
	throw new Error("Could not find nomination expiry migration")
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
			expires_at,
			target_role_id,
			required_approvals,
			status
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			"guild-1",
			"channel-1",
			"nominee-1",
			"nominator-1",
			"excellent shell judgment",
			"2099-01-01T00:00:00.000Z",
			"role-1",
			3,
			"submitted"
		]
	)

	return Number(database.query("select last_insert_rowid() as id").get()?.id)
}

describe("nomination migration", () => {
	it("requires three configured approvals", () => {
		expect(nominationConfig.requiredApprovals).toBe(3)
		expect(nominationConfig.maxReasonLength).toBeLessThanOrEqual(500)
	})

	it("allows three distinct approvers for one nomination", () => {
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
		database.run(
			"insert into nomination_approvals (nomination_id, approver_id) values (?, ?)",
			[nominationId, "approver-3"]
		)

		const row = database
			.query("select count(*) as count from nomination_approvals")
			.get() as { count: number }
		const nomination = database
			.query("select reason, required_approvals as requiredApprovals from nominations where id = ?")
			.get(nominationId) as { reason: string; requiredApprovals: number }

		expect(row.count).toBe(3)
		expect(nomination.reason).toBe("excellent shell judgment")
		expect(nomination.requiredApprovals).toBe(3)
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

	it("keeps a granting nomination active while the role grant is retried", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		const nominationId = createNomination(database)
		database.run("update nominations set status = ? where id = ?", [
			"granting",
			nominationId
		])

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

	it("allows a new nomination after the previous nomination is expired", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
		const nominationId = createNomination(database)
		database.run("update nominations set status = ? where id = ?", [
			"expired",
			nominationId
		])

		createNomination(database)

		const row = database
			.query("select count(*) as count from nominations")
			.get() as { count: number }
		expect(row.count).toBe(2)
	})

	it("backfills expiry for nominations created before expiry columns existed", () => {
		const database = new Database(":memory:")
		const expiryMigrationIndex = nominationMigrationPaths.indexOf(
			nominationExpiryMigrationPath
		)
		for (const migrationPath of nominationMigrationPaths.slice(0, expiryMigrationIndex)) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
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
				3,
				"submitted"
			]
		)

		applyMigration(database, `drizzle/${nominationExpiryMigrationPath}`)

		const row = database
			.query("select created_at as createdAt, expires_at as expiresAt from nominations")
			.get() as { createdAt: string; expiresAt: string }
		expect(row.expiresAt).toBeString()
		expect(row.expiresAt > row.createdAt).toBe(true)
	})

	it("expires submitted nominations left with a null expiry timestamp", () => {
		const database = new Database(":memory:")
		for (const migrationPath of nominationMigrationPaths) {
			applyMigration(database, `drizzle/${migrationPath}`)
		}
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
				created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-49 hours'))`,
			[
				"guild-1",
				"channel-1",
				"nominee-1",
				"nominator-1",
				"excellent shell judgment",
				null,
				"role-1",
				3,
				"submitted"
			]
		)
		const deadline = `coalesce(expires_at, strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+${nominationConfig.expirationHours} hours'))`

		database.run(
			`update nominations
				set status = 'expired'
				where guild_id = ?
					and nominee_id = ?
					and target_role_id = ?
					and status = 'submitted'
					and ${deadline} <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			["guild-1", "nominee-1", "role-1"]
		)

		const expired = database
			.query("select status from nominations where expires_at is null")
			.get() as { status: string }
		expect(expired.status).toBe("expired")
		createNomination(database)
	})
})
