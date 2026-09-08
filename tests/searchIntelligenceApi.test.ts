import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { readFileSync } from "node:fs"
import type { Client } from "@buape/carbon"
import { handleSearchIntelligenceApiRequest } from "../src/clawhubSearchIntelligence/api.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const validPayload = {
	kind: "plugin_search_weekly",
	weekStart: Date.UTC(2026, 7, 31),
	weekEnd: Date.UTC(2026, 8, 7),
	minimumSearches: 3,
	coverage: {
		dataThrough: Date.UTC(2026, 8, 7),
		collectionStartedAt: Date.UTC(2026, 7, 1),
		gapStart: null,
		gapEnd: null
	},
	dashboardUrl:
		"https://clawhub.ai/management/search-insights?endDay=1788739200000",
	totalSearches: 12,
	sourceCounts: { clawhubWeb: 8, openclawControlUi: 4 },
	classificationStatus: "available",
	currentMetadataStatus: "available",
	truncated: false,
	companyOpportunities: [
		{
			query: "notion",
			searches: 5,
			previousSearches: 3,
			officialGaps: 5,
			searchUrl: "https://clawhub.ai/plugins?q=notion",
			companyProductName: "Notion",
			confidence: 0.95
		}
	],
	officialGaps: [
		{
			query: "notion",
			searches: 5,
			previousSearches: 3,
			officialGaps: 5,
			searchUrl: "https://clawhub.ai/plugins?q=notion"
		}
	],
	featuredCandidates: [
		{
			query: "memory",
			searches: 4,
			previousSearches: 2,
			officialGaps: 0,
			searchUrl: "https://clawhub.ai/plugins?q=memory",
			package: {
				name: "memory-kit",
				displayName: "Memory Kit",
				url: "https://clawhub.ai/plugins/memory-kit"
			}
		}
	],
	movers: [
		{
			query: "notion",
			searches: 5,
			previousSearches: 3,
			officialGaps: 5,
			searchUrl: "https://clawhub.ai/plugins?q=notion"
		}
	]
}
let mockClock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined
const owners: SqliteD1Database[] = []
const setup = () => {
	const owner = new SqliteD1Database()
	owner.database.exec(
		readFileSync(
			new URL("../drizzle/0000_productive_tinkerer.sql", import.meta.url),
			"utf8"
		)
	)
	owners.push(owner)
	setRuntimeEnv({
		DB: owner as unknown as D1Database,
		CLAWHUB_HERMIT_TOKEN: "test-service-token",
		DISCORD_CLIENT_ID: "bot-user"
	} as Env)
	const posts: Array<{ route: string; body: Record<string, unknown> }> = []
	const client = {
		rest: {
			post: async (
				route: string,
				{ body }: { body: Record<string, unknown> }
			) => {
				posts.push({ route, body })
				return { id: "message-1" }
			},
			get: async () => []
		}
	} as unknown as Client
	return { owner, client, posts }
}
const request = (
	payload: unknown = validPayload,
	authorization = "Bearer test-service-token"
) =>
	new Request(
		"https://forms.openclaw.ai/api/clawhub-search-intelligence/weekly",
		{
			method: "POST",
			headers: {
				Authorization: authorization,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		}
	)
const texts = (component: unknown): string[] => {
	if (!component || typeof component !== "object") return []
	const row = component as { content?: string; components?: unknown[] }
	return [
		...(typeof row.content === "string" ? [row.content] : []),
		...(row.components ?? []).flatMap(texts)
	]
}
afterEach(() => {
	mockClock?.mockRestore()
	mockClock = undefined
	for (const owner of owners.splice(0)) owner.close()
})

describe("ClawHub weekly search intelligence receiver", () => {
	it("delivers bounded aggregate facts with Carbon V2 and no mentions", async () => {
		const { client, posts } = setup()
		const response = await handleSearchIntelligenceApiRequest(request(), client)
		expect(response?.status).toBe(200)
		expect(posts).toHaveLength(1)
		expect(posts[0].route).toBe("/channels/1498032057337647295/messages")
		expect(posts[0].body.allowed_mentions).toEqual({ parse: [] })
		expect(posts[0].body.flags).toBe(32768)
		expect(posts[0].body).not.toHaveProperty("content")
		expect(posts[0].body.embeds).toBeUndefined()
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text).toContain("Company plugin opportunities")
		expect(text).toContain("Official gaps")
		expect(text).toContain("Featured candidates")
		expect(text).toContain("Week-over-week movers")
		expect(text).toContain("12 searches")
		expect(text).toContain("Notion")
	})
	it("authenticates before parsing and only handles its POST endpoint", async () => {
		const { client, posts } = setup()
		expect(
			await handleSearchIntelligenceApiRequest(
				new Request("https://example.com/unrelated"),
				client
			)
		).toBeNull()
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request(validPayload, "Bearer wrong"),
					client
				)
			)?.status
		).toBe(401)
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					new Request(
						"https://example.com/api/clawhub-search-intelligence/weekly",
						{ headers: { Authorization: "Bearer test-service-token" } }
					),
					client
				)
			)?.status
		).toBe(405)
		expect(posts).toHaveLength(0)
	})

	it("rejects unknown, private, unbounded, inconsistent or untrusted aggregate payloads", async () => {
		const { client, posts } = setup()
		const invalid = [
			{ ...validPayload, userId: "forbidden" },
			{
				...validPayload,
				coverage: { ...validPayload.coverage, deviceId: "forbidden" }
			},
			{
				...validPayload,
				sourceCounts: { ...validPayload.sourceCounts, api: 1 }
			},
			{
				...validPayload,
				sourceCounts: { ...validPayload.sourceCounts, clawhubWeb: 9 }
			},
			{ ...validPayload, minimumSearches: 1 },
			{ ...validPayload, weekEnd: validPayload.weekEnd + 1 },
			{ ...validPayload, totalSearches: -1 },
			{ ...validPayload, totalSearches: Number.MAX_SAFE_INTEGER + 1 },
			{ ...validPayload, dashboardUrl: "https://evil.example/" },
			{ ...validPayload, dashboardUrl: "https://secret@clawhub.ai/" },
			{
				...validPayload,
				dashboardUrl: "https://clawhub.ai/" + "a".repeat(2049)
			},
			{
				...validPayload,
				companyOpportunities: [
					{ ...validPayload.companyOpportunities[0], confidence: 0.4 }
				]
			},
			{
				...validPayload,
				companyOpportunities: [
					{ ...validPayload.companyOpportunities[0], officialGaps: 6 }
				]
			},
			{
				...validPayload,
				officialGaps: [
					{ ...validPayload.officialGaps[0], searches: 2, officialGaps: 2 }
				]
			},
			{
				...validPayload,
				officialGaps: Array(6).fill(validPayload.officialGaps[0])
			},
			{
				...validPayload,
				officialGaps: [
					{ ...validPayload.officialGaps[0], query: "a".repeat(257) }
				]
			},
			{
				...validPayload,
				featuredCandidates: [
					{
						...validPayload.featuredCandidates[0],
						package: {
							...validPayload.featuredCandidates[0].package,
							isOfficial: true
						}
					}
				]
			},
			{ ...validPayload, classificationStatus: "unavailable" },
			{ ...validPayload, classificationStatus: ["available"] },
			{ ...validPayload, currentMetadataStatus: ["available"] },
			{
				...validPayload,
				dashboardUrl: "https://clawhub.ai/" + "<".repeat(1000)
			},
			{ ...validPayload, currentMetadataStatus: "unavailable" },
			{
				...validPayload,
				coverage: { ...validPayload.coverage, gapStart: validPayload.weekStart }
			}
		]
		for (const payload of invalid) {
			expect(
				(await handleSearchIntelligenceApiRequest(request(payload), client))
					?.status
			).toBe(400)
		}
		const malformed = request()
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					new Request(malformed.url, {
						method: "POST",
						headers: malformed.headers,
						body: "{"
					}),
					client
				)
			)?.status
		).toBe(400)
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request({ padding: "x".repeat(65537) }),
					client
				)
			)?.status
		).toBe(413)
		expect(posts).toHaveLength(0)
	})

	it("persists one immutable receipt per week across duplicate requests", async () => {
		const { client, posts, owner } = setup()
		const first = await handleSearchIntelligenceApiRequest(request(), client)
		const reordered = Object.fromEntries(Object.entries(validPayload).reverse())
		const replay = await handleSearchIntelligenceApiRequest(
			request(reordered),
			client
		)
		expect(await first?.json()).toEqual({
			ok: true,
			delivered: true,
			weekEnd: validPayload.weekEnd
		})
		expect(await replay?.json()).toEqual({
			ok: true,
			delivered: true,
			weekEnd: validPayload.weekEnd
		})
		expect(posts).toHaveLength(1)
		expect(posts[0].body.enforce_nonce).toBe(true)
		expect(String(posts[0].body.nonce).length).toBeLessThanOrEqual(25)
		const changed = { ...validPayload, truncated: true }
		expect(
			(await handleSearchIntelligenceApiRequest(request(changed), client))
				?.status
		).toBe(409)
		expect(posts).toHaveLength(1)
		const rows = owner.database
			.query("SELECT value FROM keyValue")
			.all() as Array<{ value: string }>
		expect(rows).toHaveLength(1)
		expect(JSON.parse(rows[0].value).messageId).toBe("message-1")
		expect(rows[0].value).not.toContain("notion")
	})

	it("holds concurrent duplicates behind the durable claim", async () => {
		const { client, posts } = setup()
		let release!: () => void
		let started!: () => void
		const sending = new Promise<void>((resolve) => {
			started = resolve
		})
		const blocked = new Promise<void>((resolve) => {
			release = resolve
		})
		const original = client.rest.post.bind(client.rest)
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			started()
			await blocked
			return original(...args)
		}) as typeof client.rest.post
		const first = handleSearchIntelligenceApiRequest(request(), client)
		await sending
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(409)
		release()
		expect((await first)?.status).toBe(200)
		expect(posts).toHaveLength(1)
	})
	it("retries only confirmed Discord rejection, preserving the weekly nonce", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		let attempts = 0
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			if (++attempts === 1)
				throw Object.assign(new Error("Forbidden"), { status: 403 })
			return original(...args)
		}) as typeof client.rest.post
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(502)
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(attempts).toBe(2)
		expect(posts).toHaveLength(1)
	})

	it("reconciles an accepted message after a lost Discord response without reposting", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			await original(...args)
			throw new Error("Response lost")
		}) as typeof client.rest.post
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		client.rest.get = async () => [
			{
				id: "message-1",
				author: { id: "bot-user", bot: true },
				timestamp: new Date().toISOString(),
				components: posts[0].body.components
			}
		]
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
	})
	it("never blindly replays an uncertain message when channel history cannot confirm it", async () => {
		const { client } = setup()
		let posts = 0
		client.rest.post = async () => {
			posts++
			throw new Error("Timed out")
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		for (let retry = 0; retry < 3; retry++)
			expect(
				(await handleSearchIntelligenceApiRequest(request(), client))?.status
			).toBe(503)
		expect(posts).toBe(1)
	})

	it("shows incomplete coverage, unavailable enrichments and a localhost preview label", async () => {
		const { client, posts, owner } = setup()
		setRuntimeEnv({
			DB: owner as unknown as D1Database,
			CLAWHUB_HERMIT_TOKEN: "test-service-token",
			CLAWHUB_SITE_URL: "http://localhost:4311",
			DISCORD_CLIENT_ID: "bot-user"
		} as Env)
		const payload = {
			...validPayload,
			dashboardUrl: "http://localhost:4311/management/search-insights",
			totalSearches: 0,
			sourceCounts: { clawhubWeb: 0, openclawControlUi: 0 },
			coverage: {
				dataThrough: null,
				collectionStartedAt: null,
				gapStart: validPayload.weekStart,
				gapEnd: validPayload.weekEnd
			},
			classificationStatus: "unavailable",
			currentMetadataStatus: "unavailable",
			companyOpportunities: [],
			officialGaps: [],
			featuredCandidates: [],
			movers: []
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text).toContain("LOCAL PREVIEW")
		expect(text).toContain("Data through: unknown")
		expect(text).toContain("Collection started: unknown")
		expect(text).toContain("Collection gap")
		expect(text).toContain("Incomplete collection history")
		expect(text).toContain("Classification unavailable")
		expect(text).toContain("Current package metadata unavailable")
	})
	it("caps rendered text while retaining sections, coverage and the dashboard link", async () => {
		const { client, posts } = setup()
		const query = "@everyone [click](https://evil.example) ".repeat(5)
		const rows = Array.from({ length: 5 }, (_, index) => ({
			...validPayload.officialGaps[0],
			query: query + index,
			searchUrl: "https://clawhub.ai/plugins?q=" + "x".repeat(1000)
		}))
		const payload = {
			...validPayload,
			truncated: true,
			companyOpportunities: rows.map((row) => ({ ...row, confidence: 0.9 })),
			officialGaps: rows,
			movers: rows,
			featuredCandidates: rows.map((row) => ({
				...row,
				package: validPayload.featuredCandidates[0].package
			}))
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text.length).toBeLessThanOrEqual(4000)
		expect(text).toContain("Company plugin opportunities")
		expect(text).toContain("Official gaps")
		expect(text).toContain("Featured candidates")
		expect(text).toContain("Week-over-week movers")
		expect(text).toContain(validPayload.dashboardUrl)
		expect(text).toContain("More rows on the dashboard")
		expect(text).toContain("Input capped")
		expect(text).not.toContain("@everyone")
		expect(text).not.toContain("[click](https://evil.example)")
	})

	it("does not send without the durable claim and reconciles a post-send receipt failure", async () => {
		const { client, posts, owner } = setup()
		owner.database.exec(
			"CREATE TRIGGER fail_claim BEFORE INSERT ON keyValue BEGIN SELECT RAISE(FAIL, 'storage down'); END"
		)
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		expect(posts).toHaveLength(0)
		owner.database.exec(
			"DROP TRIGGER fail_claim; CREATE TRIGGER fail_receipt BEFORE UPDATE ON keyValue BEGIN SELECT RAISE(FAIL, 'storage down'); END"
		)
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		expect(posts).toHaveLength(1)
		owner.database.exec("DROP TRIGGER fail_receipt")
		const now = Date.now()
		mockClock = spyOn(Date, "now").mockReturnValue(now + 300_000)
		client.rest.get = async () => [
			{
				id: "message-1",
				author: { id: "bot-user", bot: true },
				timestamp: new Date(now).toISOString(),
				components: posts[0].body.components
			}
		]
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
	})
	it("rejects copied or stale history and bounds reconciliation reads", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			await original(...args)
			throw Object.assign(new Error("Gateway failure"), { status: 502 })
		}) as typeof client.rest.post
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		const row = {
			id: "message-1",
			author: { id: "another-user", bot: true },
			timestamp: new Date().toISOString(),
			components: posts[0].body.components
		}
		client.rest.get = async () => [row]
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		client.rest.get = async () => [
			{
				...row,
				author: { id: "bot-user", bot: true },
				timestamp: "2020-01-01T00:00:00.000Z"
			}
		]
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		let reads = 0
		client.rest.get = async () => {
			reads++
			return Array.from({ length: 100 }, (_, i) => ({
				...row,
				id: `${reads}-${i}`
			}))
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		expect(reads).toBe(5)
		client.rest.get = async () => {
			throw Object.assign(new Error("Missing history permission"), {
				status: 403
			})
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(503)
		expect(posts).toHaveLength(1)
	})

	it("includes threshold-qualified movers that dropped to zero without exposing rare weeks", async () => {
		const { client, posts } = setup()
		const payload = {
			...validPayload,
			movers: [
				{
					...validPayload.movers[0],
					searches: 0,
					previousSearches: 4,
					officialGaps: 0
				}
			]
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text).toContain("0 searches · 0 gaps · previous 4")
		const tooRare = {
			...payload,
			movers: [{ ...payload.movers[0], searches: 1, previousSearches: 2 }]
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(tooRare), client))
				?.status
		).toBe(400)
		expect(posts).toHaveLength(1)
	})
})
