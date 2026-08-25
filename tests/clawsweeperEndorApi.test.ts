import { describe, expect, it } from "bun:test"
import type { Client } from "@buape/carbon"
import {
	buildEndorRemediationContainer,
	endorDeliveryIdentity,
	handleClawSweeperEndorApi,
	handleClawSweeperEndorApiRequest,
	parseEndorRemediationNotification,
	type EndorRemediationNotification
} from "../src/clawsweeperEndor/api.js"
import type {
	ClaimEndorDeliveryInput,
	ClaimEndorDeliveryResult
} from "../src/clawsweeperEndor/deliveries.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const head = "a".repeat(40)
const idempotencyKey = [
	"clawsweeper.endor_remediation_reviewed",
	"openclaw/openclaw",
	"123",
	head,
	"ready"
].join(":")

const validNotification: EndorRemediationNotification = {
	version: 1,
	type: "clawsweeper.endor_remediation_reviewed",
	repo: "openclaw/openclaw",
	prNumber: 123,
	prUrl: "https://github.com/openclaw/openclaw/pull/123",
	title: "Update a vulnerable dependency",
	findingSummary: "No remaining findings",
	reviewedHeadSha: head,
	outcome: "ready",
	reviewSummary: "Three exact-head reviews were clean",
	reviewUrl: "https://github.com/openclaw/openclaw/pull/123#issuecomment-456",
	checks: {
		state: "passing",
		total: 4,
		summary: "4 checks passed"
	},
	mergeState: "clean",
	cycles: 3,
	cleanStreak: 3,
	idempotencyKey
}

const delivery = (
	input: ClaimEndorDeliveryInput,
	overrides: Partial<ClaimEndorDeliveryResult["delivery"]> = {}
): ClaimEndorDeliveryResult["delivery"] => ({
	...input,
	status: "pending",
	messageId: null,
	createdAt: "2026-08-24T00:00:00.000Z",
	updatedAt: "2026-08-24T00:00:00.000Z",
	deliveredAt: null,
	...overrides
})

const request = (
	body: unknown = validNotification,
	headers: Record<string, string> = {}
) => new Request("https://hermit.example/api/clawsweeper/endor-remediation/reviewed", {
	method: "POST",
	headers: {
		authorization: "Bearer secret",
		"content-type": "application/json",
		"idempotency-key": idempotencyKey,
		...headers
	},
	body: JSON.stringify(body)
})

const dependencies = (options: {
	claimState?: ClaimEndorDeliveryResult["state"]
	deliveryOverrides?: Partial<ClaimEndorDeliveryResult["delivery"]>
	now?: Date
} = {}) => {
	const claims: ClaimEndorDeliveryInput[] = []
	const sends: Array<{ channelId: string; message: unknown; nonce: string }> = []
	const marks: Array<{ idempotencyKey: string; payloadDigest: string; messageId: string }> = []
	return {
		claims,
		sends,
		marks,
		value: {
			token: "secret",
			channelId: "channel-security",
			now: () => options.now ?? new Date("2026-08-24T00:01:00.000Z"),
			claimDelivery: async (input: ClaimEndorDeliveryInput) => {
				claims.push(input)
				return {
					state: options.claimState ?? "claimed",
					delivery: delivery(input, options.deliveryOverrides)
				} as ClaimEndorDeliveryResult
			},
			markDelivered: async (
				key: string,
				payloadDigest: string,
				messageId: string
			) => {
				marks.push({ idempotencyKey: key, payloadDigest, messageId })
			},
			sendMessage: async (channelId: string, message: unknown, nonce: string) => {
				sends.push({ channelId, message, nonce })
				return { messageId: "discord-message-123" }
			}
		}
	}
}

const collectText = (component: unknown): string[] => {
	if (!component || typeof component !== "object") {
		return []
	}
	const record = component as Record<string, unknown>
	const content = typeof record.content === "string" ? [record.content] : []
	const children = Array.isArray(record.components)
		? record.components.flatMap(collectText)
		: []
	return [...content, ...children]
}

describe("ClawSweeper Endor notification API", () => {
	it("posts a validated notification to Hermit's fixed channel", async () => {
		const deps = dependencies()
		const response = await handleClawSweeperEndorApi(request(), deps.value)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual({
			ok: true,
			delivered: true,
			duplicate: false,
			messageId: "discord-message-123"
		})
		expect(deps.claims).toHaveLength(1)
		expect(deps.sends).toHaveLength(1)
		expect(deps.sends[0]?.channelId).toBe("channel-security")
		expect(deps.sends[0]?.nonce).toHaveLength(25)
		expect(deps.marks).toEqual([{
			idempotencyKey,
			payloadDigest: deps.claims[0]?.payloadDigest,
			messageId: "discord-message-123"
		}])

		const sent = deps.sends[0]?.message as {
			components?: unknown[]
			allowedMentions?: unknown
		}
		expect(sent.allowedMentions).toEqual({ roles: [], users: [] })
		const text = (sent.components ?? []).flatMap(collectText).join("\n")
		expect(text).toContain("Endor remediation reviewed — READY")
		expect(text).toContain("3/3 clean after 3/6 cycles")
		expect(text).toContain("@clawsweeper automerge")
	})

	it("returns a durable receipt without sending a delivered replay", async () => {
		const deps = dependencies({
			claimState: "existing",
			deliveryOverrides: {
				status: "delivered",
				messageId: "discord-message-original",
				deliveredAt: "2026-08-24T00:00:10.000Z"
			}
		})
		const response = await handleClawSweeperEndorApi(request(), deps.value)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual({
			ok: true,
			delivered: true,
			duplicate: true,
			messageId: "discord-message-original"
		})
		expect(deps.sends).toHaveLength(0)
		expect(deps.marks).toHaveLength(0)
	})

	it("reuses Discord's deterministic nonce for an immediate pending retry", async () => {
		const first = dependencies()
		const retry = dependencies({ claimState: "existing" })
		await handleClawSweeperEndorApi(request(), first.value)
		const response = await handleClawSweeperEndorApi(request(), retry.value)

		expect(response?.status).toBe(200)
		expect(first.sends[0]?.nonce).toBe(retry.sends[0]?.nonce)
		expect(await response?.json()).toMatchObject({ duplicate: true })
	})

	it("fails closed when an old pending receipt has ambiguous Discord state", async () => {
		const deps = dependencies({
			claimState: "existing",
			now: new Date("2026-08-24T01:00:00.000Z")
		})
		const response = await handleClawSweeperEndorApi(request(), deps.value)

		expect(response?.status).toBe(409)
		expect(deps.sends).toHaveLength(0)
		expect(await response?.json()).toEqual({
			error: "Delivery status is ambiguous; inspect the configured Discord channel before retrying"
		})
	})

	it("rejects unauthenticated, malformed, and mismatched requests", async () => {
		const deps = dependencies()
		const unauthorized = await handleClawSweeperEndorApi(
			request(validNotification, { authorization: "Bearer wrong" }),
			deps.value
		)
		const wrongUrl = await handleClawSweeperEndorApi(
			request({ ...validNotification, prUrl: "https://evil.example/openclaw/openclaw/pull/123" }),
			deps.value
		)
		const wrongKey = await handleClawSweeperEndorApi(
			request(validNotification, { "idempotency-key": "wrong" }),
			deps.value
		)

		expect(unauthorized?.status).toBe(401)
		expect(wrongUrl?.status).toBe(400)
		expect(wrongKey?.status).toBe(400)
		expect(deps.sends).toHaveLength(0)
	})

	it("escapes event text before rendering Discord markdown", () => {
		const parsed = parseEndorRemediationNotification({
			...validNotification,
			title: "Safe [click](https://evil.example) @everyone",
			findingSummary: "No finding\n[trap](https://evil.example)"
		})
		expect(parsed).not.toBeNull()
		if (!parsed) {
			return
		}
		const text = collectText(buildEndorRemediationContainer(parsed)).join("\n")
		expect(text).toContain("\\[click\\]\\(https://evil\\.example\\)")
		expect(text).toContain("\\[trap\\]\\(https://evil\\.example\\)")
		expect(text).not.toContain("[click](https://evil.example)")
	})

	it("derives stable but content-sensitive delivery identities", async () => {
		const first = await endorDeliveryIdentity(validNotification)
		const replay = await endorDeliveryIdentity(validNotification)
		const changed = await endorDeliveryIdentity({
			...validNotification,
			reviewSummary: "Changed content"
		})

		expect(first).toEqual(replay)
		expect(first.nonce).toHaveLength(25)
		expect(first.payloadDigest).not.toBe(changed.payloadDigest)
		expect(first.nonce).toBe(changed.nonce)
	})

	it("persists the real receipt and sends Discord with enforced nonce deduplication", async () => {
		const owner = new SqliteD1Database()
		const migration = await Bun.file(
			new URL("../drizzle/0013_many_chameleon.sql", import.meta.url)
		).text()
		for (const statement of migration.split("--> statement-breakpoint")) {
			if (statement.trim()) {
				await owner.exec(statement)
			}
		}
		setRuntimeEnv({
			DB: owner as unknown as D1Database,
			CLAWSWEEPER_HERMIT_TOKEN: "secret",
			CLAWSWEEPER_ENDOR_DISCORD_CHANNEL_ID: "channel-security"
		} as Env)

		const posts: Array<{ route: string; body: Record<string, unknown> }> = []
		const client = {
			rest: {
				post: async (route: string, options: { body: Record<string, unknown> }) => {
					posts.push({ route, body: options.body })
					return { id: "discord-message-real" }
				}
			}
		} as unknown as Client

		const first = await handleClawSweeperEndorApiRequest(request(), client)
		const replay = await handleClawSweeperEndorApiRequest(request(), client)

		expect(first?.status).toBe(200)
		expect(replay?.status).toBe(200)
		expect(await replay?.json()).toMatchObject({
			delivered: true,
			duplicate: true,
			messageId: "discord-message-real"
		})
		expect(posts).toHaveLength(1)
		expect(posts[0]?.route).toBe("/channels/channel-security/messages")
		expect(posts[0]?.body.enforce_nonce).toBe(true)
		expect(posts[0]?.body.nonce).toHaveLength(25)
		expect(Array.isArray(posts[0]?.body.components)).toBe(true)

		const stored = owner.database
			.query("select status, message_id from endor_notification_deliveries")
			.get() as { status: string; message_id: string }
		expect(stored).toEqual({
			status: "delivered",
			message_id: "discord-message-real"
		})
		owner.close()
	})
})
