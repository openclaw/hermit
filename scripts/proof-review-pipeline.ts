/** Local D1 binding checks with MOCKED Discord transport. Not staging/deployment evidence.
 * Usage: bun scripts/proof-review-pipeline.ts
 */
import assert from "node:assert/strict"
import { assertReviewSchema, verifyPopulatedReviewUpgrade } from "./lib/reviewMigrationProof.js"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { readdirSync } from "node:fs"
import { getPlatformProxy } from "wrangler"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { reviewConfig } from "../src/config/review.js"
import {
	createReviewCase,
	getReviewCase,
	recordReviewCaseDecision,
	markReviewCardSynced,
	markReviewCardStaleWrite,
	getUndeliveredEscalations,
	listOutOfSyncCases
} from "../src/data/review.js"
import {
	postReviewEscalationCard,
	syncSharedReviewCard,
	recoverSharedCardSync
} from "../src/services/reviewNotifier.js"

const proofDir = resolve("/tmp/hermit-review-proof-" + Date.now())
await mkdir(proofDir, { recursive: true })

console.log("=== LOCAL D1 BINDINGS + MOCKED DISCORD TRANSPORT ===")
console.log(`Proof Directory: ${proofDir}\n`)

const disposers: Array<() => Promise<void>> = []
let originalError: unknown
const previousBotId = process.env.DISCORD_CLIENT_ID
process.env.DISCORD_CLIENT_ID = "900000000000000001"

try {
	// -------------------------------------------------------------
	// STEP 1: Fresh Local D1 Binding & Migration Verification
	// -------------------------------------------------------------
	console.log("--- STEP 1: Fresh Local D1 Binding ---")
	const configPath = resolve(proofDir, "wrangler.json")
	await writeFile(
		configPath,
		JSON.stringify({
			name: "hermit-proof-d1",
			compatibility_date: "2026-09-08",
			compatibility_flags: ["nodejs_compat"],
			d1_databases: [
				{
					binding: "DB",
					database_name: "hermit-proof-db",
					database_id: "00000000-0000-0000-0000-000000000001"
				}
			]
		})
	)

	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath,
		envFiles: [],
		remoteBindings: false,
		persist: { path: resolve(proofDir, "d1-state") }
	})

	disposers.push(() => proxy.dispose())

	setRuntimeEnv({
		DB: proxy.env.DB
	})

	// Read and apply all SQL migrations in order
	const drizzleDir = resolve(import.meta.dir, "../drizzle")
	const sqlFiles = readdirSync(drizzleDir)
		.filter((f) => f.endsWith(".sql"))
		.sort()

	console.log(`Applying ${sqlFiles.length} migrations to clean D1 instance...`)
	for (const file of sqlFiles) {
		const sqlContent = await readFile(resolve(drizzleDir, file), "utf8")
		const statements = sqlContent
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean)
		for (const statement of statements) {
			await proxy.env.DB.prepare(statement).run()
		}
	}

	await assertReviewSchema(proxy.env.DB)
	console.log(`Fresh local D1 schema verified through ${sqlFiles.at(-1)}.`)

	// A different database is migrated to 0012, seeded, snapshotted, THEN upgraded.
	await verifyPopulatedReviewUpgrade(drizzleDir, sqlFiles, proofDir, (dispose) => disposers.push(dispose))

	// -------------------------------------------------------------
	// STEP 3: Staff Review Creation & Card Delivery
	// -------------------------------------------------------------
	console.log("\n--- STEP 3: Case Creation & Delivery ---")
	const caseId = `case-${reviewConfig.guildId}-proof-target`
	const created = await createReviewCase({
		caseId,
		guildId: reviewConfig.guildId,
		targetUserId: "900000000000000002",
		status: "escalated",
		heuristicScore: 92,
		concordance: "High",
		behavioralFamilies: JSON.stringify(["operational-artifact", "stylometry", "repetition"]),
		deliveryStatus: "pending"
	})
	assert(created)
	assert.equal(created.status, "escalated")
	console.log(`Created synthetic case in local D1:`)
	console.log(`  Case ID: ${created?.caseId}`)
	console.log(`  Status: ${created?.status}`)
	console.log(`  Delivery Status: ${created?.deliveryStatus}`)
	console.log(`  Card Revision: ${created?.cardRevision}`)

	// Deliver escalation card
	const deliveredMessageId = "900000000000000003"
	let lastCard: unknown
	let postCount = 0
	const mockDiscord = {
		rest: {
			get: async () => [],
			post: async (_route: string, opts: any) => {
				postCount++
				lastCard = opts.body
				return { id: deliveredMessageId }
			},
			patch: async (_route: string, opts: any) => {
				lastCard = opts.body
				return { id: deliveredMessageId }
			}
		}
	} as any

	await postReviewEscalationCard(mockDiscord, created!, null, null)
	const afterPost = await getReviewCase(caseId)
	assert.equal(afterPost?.reviewMessageId, deliveredMessageId)
	assert.equal(afterPost?.deliveryStatus, "delivered")
	assert.equal(afterPost?.cardRevision, afterPost?.syncedCardRevision)
	assert.equal(postCount, 1)
	console.log(`Delivered card through MOCKED Discord transport:`)
	console.log(`  reviewMessageId: ${afterPost?.reviewMessageId}`)
	console.log(`  deliveryStatus: ${afterPost?.deliveryStatus}`)
	console.log(`  syncedCardRevision: ${afterPost?.syncedCardRevision}`)

	// -------------------------------------------------------------
	// STEP 4: Staff Decision (Watchlist 7d) & Monotonic Revisions
	// -------------------------------------------------------------
	console.log("\n--- STEP 4: Staff Action & Monotonic Revision Persistence ---")
	const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
	const decided = await recordReviewCaseDecision(caseId, {
		status: "watchlist",
		expiresAt,
		decidedById: "staff-operator-1",
		decisionReason: "Observed automated timing; watchlisting 7d."
	})
	assert(decided)
	assert.equal(decided.status, "watchlist")
	assert(decided.cardRevision > decided.syncedCardRevision)
	console.log(`Staff decision atomically recorded before mocked Discord I/O:`)
	console.log(`  Status: ${decided?.status}`)
	console.log(`  ExpiresAt: ${decided?.expiresAt}`)
	console.log(`  Card Revision bumped to: ${decided?.cardRevision} (synced was ${decided?.syncedCardRevision})`)

	// Sync shared card to Discord
	await syncSharedReviewCard(mockDiscord, decided!)
	const afterSync = await getReviewCase(caseId)
	assert(afterSync)
	assert.equal(afterSync.syncedCardRevision, afterSync.cardRevision)
	assert(JSON.stringify(lastCard).includes("WATCHLIST"))
	console.log(`Shared card synced through MOCKED transport:`)
	console.log(`  syncedCardRevision: ${afterSync?.syncedCardRevision}`)

	// -------------------------------------------------------------
	// STEP 5: Stale Write Rejection & Automatic Repair
	// -------------------------------------------------------------
	console.log("\n--- STEP 5: Stale Write Detection & Repair Scheduling ---")
	// Simulate an older delayed sync for revision 1 completing after revision 2
	const staleAttempt = await markReviewCardSynced(caseId, 1)
	assert.equal(staleAttempt, null)
	console.log(`Delayed sync attempt for revision 1 result: ${staleAttempt ? "ACCEPTED" : "REJECTED (Correct)"}`)

	// Schedule repair on stale write
	const repaired = await markReviewCardStaleWrite(caseId, 1)
	assert(repaired && repaired.cardRevision > repaired.syncedCardRevision)
	console.log(`markReviewCardStaleWrite allocated repair revision: ${repaired?.cardRevision}`)
	const outOfSync = await listOutOfSyncCases(5)
	assert(outOfSync.some((item) => item.caseId === caseId))
	await recoverSharedCardSync(mockDiscord)
	const recovered = await getReviewCase(caseId)
	assert.equal(recovered?.cardRevision, recovered?.syncedCardRevision)
	console.log(`Maintenance detected out-of-sync cases: ${outOfSync.length} case(s) queued for sync repair`)

	// -------------------------------------------------------------
	// STEP 6: Pending Priority and Uncertainty Backoff
	// -------------------------------------------------------------
	console.log("\n--- STEP 6: Pending Priority and Uncertainty Backoff ---")
	const now = Date.now()
	await proxy.env.DB.prepare(
		`INSERT INTO review_cases (case_id, guild_id, target_user_id, status, heuristic_score, concordance, behavioral_families, delivery_status, updated_at)
		 VALUES ('proof-unc-recent', '${reviewConfig.guildId}', 'u-1', 'escalated', 90, 'High', '[]', 'uncertain', '${new Date(now - 15_000).toISOString()}'),
		        ('proof-unc-old', '${reviewConfig.guildId}', 'u-2', 'escalated', 90, 'High', '[]', 'uncertain', '${new Date(now - 90_000).toISOString()}'),
		        ('proof-pending-new', '${reviewConfig.guildId}', 'u-3', 'escalated', 90, 'High', '[]', 'pending', '${new Date(now - 5_000).toISOString()}')`
	).run()

	const escalations = await getUndeliveredEscalations(reviewConfig.guildId, 10)
	const ids = escalations.map((e) => e.caseId)
	console.log("Candidate recovery ordering (least-recently attempted & prioritized):")
	ids.forEach((id, idx) => console.log(`  ${idx + 1}. ${id}`))
	assert.equal(ids[0], "proof-pending-new")
	assert(ids.includes("proof-unc-old"))
	assert(!ids.includes("proof-unc-recent"))
	console.log("Verified pending priority and recent-uncertainty backoff for these fixtures.")

	console.log("\nLocal D1 / mocked transport assertions passed. No live Worker, Discord, or model-provider run was performed.")
} catch (error) {
	originalError = error
	throw error
} finally {
	if (previousBotId === undefined) delete process.env.DISCORD_CLIENT_ID
	else process.env.DISCORD_CLIENT_ID = previousBotId
	let cleanupError: unknown
	const disposed = await Promise.allSettled(disposers.map((dispose) => dispose()))
	const failures = disposed.filter((result) => result.status === "rejected")
	if (failures.length) {
		cleanupError = new AggregateError(failures.map((result) => result.reason), "Local proxy disposal failed")
	}
	// Do not remove persistence beneath a still-running proxy.
	if (!cleanupError) {
		try { await rm(proofDir, { recursive: true, force: true }) }
		catch (error) { cleanupError = error }
	}
	if (cleanupError) {
		if (originalError) console.error("Proof cleanup also failed:", cleanupError)
		else throw cleanupError
	}
}
