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

import { parseDigest, type Digest, type Row } from "./contract.js"
import { parseEvidenceDigest, renderEvidenceDigest } from "./evidence.js"
import { renderMonthlyDigest, renderMonthlySearchDigest } from "./monthly.js"

const apiPath = "/api/clawhub-search-intelligence/weekly"
// Frozen week identity, not request time or mutable config, selects presentation.
const featuredCutoverWeekEnd = Date.UTC(2026, 10, 2)
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
	const origins = publisherAbuseDigestTrustedOrigins(getRuntimeEnv())
	const digest =
		parseEvidenceDigest(body, origins) ?? parseDigest(body, origins)
	if (!digest)
		return json({ error: "Invalid search intelligence payload" }, 400)
	try {
		if (digest.kind === "search_intelligence_weekly_v4" && digest.weekEnd >= featuredCutoverWeekEnd)
			return await deliverWeeklyDigest(client, digest, renderMonthlySearchDigest(digest), renderMonthlyDigest(digest))
		return await deliverWeeklyDigest(
			client,
			digest,
			digest.kind === "plugin_search_weekly"
				? render(digest)
				: renderEvidenceDigest(digest)
		)
	} catch {
		return json({ error: "Delivery state unavailable" }, 503)
	}
}
