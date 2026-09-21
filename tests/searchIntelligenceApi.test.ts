import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { readFileSync } from "node:fs"
import {
	Container,
	TextDisplay,
	serializePayload,
	type Client
} from "@buape/carbon"
import { deliverWeeklyDigest } from "../src/clawhubSearchIntelligence/delivery.js"
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
const evidencePayload = () => {
	const search = {
		matchedSearches7d: 4,
		previous7d: 2,
		searches30d: 8,
		queries: [
			{
				query: "memory",
				scope: "catalog",
				searches7d: 4,
				previous7d: 2,
				searches30d: 8
			}
		],
		omittedQueries: 0,
		periodStart: validPayload.weekStart,
		periodEnd: validPayload.weekEnd,
		dataThrough: validPayload.weekEnd,
		collectionStartedAt: validPayload.coverage.collectionStartedAt
	}
	const adoption = {
		source: "package-trending",
		rank: 2,
		snapshotId: "package-week-1",
		rankingVersion: "package-trending",
		periodStart: validPayload.weekStart,
		periodEnd: validPayload.weekEnd,
		generatedAt: validPayload.weekEnd,
		sourceObservedAt: null,
		downloads: 341,
		installs: 1,
		bookmarks: null,
		lifetimeInstalls: null
	}
	const recommendation = {
		artifactKind: "plugin",
		id: "plugin:memory-kit",
		displayName: "Memory Kit",
		url: "https://clawhub.ai/plugins/memory-kit",
		category: "memory",
		support: "both",
		search,
		adoption,
		metadataCheckedAt: validPayload.weekEnd
	}
	const catalog = {
		totalSearches: validPayload.totalSearches,
		sourceCounts: validPayload.sourceCounts,
		coverage: validPayload.coverage,
		classificationStatus: "available",
		currentMetadataStatus: "available",
		adoption: {
			status: "available",
			generatedAt: validPayload.weekEnd,
			periodStart: validPayload.weekStart,
			periodEnd: validPayload.weekEnd,
			snapshotId: "synthetic",
			rankingVersion: "v1",
			totalItems: 1,
			inspectedItems: 1,
			truncated: false
		},
		companyOpportunities: validPayload.companyOpportunities.map((row) => ({
			...row,
			scope: "catalog"
		})),
		officialGaps: validPayload.officialGaps.map((row) => ({
			...row,
			scope: "catalog"
		})),
		movers: validPayload.movers.map((row) => ({ ...row, scope: "catalog" })),
		recommendations: [recommendation]
	}
	return {
		kind: "search_intelligence_weekly_v2",
		weekStart: validPayload.weekStart,
		weekEnd: validPayload.weekEnd,
		minimumSearches: 3,
		dashboardUrl: validPayload.dashboardUrl,
		truncated: false,
		catalogs: {
			plugins: catalog,
			skills: {
				...catalog,
				totalSearches: 0,
				sourceCounts: { clawhubWeb: 0, openclawControlUi: 0 },
				classificationStatus: "unavailable",
				companyOpportunities: [],
				officialGaps: [],
				movers: [],
				recommendations: [
					{
						...recommendation,
						artifactKind: "skill",
						id: "clawhub:homeassistant",
						displayName: "Homeassistant Skill",
						url: "https://clawhub.ai/example/skills/homeassistant",
						support: "adoption-only",
						search: null,
						adoption: {
							...adoption,
							source: "clawhub-trending",
							periodStart: validPayload.weekEnd - 86_400_000
						}
					}
				]
			}
		}
	}
}
const lineupPayload = () => {
	const base = evidencePayload()
	const catalog = (
		source: typeof base.catalogs.plugins | typeof base.catalogs.skills
	) => {
		const row = source.recommendations[0]
		const recommendations = Array.from({ length: 8 }, (_, index) => ({
			...row,
			id: `${row.id}-${index}`,
			displayName: `Discovery ${row.artifactKind} ${index}`,
			url: `${row.url}-${index}`,
			version: "1.0.0",
			support: index === 0 ? "current-only" : row.support,
			search: index === 0 ? null : row.search,
			adoption: index === 0 ? null : row.adoption
		}))
		return {
			...source,
			recommendations,
			lineup: {
				targetSize: 8,
				baseline: [
					...recommendations.slice(0, 2).map((entry) => ({
						id: entry.id,
						version: entry.version,
						featuredAt: 1
					})),
					{ id: `${row.id}-old`, version: "0.9.0", featuredAt: 1 }
				],
				changes: recommendations.map((entry, index) => ({
					id: entry.id,
					change: index < 2 ? "retain" : "add",
					emerging: index === 7
				})),
				removals: [
					{
						id: `${row.id}-old`,
						displayName: "Previous selection",
						url: `${row.url}-old`,
						reasons: ["outside-proposed-set"]
					}
				],
				shortfall: 0
			}
		}
	}
	return {
		...base,
		kind: "search_intelligence_weekly_v3",
		catalogs: {
			plugins: catalog(base.catalogs.plugins),
			skills: catalog(base.catalogs.skills)
		}
	}
}
const monthlyPayload = (longRows = false) => {
	const base = evidencePayload()
	const catalog = (
		source: typeof base.catalogs.plugins | typeof base.catalogs.skills
	) => {
		const row = source.recommendations[0]
		const plugin = row.artifactKind === "plugin"
		const recommendations = Array.from({ length: 16 }, (_, slot) => ({
			...row,
			id: `${row.id}-${slot}`,
			displayName: `Discovery ${row.artifactKind} ${slot}${longRows ? "_".repeat(80) : ""}`,
			url: `${row.url}-${slot}${longRows ? "?ref=" + "x".repeat(100) : ""}`,
			version: "1.0.0",
			slot,
			selectionBasis: plugin && slot < 8 ? "editorial" : "telemetry",
			reason:
				plugin && slot < 8 ? "Useful workflow." : "Monthly install priority.",
			support: "adoption-only",
			search: null,
			adoption: {
				source: plugin ? "package-daily-installs" : "skill-daily-installs",
				rank: slot + 1,
				installs30d: 100 - slot,
				installs7d: 30 - slot,
				importedRows: 0,
				importDatasetVersions: [] as string[]
			}
		}))
		return {
			...source,
			recommendations,
			adoption: {
				...source.adoption,
				totalItems: 16,
				inspectedItems: 16,
				periodStart: base.weekEnd - 30 * 86400000,
				periodStart7d: base.weekStart,
				collectionStartedAt: base.weekEnd,
				scannedRows: 480,
				importedRows: 0,
				importDatasetVersions: [] as string[]
			},
			lineup: {
				targetSize: 16,
				baseline: [] as {
					id: string
					version: string | null
					featuredAt: number
				}[],
				changes: recommendations.map(({ id }) => ({
					id,
					change: "add",
					emerging: false
				})),
				removals: [],
				shortfall: 0,
				reservedSlots: plugin ? 8 : 0,
				telemetryTarget: plugin ? 8 : 16,
				pendingCount: 0,
				telemetryShortfall: 0,
				editorialRevision: plugin ? 1 : 0,
				currentEditorialRevision: plugin ? 1 : 0,
				staleEditorial: false,
				reservations: plugin
					? recommendations.slice(0, 8).map((row) => ({
							slot: row.slot,
							id: row.id,
							name: row.id.slice(7),
							displayName: row.displayName,
							reason: row.reason,
							status: "ready",
							pendingReasons: [] as string[]
						}))
					: []
			}
		}
	}
	return {
		...base,
		kind: "search_intelligence_weekly_v4",
		catalogs: {
			plugins: catalog(base.catalogs.plugins),
			skills: catalog(base.catalogs.skills)
		}
	}
}
const links = (value: unknown): string[] => {
	if (!value || typeof value !== "object") return []
	const row = value as { url?: string; components?: unknown[] }
	return [
		...(row.url ? [row.url] : []),
		...(row.components ?? []).flatMap(links)
	]
}
const componentCount = (value: unknown): number => {
	if (!value || typeof value !== "object") return 0
	return (
		1 +
		((value as { components?: unknown[] }).components ?? []).reduce<number>(
			(total, child) => total + componentCount(child),
			0
		)
	)
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
	it("delivers every linked monthly recommendation in one compact message and replays it", async () => {
		const { client, posts } = setup()
		const payload = monthlyPayload()
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const rendered = posts.flatMap(({ body }) => texts(body)).join("\n")
		for (const catalog of Object.values(payload.catalogs))
			for (const row of catalog.recommendations) {
				expect(rendered).toContain(
					`• [${row.displayName}](<${row.url}>) · ${row.adoption.installs30d} installs`
				)
			}
		for (const { body } of posts) {
			expect(texts(body).join("\n").length).toBeLessThanOrEqual(4000)
			expect(componentCount(body) - 1).toBeLessThanOrEqual(40)
			expect(body.allowed_mentions).toEqual({ parse: [] })
		}
		expect(posts).toHaveLength(1)
		const count = posts.length
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(count)
	})

	it("keeps detailed evidence on the dashboard while preserving linked recommendations", async () => {
		const { client, posts } = setup()
		const payload = monthlyPayload()
		payload.truncated = true
		payload.catalogs.plugins.adoption.truncated = true
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const rendered = posts.flatMap(({ body }) => texts(body)).join("\n")
		expect(rendered).toContain("Featured recommendations")
		expect(rendered).toContain("30-day installs · 2026-08-08 – 2026-09-06 UTC")
		expect(rendered).toContain("**Plugins**")
		expect(rendered).toContain("**Skills**")
		for (const detail of [
			"notion",
			"Metadata checked",
			"Aggregate scan",
			"editorial",
			"monthly Featured review"
		])
			expect(rendered).not.toContain(detail)
		expect(posts.flatMap(({ body }) => links(body))).toContain(
			payload.dashboardUrl
		)
		const urls = [...rendered.matchAll(/\]\(<([^>]+)>\)/g)].map(
			(match) => match[1]
		)
		expect(urls).toEqual(
			Object.values(payload.catalogs).flatMap((catalog) =>
				catalog.recommendations.map((row) => row.url)
			)
		)
	})

	it("summarizes pending slots and stale selection without presenting missing counts as zero", async () => {
		const { client, posts } = setup()
		const payload = monthlyPayload()
		const plugins = payload.catalogs.plugins
		const pending = plugins.lineup.reservations[3]
		pending.status = "pending"
		pending.pendingReasons = ["no-public-version"]
		plugins.recommendations = plugins.recommendations.filter(
			({ slot }) => slot !== 3
		)
		plugins.lineup.changes = plugins.lineup.changes.filter(
			({ id }) => id !== pending.id
		)
		plugins.lineup.pendingCount = 1
		plugins.lineup.shortfall = 1
		plugins.lineup.currentEditorialRevision++
		plugins.lineup.staleEditorial = true
		Object.assign(plugins.recommendations[0], {
			adoption: null,
			support: "current-only"
		})
		Object.assign(plugins.recommendations[1].adoption, {
			installs30d: 0,
			installs7d: 0
		})
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const rendered = posts.flatMap(({ body }) => texts(body)).join("\n")
		expect(rendered).toContain("1 plugin slot pending")
		expect(rendered).toContain("refresh the report before approval")
		expect(rendered).toContain(
			`• [${plugins.recommendations[0].displayName}](<${plugins.recommendations[0].url}>) · installs unavailable`
		)
		expect(rendered).toContain(
			`• [${plugins.recommendations[1].displayName}](<${plugins.recommendations[1].url}>) · 0 installs`
		)
		expect(rendered).not.toContain(pending.id)
	})

	it("acknowledges a fully delivered report after its presentation changes without reposting", async () => {
		const { client, posts } = setup()
		const payload = monthlyPayload()
		expect(
			(
				await deliverWeeklyDigest(client, payload, [
					serializePayload({
						components: [
							new Container([
								new TextDisplay("Previously deployed presentation")
							])
						]
					})
				])
			).status
		).toBe(200)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
		payload.catalogs.skills.recommendations[0].reason =
			"Changed recommendation evidence"
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(409)
		expect(posts).toHaveLength(1)
	})

	it("pages long linked recommendations without dropping counts, breaking links or enabling mentions", async () => {
		const { client, posts } = setup()
		const payload = monthlyPayload(true)
		const row = payload.catalogs.plugins.recommendations[0]
		row.displayName = "@everyone [link](https://evil.example)"
		row.url = "https://clawhub.ai/plugins/" + "x".repeat(1900) + "?q=<test>"
		row.adoption.installs30d = 1234
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts.length).toBeGreaterThan(1)
		const rendered = posts.flatMap(({ body }) => texts(body)).join("\n")
		const urls = [...rendered.matchAll(/\]\(<([^>]+)>\)/g)].map(
			(match) => match[1]
		)
		expect(urls).toEqual(
			Object.values(payload.catalogs).flatMap((catalog) =>
				catalog.recommendations.map((r) => new URL(r.url).href)
			)
		)
		expect(rendered).toContain("1,234 installs")
		expect(rendered).not.toContain("@everyone")
		expect(rendered).not.toContain("[link](https://evil.example)")
		for (const { body } of posts) {
			expect(texts(body).join("\n").length).toBeLessThanOrEqual(4000)
			expect(componentCount(body) - 1).toBeLessThanOrEqual(40)
			expect(body.allowed_mentions).toEqual({ parse: [] })
		}
	})

	it("rejects monthly privacy, source, slot and period violations before durable claims", async () => {
		const { client, owner, posts } = setup()
		const mutations: ((p: ReturnType<typeof monthlyPayload>) => void)[] = [
			(p) => {
				Object.assign(p.catalogs.plugins.recommendations[0].adoption, {
					userId: "private"
				})
			},
			(p) => {
				p.catalogs.skills.recommendations[0].adoption.source =
					"package-daily-installs"
			},
			(p) => {
				p.catalogs.plugins.adoption.periodStart++
			},
			(p) => {
				p.catalogs.skills.adoption.periodStart7d++
			},
			(p) => {
				p.catalogs.plugins.adoption.importedRows = 481
			},
			(p) => {
				p.catalogs.skills.recommendations[0].adoption.installs7d = 101
			},
			(p) => {
				p.catalogs.skills.recommendations[0].slot = 1
			},
			(p) => {
				p.catalogs.plugins.lineup.reservations[0].id = "plugin:different"
			},
			(p) => {
				p.catalogs.plugins.lineup.reservations[0].status = "pending"
			},
			(p) => {
				p.catalogs.plugins.lineup.reservations[0].reason = "Different reason"
			},
			(p) => {
				p.catalogs.skills.recommendations[0].selectionBasis = "editorial"
			},
			(p) => {
				p.catalogs.plugins.lineup.staleEditorial = true
			},
			(p) => {
				p.catalogs.plugins.lineup.telemetryShortfall = 1
			},
			(p) => {
				p.catalogs.skills.recommendations[0].adoption.installs30d = 0
			},
			(p) => {
				Object.assign(p.catalogs.plugins.recommendations[0], {
					support: "both",
					search: {
						...evidencePayload().catalogs.plugins.recommendations[0].search,
						queries: [
							{
								query: "rare",
								scope: "catalog",
								searches7d: 2,
								previous7d: 0,
								searches30d: 2
							}
						]
					}
				})
			}
		]
		for (const mutate of mutations) {
			const payload = monthlyPayload()
			mutate(payload)
			expect(
				(await handleSearchIntelligenceApiRequest(request(payload), client))
					?.status
			).toBe(400)
		}
		expect(posts).toHaveLength(0)
		expect(
			owner.database.query("SELECT count(*) AS count FROM keyValue").get()
		).toEqual({ count: 0 })
	})
	it("serializes concurrent monthly deliveries and freezes the complete report before its first part", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		let release!: () => void
		let entered!: () => void
		const ready = new Promise<void>((resolve) => {
			entered = resolve
		})
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			entered()
			await gate
			return original(...args)
		}) as typeof client.rest.post
		const payload = monthlyPayload(true)
		const first = handleSearchIntelligenceApiRequest(request(payload), client)
		await ready
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(409)
		const changed = monthlyPayload(true)
		changed.catalogs.skills.recommendations[15].reason = "Changed final item"
		expect(
			(await handleSearchIntelligenceApiRequest(request(changed), client))
				?.status
		).toBe(409)
		release()
		expect((await first)?.status).toBe(200)
		const nonces = posts.map(({ body }) => body.nonce)
		expect(new Set(nonces).size).toBe(nonces.length)
		expect(nonces.length).toBeGreaterThan(1)
	})
	it("retries only a rejected monthly part and never reposts confirmed earlier parts", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		let calls = 0
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			if (++calls === 2)
				throw Object.assign(new Error("Rejected"), { status: 429 })
			return original(...args)
		}) as typeof client.rest.post
		const payload = monthlyPayload(true)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(502)
		expect(posts).toHaveLength(1)
		const firstNonce = posts[0].body.nonce
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts.filter(({ body }) => body.nonce === firstNonce)).toHaveLength(
			1
		)
		expect(posts.flatMap(({ body }) => texts(body)).join("\n")).toContain(
			payload.catalogs.skills.recommendations[15].url
		)
	})
	it("reconciles an uncertain middle monthly part before continuing the same report", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		let calls = 0
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			const result = await original(...args)
			if (++calls === 2) throw new Error("Response lost")
			return result
		}) as typeof client.rest.post
		const payload = monthlyPayload(true)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		expect(posts).toHaveLength(2)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		expect(posts).toHaveLength(2)
		client.rest.get = async () =>
			[
				{
					id: "confirmed-part-2",
					author: { id: "bot-user", bot: true },
					timestamp: new Date().toISOString(),
					components: posts[1].body.components
				}
			] as never
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts.length).toBeGreaterThan(2)
		expect(new Set(posts.map(({ body }) => body.nonce)).size).toBe(posts.length)
	})
	it("recovers a final monthly receipt write failure without repeating its confirmed parts", async () => {
		const { client, posts, owner } = setup()
		owner.database.exec(`CREATE TRIGGER fail_monthly_completion BEFORE UPDATE ON keyValue
			WHEN json_extract(NEW.value, '$.version') = 2 AND json_extract(NEW.value, '$.status') = 'sent'
			BEGIN SELECT RAISE(ABORT, 'fixture receipt unavailable'); END`)
		const payload = monthlyPayload(true)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		const count = posts.length
		expect(count).toBeGreaterThan(1)
		owner.database.exec("DROP TRIGGER fail_monthly_completion")
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(count)
		const receipts = owner.database
			.query("SELECT value FROM keyValue")
			.all() as { value: string }[]
		expect(
			receipts.every(({ value }) => JSON.parse(value).status === "sent")
		).toBe(true)
		expect(
			receipts.some(({ value }) =>
				value.includes(payload.catalogs.skills.recommendations[0].id)
			)
		).toBe(false)
	})

	it("preserves a sent v3 week when a monthly replacement arrives", async () => {
		const { client, posts } = setup()
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request(lineupPayload()),
					client
				)
			)?.status
		).toBe(200)
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request(monthlyPayload()),
					client
				)
			)?.status
		).toBe(409)
		expect(posts).toHaveLength(1)
	})

	it("delivers and replays the complete eight-per-catalog lineup without dropping long links", async () => {
		const { client, posts } = setup()
		const payload = lineupPayload()
		for (const catalog of Object.values(payload.catalogs))
			for (const row of catalog.recommendations)
				row.url += "?detail=" + "x".repeat(500)
		const before = JSON.stringify(payload)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
		const components = posts[0].body.components as unknown[]
		const text = components.flatMap(texts).join("\n")
		expect(text.length).toBeLessThanOrEqual(3900)
		expect(
			components.reduce<number>((total, row) => total + componentCount(row), 0)
		).toBeLessThanOrEqual(40)
		expect(components.flatMap(links)).toHaveLength(17)
		expect(components.flatMap(links).every((url) => url.length <= 512)).toBe(
			true
		)
		expect(text).toContain("Long links open the dashboard")
		for (const catalog of Object.values(payload.catalogs))
			for (const row of catalog.recommendations)
				expect(text).toContain(row.displayName)
		for (const expected of [
			"Plugins: 8/8",
			"Skills: 8/8",
			"Keep",
			"Add",
			"Emerging",
			"1 proposed removals",
			"window evidence unavailable",
			"341 downloads"
		])
			expect(text).toContain(expected)
		expect(text).toContain("notion")
		expect(JSON.stringify(payload)).toBe(before)
		expect(posts[0].body.allowed_mentions).toEqual({ parse: [] })
	})
	it("shows bookmarks when they support an adoption-only recommendation", async () => {
		const { client, posts } = setup()
		const payload = lineupPayload()
		const row = payload.catalogs.skills.recommendations[2]
		row.adoption = {
			...row.adoption!,
			downloads: 0,
			installs: 0,
			bookmarks: 11
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(
			(posts[0].body.components as unknown[]).flatMap(texts).join("\n")
		).toContain("11 bookmarks")
	})
	it("preserves all sixteen selections within the message budget at contract bounds", async () => {
		const { client, posts } = setup()
		const payload = lineupPayload()
		for (const catalog of Object.values(payload.catalogs)) {
			catalog.adoption.truncated = true
			catalog.totalSearches = Number.MAX_SAFE_INTEGER
			catalog.sourceCounts = {
				clawhubWeb: Number.MAX_SAFE_INTEGER,
				openclawControlUi: 0
			}
			for (const row of catalog.recommendations) {
				row.displayName = "_".repeat(120)
				row.support = "both"
				row.search = {
					...evidencePayload().catalogs.plugins.recommendations[0].search
				}
				row.adoption = {
					...evidencePayload().catalogs[
						row.artifactKind === "plugin" ? "plugins" : "skills"
					].recommendations[0].adoption
				}
				if (row.search) {
					row.search = {
						...row.search,
						matchedSearches7d: Number.MAX_SAFE_INTEGER,
						previous7d: 0,
						searches30d: Number.MAX_SAFE_INTEGER,
						queries: [],
						omittedQueries: 1
					}
				}
				if (row.adoption) {
					row.adoption.downloads = Number.MAX_SAFE_INTEGER
					row.adoption.installs = Number.MAX_SAFE_INTEGER
				}
			}
			for (const change of catalog.lineup.changes) change.emerging = true
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const components = posts[0].body.components as unknown[]
		expect(components.flatMap(texts).join("\n").length).toBeLessThanOrEqual(
			3900
		)
		expect(components.flatMap(links)).toHaveLength(17)
	})
	it("validates complete lineup membership and privacy before touching delivery state", async () => {
		const { client, posts, owner } = setup()
		const edits: ((payload: ReturnType<typeof lineupPayload>) => void)[] = [
			(payload) => {
				payload.catalogs.plugins.lineup.shortfall = 1
			},
			(payload) => {
				payload.catalogs.plugins.lineup.changes[0].change = "add"
			},
			(payload) => {
				payload.catalogs.plugins.lineup.removals = []
			},
			(payload) => {
				payload.catalogs.plugins.lineup.baseline.push(
					payload.catalogs.plugins.lineup.baseline[0]
				)
			},
			(payload) => {
				payload.catalogs.skills.recommendations.push({
					...payload.catalogs.skills.recommendations[7],
					id: "ninth"
				})
			},
			(payload) => {
				Object.assign(payload.catalogs.skills.lineup, { userId: "private" })
			},
			(payload) => {
				payload.catalogs.plugins.recommendations[1]
					.search!.queries[0].searches7d = 2
			},
			(payload) => {
				payload.catalogs.skills.recommendations[2].support = "current-only"
				payload.catalogs.skills.recommendations[2].adoption = null
			},
			(payload) => {
				payload.catalogs.plugins.lineup.removals[0].url = "https://evil.example"
			}
		]
		for (const edit of edits) {
			const payload = lineupPayload()
			edit(payload)
			expect(
				(await handleSearchIntelligenceApiRequest(request(payload), client))
					?.status
			).toBe(400)
		}
		expect(posts).toHaveLength(0)
		expect(
			owner.database.query("SELECT count(*) AS count FROM keyValue").get()
		).toEqual({ count: 0 })
	})
	it("keeps a full-set candidate with rare search counts while suppressing its query text", async () => {
		const { client, posts } = setup()
		const payload = lineupPayload()
		const row = payload.catalogs.plugins.recommendations[2]
		row.support = "search-only"
		row.adoption = null
		row.search = {
			...row.search!,
			matchedSearches7d: 1,
			previous7d: 0,
			searches30d: 1,
			queries: [],
			omittedQueries: 1
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(JSON.stringify(posts[0].body)).toContain("1 searches")
	})
	it("requires candidate link identity as well as text when reconciling a lost full-lineup response", async () => {
		const { client, posts } = setup()
		const payload = lineupPayload()
		const original = client.rest.post.bind(client.rest)
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			await original(...args)
			throw new Error("response lost")
		}) as typeof client.rest.post
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		const altered = JSON.parse(
			JSON.stringify(posts[0].body.components).replace(
				payload.catalogs.plugins.recommendations[0].url,
				"https://clawhub.ai/plugins/other"
			)
		)
		const history = (components: unknown) => [
			{
				id: "message-1",
				author: { id: "bot-user", bot: true },
				timestamp: new Date().toISOString(),
				components
			}
		]
		client.rest.get = async () => history(altered)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		const wrongReport = JSON.parse(
			JSON.stringify(posts[0].body.components).replace(
				/Report [a-f0-9]{64}/,
				`Report ${"0".repeat(64)}`
			)
		)
		client.rest.get = async () => history(wrongReport)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(503)
		client.rest.get = async () => history(posts[0].body.components)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
	})

	it("renders separate catalog evidence, including adoption-supported skills with no searches", async () => {
		const { client, posts } = setup()
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request(evidencePayload()),
					client
				)
			)?.status
		).toBe(200)
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text).toContain("Plugins")
		expect(text).toContain("Skills")
		expect(text).toContain("Memory Kit")
		expect(text).toContain("Homeassistant Skill")
		expect(text).toContain("341 downloads")
		expect(text).toContain("adoption-only")
		expect(text).toContain("2026-09-06")
		expect(text).toContain("quality review")
		expect(posts[0].body.allowed_mentions).toEqual({ parse: [] })
	})
	it("keeps independently hydrated adoption evidence when search metadata is unavailable", async () => {
		const { client, posts } = setup()
		const payload = evidencePayload()
		payload.catalogs.skills.currentMetadataStatus = "unavailable"
		payload.catalogs.skills.recommendations[0].adoption = {
			...payload.catalogs.skills.recommendations[0].adoption,
			source: "skills-sh-trending",
			periodStart: null,
			periodEnd: null,
			sourceObservedAt: payload.weekEnd - 86_400_000,
			downloads: null,
			installs: null,
			lifetimeInstalls: 1200
		} as never
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const rendered = JSON.stringify(posts[0].body)
		expect(rendered).toContain("1200 lifetime installs")
		expect(rendered).toContain("source observed 2026-09-06T00:00Z")
		expect(rendered).toContain("search metadata unavailable")
	})
	it("reports an explicit empty outcome for every catalog section", async () => {
		const { client, posts } = setup()
		const payload = evidencePayload()
		for (const catalog of Object.values(payload.catalogs)) {
			catalog.recommendations = []
			catalog.companyOpportunities = []
			catalog.officialGaps = []
			catalog.movers = []
		}
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const rendered = JSON.stringify(posts[0].body)
		for (const section of [
			"recommendations",
			"company opportunities",
			"official gaps",
			"movers"
		])
			expect(rendered.split(`No qualifying ${section}.`)).toHaveLength(3)
	})
	it("preserves a frozen legacy week and rejects replacing its receipt with a v2 report", async () => {
		const { client, posts } = setup()
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(
			(
				await handleSearchIntelligenceApiRequest(
					request(evidencePayload()),
					client
				)
			)?.status
		).toBe(409)
		expect(
			(await handleSearchIntelligenceApiRequest(request(), client))?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
	})
	it("rejects private fields, low-volume query text and inconsistent catalog evidence before receipt access", async () => {
		const { client, posts, owner } = setup()
		const change = (
			mutate: (payload: ReturnType<typeof evidencePayload>) => void
		) => {
			const payload = evidencePayload()
			mutate(payload)
			return payload
		}
		const invalid = [
			{ ...evidencePayload(), userId: "private" },
			change((payload) => {
				Object.assign(payload.catalogs.skills, { identity: "private" })
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].artifactKind = "skill"
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].url =
					"https://evil.example/plugin"
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].search.queries[0].searches7d = 2
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].search.queries.push(
					payload.catalogs.plugins.recommendations[0].search.queries[0]
				)
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].search.periodEnd++
			}),
			change((payload) => {
				payload.catalogs.plugins.recommendations[0].search.matchedSearches7d = 13
			}),
			change((payload) => {
				Object.assign(payload.catalogs.skills.recommendations[0].adoption, {
					source: ["clawhub-trending"]
				})
			}),
			change((payload) => {
				payload.catalogs.skills.recommendations[0].adoption.periodStart =
					payload.weekEnd
			}),
			change((payload) => {
				payload.catalogs.skills.recommendations[0].adoption.installs = -1
			}),
			change((payload) => {
				payload.catalogs.skills.recommendations[0].support = "search-only"
			}),
			change((payload) => {
				payload.catalogs.skills.adoption.status = "unavailable"
			}),
			change((payload) => {
				payload.catalogs.plugins.companyOpportunities[0].scope = "shelf"
			}),
			change((payload) => {
				payload.catalogs.skills.recommendations = Array(6).fill(
					payload.catalogs.skills.recommendations[0]
				)
			})
		]
		for (const payload of invalid)
			expect(
				(await handleSearchIntelligenceApiRequest(request(payload), client))
					?.status
			).toBe(400)
		expect(posts).toHaveLength(0)
		expect(
			owner.database.query("SELECT count(*) AS count FROM keyValue").get()
		).toEqual({ count: 0 })
	})
	it("reconciles v2 response loss and preserves the receipt on replay", async () => {
		const { client, posts } = setup()
		const original = client.rest.post.bind(client.rest)
		client.rest.post = (async (...args: Parameters<typeof original>) => {
			await original(...args)
			throw new Error("Response lost")
		}) as typeof client.rest.post
		const payload = evidencePayload()
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
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
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		expect(posts).toHaveLength(1)
	})
	it("bounds v2 text with both catalogs and explicit omissions while leaving source facts intact", async () => {
		const { client, posts } = setup()
		const payload = evidencePayload()
		for (const catalog of [payload.catalogs.plugins, payload.catalogs.skills]) {
			const candidate = catalog.recommendations[0]
			catalog.recommendations = Array.from({ length: 5 }, (_, index) => ({
				...candidate,
				id: candidate.id + index,
				displayName: "@everyone [link](https://evil.example) ".repeat(3).trim(),
				url: candidate.url + "?proof=" + "x".repeat(800)
			})) as typeof catalog.recommendations
		}
		payload.truncated = true
		expect(
			(await handleSearchIntelligenceApiRequest(request(payload), client))
				?.status
		).toBe(200)
		const text = (posts[0].body.components as unknown[])
			.flatMap(texts)
			.join("\n")
		expect(text.length).toBeLessThanOrEqual(4000)
		expect(text).toContain("Plugins Featured recommendations")
		expect(text).toContain("Skills Featured recommendations")
		expect(text).toContain("More evidence on the dashboard")
		expect(text).toContain("Input capped")
		expect(text).not.toContain("@everyone")
		expect(text).not.toContain("[link](https://evil.example)")
		expect(payload.catalogs.plugins.recommendations).toHaveLength(5)
	})
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
