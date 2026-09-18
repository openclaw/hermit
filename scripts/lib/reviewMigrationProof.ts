import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { getPlatformProxy } from "wrangler"

export async function applyReviewMigrations(db: D1Database, directory: string, files: string[]) {
	for (const file of files) {
		const source = await readFile(resolve(directory, file), "utf8")
		for (const statement of source.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
			await db.prepare(statement).run()
		}
	}
}

export async function assertReviewSchema(db: D1Database) {
	const columns = (await db.prepare("PRAGMA table_info(review_cases)")
		.all<{ name: string; type: string; notnull: number; dflt_value: string | null }>()).results
	for (const [name, type] of [
		["card_revision", "INTEGER"], ["synced_card_revision", "INTEGER"],
		["previous_delivery_status", "TEXT"], ["review_message_id", "TEXT"],
		["review_channel_id", "TEXT"]
	]) {
		const column = columns.find((item) => item.name === name)
		assert(column, `Missing review_cases.${name}`)
		assert.equal(column.type.toUpperCase(), type)
	}
	for (const name of ["card_revision", "synced_card_revision", "previous_delivery_status"]) {
		assert.equal(columns.find((item) => item.name === name)?.notnull, 1)
	}
	const indexes = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
		.all<{ name: string }>()).results.map((item) => item.name)
	for (const name of [
		"review_cases_case_id_unique", "idx_review_cases_guild_target", "idx_review_cases_status",
		"idx_review_cases_review_msg", "review_observations_message_id_unique",
		"idx_review_obs_guild_author", "idx_review_obs_author", "idx_review_obs_channel", "idx_review_obs_message"
	]) assert(indexes.includes(name), `Missing index ${name}`)

	const insert = `INSERT INTO review_cases
		(case_id, guild_id, target_user_id, heuristic_score, concordance, behavioral_families)
		VALUES ('schema-proof-case', 'synthetic-guild', 'synthetic-user', 0, 'Low', '[]')`
	await db.prepare(insert).run()
	const created = await db.prepare("SELECT * FROM review_cases WHERE case_id = 'schema-proof-case'")
		.first<{ card_revision: number; synced_card_revision: number; status: string }>()
	assert(created)
	assert.equal(created.card_revision, 1)
	assert.equal(created.synced_card_revision, 1)
	assert.equal(created.status, "open")
	await assert.rejects(() => db.prepare(insert).run(), /UNIQUE/i)
	await db.prepare("UPDATE review_cases SET card_revision = card_revision + 1 WHERE case_id = 'schema-proof-case'").run()
	assert.equal((await db.prepare("SELECT card_revision FROM review_cases WHERE case_id = 'schema-proof-case'")
		.first<{ card_revision: number }>())?.card_revision, 2)
	await db.prepare("DELETE FROM review_cases WHERE case_id = 'schema-proof-case'").run()

	const observation = `INSERT INTO review_observations
		(message_id, guild_id, channel_id, author_id, created_at, content_length, line_count, fingerprint, artifacts)
		VALUES ('schema-proof-message', 'synthetic-guild', 'synthetic-channel', 'synthetic-user',
		'2026-01-01T00:00:00.000Z', 0, 0, 'synthetic', '[]')`
	await db.prepare(observation).run()
	await assert.rejects(() => db.prepare(observation).run(), /UNIQUE/i)
	await db.prepare("DELETE FROM review_observations WHERE message_id = 'schema-proof-message'").run()
}

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`
const canonicalRow = (row: Record<string, unknown>) =>
	JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])))

export async function snapshotLegacyTables(db: D1Database, tableNames: string[]) {
	const result: Record<string, unknown> = {}
	for (const table of tableNames) {
		const schema = await db.prepare(
			"SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name = ? ORDER BY type, name"
		).bind(table).all()
		const rows = await db.prepare(`SELECT * FROM ${identifier(table)}`).all<Record<string, unknown>>()
		const sequence = await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").bind(table).first()
		result[table] = { schema: schema.results, rows: rows.results.map(canonicalRow).sort(), sequence }
	}
	return result
}

export async function verifyPopulatedReviewUpgrade(
	directory: string,
	files: string[],
	proofRoot: string,
	registerDisposer: (dispose: () => Promise<void>) => void
) {
	const split = files.findIndex((file) => file.startsWith("0013_"))
	assert.equal(split, 13, "Expected migrations 0000 through 0012 before review schema")
	for (let index = 0; index < split; index++) {
		assert(files[index]?.startsWith(`${String(index).padStart(4, "0")}_`), "Migration sequence has a gap")
	}
	const upgradeRoot = resolve(proofRoot, "populated-upgrade")
	await mkdir(upgradeRoot, { recursive: true })
	const configPath = resolve(upgradeRoot, "wrangler.json")
	await writeFile(configPath, JSON.stringify({
		name: "hermit-review-upgrade-proof",
		compatibility_date: "2026-09-08",
		compatibility_flags: ["nodejs_compat"],
		d1_databases: [{ binding: "DB", database_name: "hermit-upgrade-proof", database_id: "00000000-0000-0000-0000-000000000002" }]
	}))
	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath, envFiles: [], remoteBindings: false,
		persist: { path: resolve(upgradeRoot, "state") }
	})
	let disposed = false
	const dispose = async () => {
		if (!disposed) {
			await proxy.dispose()
			disposed = true
		}
	}
	// The outer owner retries disposal before deleting either persistence tree.
	registerDisposer(dispose)
	let originalError: unknown
	try {
		const db = proxy.env.DB
		await applyReviewMigrations(db, directory, files.slice(0, split))
		assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'review_cases'").first(), null)
		await db.prepare("INSERT INTO keyValue (key, value, createdAt, updatedAt) VALUES ('proof-key-1', 'initial-data-val', 1700000000000, 1700000000000)").run()
		await db.prepare("INSERT INTO tracked_threads (thread_id, created_at, solved, raw_payload) VALUES ('thread-proof-1', '2026-09-01T00:00:00.000Z', 1, '{}')").run()
		const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all<{ name: string }>()).results.map((item) => item.name)
		const before = await snapshotLegacyTables(db, tables)

		// The actual upgrade happens AFTER fixtures and their full snapshots.
		await applyReviewMigrations(db, directory, files.slice(split))
		assert.deepEqual(await snapshotLegacyTables(db, tables), before)
		await assertReviewSchema(db)

		// Negative control: the same preservation assertion must detect damage.
		await db.prepare("UPDATE keyValue SET value = 'deliberately-corrupted' WHERE key = 'proof-key-1'").run()
		const corrupted = await snapshotLegacyTables(db, tables)
		assert.throws(() => assert.deepEqual(corrupted, before), { name: "AssertionError" })
		await db.prepare("UPDATE keyValue SET value = 'initial-data-val' WHERE key = 'proof-key-1'").run()
		assert.deepEqual(await snapshotLegacyTables(db, tables), before)
		console.log(`Local D1 populated upgrade verified: ${files[split]} through ${files.at(-1)}; negative control detected corruption.`)
	} catch (error) {
		originalError = error
		throw error
	} finally {
		try {
			await dispose()
		} catch (cleanupError) {
			if (originalError) console.error("Upgrade proxy disposal also failed:", cleanupError)
			else throw cleanupError
		}
	}
}
