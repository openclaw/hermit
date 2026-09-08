import {
	Container,
	TextDisplay,
	serializePayload,
	type Client
} from "@buape/carbon"
import { getRuntimeEnv } from "../runtime/env.js"
import {
	publisherAbuseDigestApiToken,
	publisherAbuseDigestTrustedOrigins
} from "../clawhubPublisherAbuse/api.js"
import { deliverWeeklyDigest } from "./delivery.js"

const apiPath = "/api/clawhub-search-intelligence/weekly"
type Row = {
	query: string
	searches: number
	previousSearches: number
	officialGaps: number
	searchUrl: string
}
type Digest = {
	kind: "plugin_search_weekly"
	weekStart: number
	weekEnd: number
	minimumSearches: 3
	dashboardUrl: string
	totalSearches: number
	sourceCounts: { clawhubWeb: number; openclawControlUi: number }
	classificationStatus: "available" | "partial" | "unavailable"
	currentMetadataStatus: "available" | "unavailable"
	truncated: boolean
	coverage: {
		dataThrough: number | null
		collectionStartedAt: number | null
		gapStart: number | null
		gapEnd: number | null
	}
	companyOpportunities: (Row & {
		companyProductName?: string
		confidence: number
	})[]
	officialGaps: Row[]
	featuredCandidates: (Row & {
		package: { name: string; displayName: string; url: string }
	})[]
	movers: Row[]
}
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value)
const fields = (
	value: unknown,
	required: string[],
	optional: string[] = []
): value is Record<string, unknown> =>
	record(value) &&
	required.every((key) => Object.hasOwn(value, key)) &&
	Object.keys(value).every(
		(key) => required.includes(key) || optional.includes(key)
	)
const count = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const timestamp = (value: unknown): value is number =>
	count(value) && value <= 8_640_000_000_000_000
const string = (value: unknown, max: number): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.trim() === value &&
	value.length <= max &&
	!/[\u0000-\u001f\u007f]/.test(value)
const validUrl = (value: unknown, origins: string[]) => {
	if (!string(value, 2048)) return false
	try {
		const url = new URL(value)
		return (
			["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			origins.includes(url.origin) &&
			url.toString().length <= 2048
		)
	} catch {
		return false
	}
}
const parseDigest = (value: unknown, origins: string[]): Digest | null => {
	if (
		!fields(value, [
			"kind",
			"weekStart",
			"weekEnd",
			"minimumSearches",
			"dashboardUrl",
			"totalSearches",
			"sourceCounts",
			"classificationStatus",
			"currentMetadataStatus",
			"truncated",
			"coverage",
			"companyOpportunities",
			"officialGaps",
			"featuredCandidates",
			"movers"
		])
	)
		return null
	if (
		value.kind !== "plugin_search_weekly" ||
		value.minimumSearches !== 3 ||
		!timestamp(value.weekStart) ||
		!timestamp(value.weekEnd) ||
		value.weekEnd - value.weekStart !== 604_800_000 ||
		value.weekEnd % 86_400_000 !== 0 ||
		new Date(value.weekEnd).getUTCDay() !== 1 ||
		!validUrl(value.dashboardUrl, origins) ||
		!count(value.totalSearches) ||
		typeof value.truncated !== "boolean"
	)
		return null
	if (
		typeof value.classificationStatus !== "string" ||
		!["available", "partial", "unavailable"].includes(
			value.classificationStatus
		) ||
		typeof value.currentMetadataStatus !== "string" ||
		!["available", "unavailable"].includes(value.currentMetadataStatus)
	)
		return null
	const sources = value.sourceCounts
	if (
		!fields(sources, ["clawhubWeb", "openclawControlUi"]) ||
		!count(sources["clawhubWeb"]) ||
		!count(sources["openclawControlUi"]) ||
		sources["clawhubWeb"] + sources["openclawControlUi"] !== value.totalSearches
	)
		return null
	const coverage = value.coverage
	if (
		!fields(coverage, [
			"dataThrough",
			"collectionStartedAt",
			"gapStart",
			"gapEnd"
		]) ||
		!Object.values(coverage).every(
			(time) => time === null || timestamp(time)
		) ||
		(coverage.gapStart === null) !== (coverage.gapEnd === null) ||
		(typeof coverage.gapStart === "number" &&
			typeof coverage.gapEnd === "number" &&
			coverage.gapStart >= coverage.gapEnd)
	)
		return null
	const rowFields = [
		"query",
		"searches",
		"previousSearches",
		"officialGaps",
		"searchUrl"
	]
	const validRows = (
		rows: unknown,
		kind: "company" | "gap" | "featured" | "mover"
	) =>
		Array.isArray(rows) &&
		rows.length <= 5 &&
		rows.every((row) => {
			if (
				!fields(
					row,
					[
						...rowFields,
						...(kind === "company"
							? ["confidence"]
							: kind === "featured"
								? ["package"]
								: [])
					],
					kind === "company" ? ["companyProductName"] : []
				) ||
				!string(row.query, 256) ||
				!count(row.searches) ||
				row.searches > (value.totalSearches as number) ||
				!count(row.previousSearches) ||
				!count(row.officialGaps) ||
				row.officialGaps > row.searches ||
				!validUrl(row.searchUrl, origins)
			)
				return false
			if (
				(kind === "mover"
					? Math.max(row.searches, row.previousSearches)
					: row.searches) < 3
			)
				return false
			if ((kind === "company" || kind === "gap") && row.officialGaps < 3)
				return false
			if (
				kind === "company" &&
				(typeof row.confidence !== "number" ||
					!Number.isFinite(row.confidence) ||
					row.confidence < 0.8 ||
					row.confidence > 1 ||
					(row.companyProductName !== undefined &&
						!string(row.companyProductName, 120)))
			)
				return false
			if (
				kind === "featured" &&
				(!fields(row.package, ["name", "displayName", "url"]) ||
					!string(row.package.name, 160) ||
					!string(row.package.displayName, 120) ||
					!validUrl(row.package.url, origins))
			)
				return false
			return true
		})
	if (
		!validRows(value.companyOpportunities, "company") ||
		!validRows(value.officialGaps, "gap") ||
		!validRows(value.featuredCandidates, "featured") ||
		!validRows(value.movers, "mover")
	)
		return null
	if (
		(value.classificationStatus === "unavailable" &&
			(value.companyOpportunities as unknown[]).length) ||
		(value.currentMetadataStatus === "unavailable" &&
			(value.featuredCandidates as unknown[]).length)
	)
		return null
	return value as unknown as Digest
}
// Bound bytes while consuming the stream, not after allocating an arbitrary body.
const readBody = async (request: Request): Promise<unknown> => {
	const reader = request.body?.getReader()
	if (!reader) return null
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > 65_536) {
				await reader.cancel()
				throw new RangeError("Body too large")
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return JSON.parse(new TextDecoder().decode(bytes))
}
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" }
	})
const safe = (value: string) =>
	value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/([\\`*_~|>\[\]()#])/g, "\\$1")
		.replace(/@/g, "@\u200b")
const link = (value: string) =>
	`<${new URL(value).toString().replace(/</g, "%3C").replace(/>/g, "%3E")}>`
const date = (value: number) => new Date(value).toISOString().slice(0, 10)
const render = (digest: Digest) => {
	const preview = ["localhost", "127.0.0.1", "[::1]"].includes(
		new URL(digest.dashboardUrl).hostname
	)
	const coverage = digest.coverage
	const incomplete =
		coverage.dataThrough === null ||
		coverage.dataThrough < digest.weekEnd ||
		coverage.collectionStartedAt === null ||
		coverage.collectionStartedAt > digest.weekStart ||
		coverage.gapStart !== null
	const header = [
		`### ${preview ? "LOCAL PREVIEW · " : ""}ClawHub weekly search intelligence`,
		`${date(digest.weekStart)} – ${date(digest.weekEnd)} (UTC, end exclusive)`,
		`${digest.totalSearches} searches · Web ${digest.sourceCounts["clawhubWeb"]} · Control UI ${digest.sourceCounts["openclawControlUi"]}`,
		`Data through: ${coverage.dataThrough === null ? "unknown" : date(coverage.dataThrough)} · Collection started: ${coverage.collectionStartedAt === null ? "unknown" : date(coverage.collectionStartedAt)}`,
		...(incomplete
			? ["**Incomplete collection history; not a complete-week demand total.**"]
			: []),
		...(coverage.gapStart !== null && coverage.gapEnd !== null
			? [
					`Collection gap: ${date(coverage.gapStart)} – ${date(coverage.gapEnd)} UTC`
				]
			: []),
		`[Open search intelligence](${link(digest.dashboardUrl)})`
	].join("\n")
	const footer = [
		"At least 3 searches required: either week for movers, current week for other rows. Official gaps are deterministic; company classification is advisory.",
		...(digest.classificationStatus !== "available"
			? [
					digest.classificationStatus === "unavailable"
						? "Classification unavailable."
						: "Classification partially available."
				]
			: []),
		...(digest.currentMetadataStatus === "unavailable"
			? ["Current package metadata unavailable."]
			: []),
		...(digest.truncated ? ["Input capped; rankings may be incomplete."] : [])
	].join("\n")
	const brief = (value: string) =>
		safe(value.length > 80 ? `${value.slice(0, 79)}…` : value)
	const rowText = (row: Row) =>
		`[${brief(row.query)}](${link(row.searchUrl)}) · ${row.searches} searches · ${row.officialGaps} gaps · previous ${row.previousSearches}`
	// Reserve equal space for each section; never cut links/Markdown mid-row.
	const budget = Math.floor((3900 - header.length - footer.length) / 4)
	const section = (title: string, rows: string[], empty: string) => {
		let text = `**${title}**`
		if (!rows.length) return `${text}\n${empty}`
		for (const row of rows) {
			if (text.length + row.length + 34 > budget)
				return `${text}\nMore rows on the dashboard.`
			text += `\n${row}`
		}
		return text
	}
	return serializePayload({
		components: [
			new Container([
				new TextDisplay(header),
				new TextDisplay(
					section(
						"Company plugin opportunities",
						digest.companyOpportunities.map(
							(row) =>
								`${rowText(row)}${row.companyProductName ? ` · ${brief(row.companyProductName)}` : ""}`
						),
						digest.classificationStatus === "unavailable"
							? "Classification unavailable."
							: "No threshold-qualified opportunities."
					)
				),
				new TextDisplay(
					section(
						"Official gaps",
						digest.officialGaps.map(rowText),
						"No threshold-qualified gaps."
					)
				),
				new TextDisplay(
					section(
						"Featured candidates",
						digest.featuredCandidates.map(
							(row) =>
								`${rowText(row)} · [${brief(row.package.displayName)}](${link(row.package.url)})`
						),
						digest.currentMetadataStatus === "unavailable"
							? "Current package metadata unavailable."
							: "No eligible candidates."
					)
				),
				new TextDisplay(
					section(
						"Week-over-week movers",
						digest.movers.map(rowText),
						"No threshold-qualified movers."
					)
				),
				new TextDisplay(footer)
			])
		],
		allowedMentions: { parse: [] }
	})
}
export const handleSearchIntelligenceApiRequest = async (
	request: Request,
	client: Client
): Promise<Response | null> => {
	if (new URL(request.url).pathname !== apiPath) return null
	const token = publisherAbuseDigestApiToken(getRuntimeEnv())
	if (
		!token ||
		request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] !==
			token
	)
		return json({ error: "Unauthorized" }, 401)
	if (request.method !== "POST")
		return json({ error: "Method not allowed" }, 405)
	let body: unknown
	try {
		body = await readBody(request)
	} catch (error) {
		return json(
			{
				error: error instanceof RangeError ? "Body too large" : "Invalid JSON"
			},
			error instanceof RangeError ? 413 : 400
		)
	}
	const digest = parseDigest(
		body,
		publisherAbuseDigestTrustedOrigins(getRuntimeEnv())
	)
	if (!digest)
		return json({ error: "Invalid search intelligence payload" }, 400)
	try {
		return await deliverWeeklyDigest(client, digest, render(digest))
	} catch {
		return json({ error: "Delivery state unavailable" }, 503)
	}
}
