import { afterEach, beforeEach, it, mock, spyOn } from "bun:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { type Client, serializePayload } from "@buape/carbon"
import { SqliteD1Database } from "./helpers/sqliteD1.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { reviewConfig } from "../src/config/review.js"
import * as data from "../src/data/review.js"
import type { NewReviewCase, ReviewCase } from "../src/db/schema.js"
import { ReviewDismissButton, ReviewWatchlistButton, ReviewConfirmBotButton, buildReviewCardContainer } from "../src/components/reviewButtons.js"
import { postReviewEscalationCard, syncSharedReviewCard, recoverReviewReceipts, recoverSharedCardSync } from "../src/services/reviewNotifier.js"
import { runReviewMaintenance } from "../src/services/reviewMaintenance.js"

const BOT = "900000000000000001"
const MESSAGE = "900000000000000003"
let db: SqliteD1Database
let priorBotId: string | undefined

beforeEach(() => {
	priorBotId = process.env.DISCORD_CLIENT_ID
	process.env.DISCORD_CLIENT_ID = BOT
	db = new SqliteD1Database()
	db.database.exec(readFileSync("drizzle/0013_reflective_rictor.sql", "utf8"))
	setRuntimeEnv({ DB: db as unknown as D1Database })
})
afterEach(() => {
	mock.restore()
	db.close()
	if (priorBotId === undefined) delete process.env.DISCORD_CLIENT_ID
	else process.env.DISCORD_CLIENT_ID = priorBotId
})

async function seed(overrides: Partial<NewReviewCase> = {}) {
	const result = await data.createReviewCase({
		caseId: "synthetic-case", guildId: reviewConfig.guildId, targetUserId: "900000000000000002",
		status: "escalated", heuristicScore: 90, concordance: "High", behavioralFamilies: "[]",
		reviewChannelId: reviewConfig.reviewChannelId, ...overrides
	})
	assert(result)
	return result
}
async function current(caseId = "synthetic-case") {
	const result = await data.getReviewCase(caseId)
	assert(result)
	return result
}
function gate() {
	let release!: () => void
	const promise = new Promise<void>((resolve) => { release = resolve })
	return { promise, release }
}
function payload(row: ReviewCase) {
	return serializePayload({ components: [buildReviewCardContainer(row, null, null, row.status !== "escalated")], allowedMentions: { parse: [] } })
}
function fakeDiscord() {
	const cards = new Map<string, any>()
	const state = { posts: 0, patches: 0, gets: [] as string[] }
	const transport = {
		rest: {
			get: async (route: string, options?: any): Promise<any> => {
				state.gets.push(route)
				const id = route.split("/").at(-1)!
				if (id !== "messages") return cards.get(id)
				const messages = [...cards.values()]
				const start = options?.before ? messages.findIndex((item) => item.id === options.before) + 1 : 0
				return messages.slice(start, start + (options?.limit ?? 50))
			},
			post: async (_route: string, options: any): Promise<any> => {
				state.posts++
				cards.set(MESSAGE, { ...options.body, id: MESSAGE, channel_id: reviewConfig.reviewChannelId, author: { id: BOT, bot: true } })
				return { id: MESSAGE }
			},
			patch: async (route: string, options: any): Promise<any> => {
				state.patches++
				const id = route.split("/").at(-1)!
				cards.set(id, { ...options.body, id, channel_id: reviewConfig.reviewChannelId, author: { id: BOT, bot: true } })
				return { id }
			}
		}
	}
	return { transport, client: transport as unknown as Client, cards, state }
}
function setCard(fake: ReturnType<typeof fakeDiscord>, row: ReviewCase, id = MESSAGE) {
	fake.cards.set(id, { ...payload(row), id, channel_id: reviewConfig.reviewChannelId, author: { id: BOT, bot: true } })
}
const hasStatus = (fake: ReturnType<typeof fakeDiscord>, status: string, id = MESSAGE) =>
	JSON.stringify(fake.cards.get(id)).includes(`**Status:** ${status}`)
function interaction(fake: ReturnType<typeof fakeDiscord>, update: (options: any) => Promise<unknown>, messageId = MESSAGE) {
	return {
		client: fake.client, guildId: reviewConfig.guildId, channelId: reviewConfig.reviewChannelId,
		member: { roles: [{ id: reviewConfig.staffRoleIds[0] }] }, user: { id: "synthetic-staff" },
		userId: "synthetic-staff", message: { id: messageId }, update,
		reply: async () => { throw new Error("Unexpected rejection") }
	} as any
}

it("keeps repair pending when an old PATCH applies after a newer acknowledgment then throws", async () => {
	const old = await seed({ status: "dismissed", reviewMessageId: MESSAGE, deliveryStatus: "delivered", cardRevision: 2, syncedCardRevision: 1 })
	const fake = fakeDiscord()
	const started = gate(), release = gate()
	const patch = fake.transport.rest.patch
	let first = true
	fake.transport.rest.patch = async (route, options) => {
		if (first) {
			first = false
			started.release()
			await release.promise
			await patch(route, options)
			throw new Error("applied remotely, response lost")
		}
		return patch(route, options)
	}
	const pending = syncSharedReviewCard(fake.client, old)
	await started.promise
	await data.recordReviewCaseDecision(old.caseId, { status: "confirmed_bot", decidedById: "newer-staff", decisionReason: "newer decision" })
	await syncSharedReviewCard(fake.client, await current())
	assert.equal((await current()).syncedCardRevision, 3)
	release.release()
	assert.equal(await pending, false)
	assert(hasStatus(fake, "DISMISSED"))
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
	await recoverSharedCardSync(fake.client)
	assert(hasStatus(fake, "CONFIRMED_BOT"))
	assert.equal((await current()).cardRevision, (await current()).syncedCardRevision)
})

const buttons = [
	[ReviewDismissButton, "dismissed"], [ReviewWatchlistButton, "watchlist"], [ReviewConfirmBotButton, "confirmed_bot"]
] as const
for (const [ButtonType, disposition] of buttons) {
	it(`${disposition}: repairs an ambiguously failed shared-message interaction`, async () => {
		const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "delivered" })
		const fake = fakeDiscord(), started = gate(), release = gate()
		const pending = new ButtonType().run(interaction(fake, async (options) => {
			started.release()
			await release.promise
			await fake.transport.rest.patch(`/channels/${reviewConfig.reviewChannelId}/messages/${MESSAGE}`, { body: serializePayload(options) })
			throw new Error("interaction applied, response lost")
		}), { caseId: row.caseId })
		await started.promise
		const latest = disposition === "confirmed_bot" ? "dismissed" : "confirmed_bot"
		await data.recordReviewCaseDecision(row.caseId, { status: latest, decidedById: "newer-staff", decisionReason: "newer decision" })
		await syncSharedReviewCard(fake.client, await current())
		release.release()
		await pending
		const result = await current()
		assert.equal(result.status, latest)
		assert(result.cardRevision > 3)
		assert.equal(result.cardRevision, result.syncedCardRevision)
		assert(hasStatus(fake, latest.toUpperCase()))
	})
	it(`${disposition}: ephemeral response failure does not skip shared synchronization`, async () => {
		const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "delivered" })
		const fake = fakeDiscord()
		await new ButtonType().run(interaction(fake, async () => { throw new Error("ephemeral response lost") }, "ephemeral-only"), { caseId: row.caseId })
		assert.equal((await current()).status, disposition)
		assert.equal(fake.state.patches, 1)
		assert.equal((await current()).cardRevision, (await current()).syncedCardRevision)
		assert(hasStatus(fake, disposition.toUpperCase()))
	})
}

it("ephemeral response success never acknowledges a failed shared PATCH", async () => {
	const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "delivered" })
	const fake = fakeDiscord()
	fake.transport.rest.patch = async () => { throw new Error("shared transport unavailable") }
	await new ReviewDismissButton().run(interaction(fake, async () => ({}), "ephemeral-only"), { caseId: row.caseId })
	assert.equal((await current()).status, "dismissed")
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
})

for (const status of ["dismissed", "watchlist", "confirmed_bot"] as const) {
	for (const deliveryStatus of ["uncertain", "delivering"] as const) {
		it(`recovers ${deliveryStatus} receipt after ${status} without a replacement POST`, async () => {
			const row = await seed({ status, deliveryStatus, updatedAt: new Date(Date.now() - 180_000).toISOString(), cardRevision: 2 })
			const fake = fakeDiscord()
			setCard(fake, { ...row, status: "escalated" })
			await recoverReviewReceipts(fake.client)
			const result = await current()
			assert.equal(fake.state.posts, 0)
			assert.equal(result.status, status)
			assert.equal(result.reviewMessageId, MESSAGE)
			assert.equal(result.deliveryStatus, "delivered")
			assert.equal(result.cardRevision, result.syncedCardRevision)
			assert(hasStatus(fake, status.toUpperCase()))
		})
	}
}

it("recovers an accepted POST whose response is lost after an ephemeral decision", async () => {
	const row = await seed()
	const fake = fakeDiscord(), post = fake.transport.rest.post
	fake.transport.rest.post = async (route, options) => {
		await post(route, options)
		await new ReviewDismissButton().run(interaction(fake, async () => ({}), "ephemeral-only"), { caseId: row.caseId })
		throw new Error("accepted POST, response lost")
	}
	await postReviewEscalationCard(fake.client, row)
	assert.equal((await current()).status, "dismissed")
	assert.equal((await current()).reviewMessageId, null)
	db.database.query("UPDATE review_cases SET updated_at = ? WHERE case_id = ?").run(new Date(Date.now() - 180_000).toISOString(), row.caseId)
	await recoverReviewReceipts(fake.client)
	assert.equal(fake.state.posts, 1)
	assert.equal((await current()).reviewMessageId, MESSAGE)
	assert(hasStatus(fake, "DISMISSED"))
})

it("reloads the current decision when a case changes during receipt lookup", async () => {
	const row = await seed({ deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord(), get = fake.transport.rest.get
	setCard(fake, row)
	fake.transport.rest.get = async (route, options) => {
		await data.recordReviewCaseDecision(row.caseId, { status: "confirmed_bot", decidedById: "staff", decisionReason: "decided during lookup" })
		return get(route, options)
	}
	await recoverReviewReceipts(fake.client)
	assert.equal((await current()).status, "confirmed_bot")
	assert(hasStatus(fake, "CONFIRMED_BOT"))
	assert.equal(fake.state.posts, 0)
})

it("verifies a known uncertain receipt even when the revision pair started clean", async () => {
	const row = await seed({ status: "dismissed", reviewMessageId: MESSAGE, deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	setCard(fake, { ...row, status: "escalated" })
	await recoverReviewReceipts(fake.client)
	assert(fake.state.gets[0]?.endsWith(`/messages/${MESSAGE}`))
	assert.equal((await current()).deliveryStatus, "delivered")
	assert.equal(fake.state.posts, 0)
	assert(hasStatus(fake, "DISMISSED"))
})

it("recognizes the permanent marker on a closed card with no decision buttons", async () => {
	const row = await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	setCard(fake, row)
	assert(!JSON.stringify(fake.cards.get(MESSAGE)).includes("review-dismiss:caseId="))
	await recoverReviewReceipts(fake.client)
	assert.equal((await current()).reviewMessageId, MESSAGE)
})

it("rejects another bot and another case whose ID merely contains the requested ID", async () => {
	const row = await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	setCard(fake, { ...row, status: "escalated", caseId: row.caseId + "-other" })
	setCard(fake, row, "900000000000000004")
	fake.cards.get("900000000000000004").author.id = "other-bot"
	await recoverReviewReceipts(fake.client)
	assert.equal((await current()).reviewMessageId, null)
	assert.equal((await current()).deliveryStatus, "uncertain")
	assert.equal(fake.state.posts, 0)
	assert.equal((await data.listOutstandingReviewReceipts(reviewConfig.guildId)).length, 0)
})

it("finds a matching receipt beyond the first history page", async () => {
	const row = await seed({ deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	for (let index = 0; index < 50; index++) setCard(fake, { ...row, caseId: `unrelated-${index}` }, `page-one-${index}`)
	setCard(fake, row)
	await recoverReviewReceipts(fake.client)
	assert.equal(fake.state.gets.length, 2)
	assert.equal((await current()).reviewMessageId, MESSAGE)
	assert.equal(fake.state.posts, 0)
})

it("keeps a missing receipt uncertain and applies retry backoff", async () => {
	await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	await recoverReviewReceipts(fake.client)
	assert.equal(fake.state.posts, 0)
	assert.equal((await current()).deliveryStatus, "uncertain")
	assert.equal((await data.listOutstandingReviewReceipts(reviewConfig.guildId)).length, 0)
})

it("rejects stale snapshot attachment and refuses a conflicting receipt identity", async () => {
	const row = await seed({ deliveryStatus: "uncertain" })
	await data.recordReviewCaseDecision(row.caseId, { status: "dismissed", decidedById: "staff", decisionReason: "newer" })
	assert.equal(await data.attachReviewCaseReceipt(row, reviewConfig.reviewChannelId, MESSAGE), null)
	const fresh = await current()
	const attached = await data.attachReviewCaseReceipt(fresh, reviewConfig.reviewChannelId, MESSAGE)
	assert(attached)
	assert.equal(attached.status, "dismissed")
	assert(attached.cardRevision > attached.syncedCardRevision)
	await assert.rejects(() => data.attachReviewCaseReceipt(attached, reviewConfig.reviewChannelId, "different-message"), /Conflicting/)
	assert.equal((await current()).reviewMessageId, MESSAGE)
	assert.equal(await data.deferReviewReceiptReconciliation(row), null)
	assert.equal((await current()).deliveryStatus, "delivered")
})

it("bounds stale acknowledgment retries while leaving discoverable dirty work", async () => {
	const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "delivered", cardRevision: 2, syncedCardRevision: 1 })
	const fake = fakeDiscord(), patch = fake.transport.rest.patch
	fake.transport.rest.patch = async (route, options) => {
		await patch(route, options)
		await data.recordReviewCaseDecision(row.caseId, { status: "dismissed", decidedById: "staff", decisionReason: "concurrent change" })
		return {}
	}
	assert.equal(await syncSharedReviewCard(fake.client, row), false)
	assert.equal(fake.state.patches, 3)
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
	assert((await data.listOutOfSyncCases()).some((item) => item.caseId === row.caseId))
})

it("does not let an earlier maintenance-stage failure skip receipt reconciliation", async () => {
	const row = await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	setCard(fake, row)
	spyOn(data, "expireWatchlistCases").mockRejectedValue(new Error("expiry stage unavailable"))
	await runReviewMaintenance(fake.client)
	assert.equal((await current()).reviewMessageId, MESSAGE)
	assert.equal(fake.state.posts, 0)
})

it("continues shared-card recovery after another card fails", async () => {
	await seed({ caseId: "first", reviewMessageId: "first-message", deliveryStatus: "delivered", cardRevision: 2, syncedCardRevision: 1 })
	await seed({ caseId: "second", reviewMessageId: MESSAGE, deliveryStatus: "delivered", cardRevision: 2, syncedCardRevision: 1 })
	const fake = fakeDiscord(), patch = fake.transport.rest.patch
	fake.transport.rest.patch = async (route, options) => {
		if (route.endsWith("/first-message")) throw new Error("first card unavailable")
		return patch(route, options)
	}
	await recoverSharedCardSync(fake.client)
	assert((await current("first")).cardRevision > (await current("first")).syncedCardRevision)
	assert.equal((await current("second")).cardRevision, (await current("second")).syncedCardRevision)
})

it("preserves repair work when an old re-escalation PATCH applies and loses its response", async () => {
	const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "pending" })
	const fake = fakeDiscord(), started = gate(), release = gate()
	const patch = fake.transport.rest.patch
	let first = true
	fake.transport.rest.patch = async (route, options) => {
		if (first) {
			first = false
			started.release()
			await release.promise
			await patch(route, options)
			throw new Error("re-escalation applied, response lost")
		}
		return patch(route, options)
	}
	const pending = postReviewEscalationCard(fake.client, row)
	await started.promise
	await data.recordReviewCaseDecision(row.caseId, { status: "dismissed", decidedById: "staff", decisionReason: "newer decision" })
	await syncSharedReviewCard(fake.client, await current())
	release.release()
	await pending
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
	await recoverSharedCardSync(fake.client)
	assert(hasStatus(fake, "DISMISSED"))
	assert.equal(fake.state.posts, 0)
})

it("surfaces a failure to persist ambiguous-write repair instead of returning success", async () => {
	const row = await seed({ reviewMessageId: MESSAGE, deliveryStatus: "delivered", cardRevision: 2, syncedCardRevision: 1 })
	const fake = fakeDiscord()
	fake.transport.rest.patch = async () => { throw new Error("transport response lost") }
	spyOn(data, "markReviewCardStaleWrite").mockRejectedValue(new Error("repair persistence unavailable"))
	await assert.rejects(() => syncSharedReviewCard(fake.client, row), /repair persistence unavailable/)
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
})

it("keeps an adopted receipt dirty when its first canonical PATCH fails", async () => {
	const row = await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord(), patch = fake.transport.rest.patch
	setCard(fake, { ...row, status: "escalated" })
	fake.transport.rest.patch = async () => { throw new Error("PATCH unavailable after receipt persisted") }
	await recoverReviewReceipts(fake.client)
	assert.equal((await current()).reviewMessageId, MESSAGE)
	assert.equal((await current()).deliveryStatus, "delivered")
	assert((await current()).cardRevision > (await current()).syncedCardRevision)
	fake.transport.rest.patch = patch
	await recoverSharedCardSync(fake.client)
	assert(hasStatus(fake, "DISMISSED"))
	assert.equal(fake.state.posts, 0)
})

it("treats exhausted history budget as unresolved without posting a replacement", async () => {
	const row = await seed({ status: "dismissed", deliveryStatus: "uncertain", updatedAt: new Date(Date.now() - 180_000).toISOString() })
	const fake = fakeDiscord()
	for (let index = 0; index < 250; index++) setCard(fake, { ...row, caseId: `unrelated-${index}` }, `history-${index}`)
	setCard(fake, row)
	await recoverReviewReceipts(fake.client)
	assert.equal(fake.state.gets.length, 5)
	assert.equal((await current()).reviewMessageId, null)
	assert.equal((await current()).deliveryStatus, "uncertain")
	assert.equal(fake.state.posts, 0)
	assert.equal((await data.listOutstandingReviewReceipts(reviewConfig.guildId)).length, 0)
})
