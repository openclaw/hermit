import {
	Container,
	LinkButton,
	Row,
	TextDisplay,
	serializePayload
} from "@buape/carbon"
import { count, fields, record, string, timestamp } from "./contract.js"
import type {
	Catalog,
	FeaturedLineup,
	LineupDigest,
	LineupRecommendation
} from "./evidence.js"

type Adoption = {
	source: "package-daily-installs" | "skill-daily-installs"
	rank: number
	installs30d: number
	installs7d: number
	importedRows: number
	importDatasetVersions: string[]
}
type Recommendation = Omit<LineupRecommendation, "adoption"> & {
	slot: number
	selectionBasis: "editorial" | "telemetry"
	reason: string
	adoption: Adoption | null
}
type Reservation = {
	slot: number
	id: string | null
	name: string | null
	displayName: string | null
	reason: string | null
	status: "ready" | "pending"
	pendingReasons: string[]
}
type Lineup = Omit<FeaturedLineup, "targetSize"> & {
	targetSize: 16
	reservedSlots: number
	telemetryTarget: number
	pendingCount: number
	telemetryShortfall: number
	editorialRevision: number
	currentEditorialRevision: number
	staleEditorial: boolean
	reservations: Reservation[]
}
type MonthlyCatalog = Omit<Catalog, "recommendations" | "adoption"> & {
	recommendations: Recommendation[]
	lineup: Lineup
	adoption: Catalog["adoption"] & {
		collectionStartedAt: number
		periodStart7d: number
		scannedRows: number
		importedRows: number
		importDatasetVersions: string[]
	}
}
export type MonthlyDigest = Omit<LineupDigest, "kind" | "catalogs"> & {
	kind: "search_intelligence_weekly_v4"
	catalogs: { plugins: MonthlyCatalog; skills: MonthlyCatalog }
}
const versions = (value: unknown) =>
	Array.isArray(value) &&
	value.length <= 100 &&
	value.every((entry) => string(entry, 256)) &&
	new Set(value).size === value.length
export const validMonthlyAdoption = (
	value: unknown,
	kind: "plugin" | "skill"
) =>
	fields(value, [
		"source",
		"rank",
		"installs30d",
		"installs7d",
		"importedRows",
		"importDatasetVersions"
	]) &&
	value.source ===
		(kind === "plugin" ? "package-daily-installs" : "skill-daily-installs") &&
	count(value.rank) &&
	value.rank > 0 &&
	count(value.installs30d) &&
	count(value.installs7d) &&
	value.installs30d >= value.installs7d &&
	count(value.importedRows) &&
	versions(value.importDatasetVersions)

export const validMonthlySummary = (value: unknown, end: number) =>
	record(value) &&
	value.periodEnd === end &&
	value.periodStart === end - 30 * 86400000 &&
	value.periodStart7d === end - 7 * 86400000 &&
	timestamp(value.collectionStartedAt) &&
	(value.generatedAt === null ||
		(timestamp(value.generatedAt) &&
			value.generatedAt >= value.collectionStartedAt)) &&
	count(value.scannedRows) &&
	count(value.importedRows) &&
	value.importedRows <= value.scannedRows &&
	versions(value.importDatasetVersions)

export const validMonthlyLineup = (
	value: unknown,
	candidates: unknown[],
	kind: "plugin" | "skill"
) => {
	if (
		!record(value) ||
		value.reservedSlots !== (kind === "plugin" ? 8 : 0) ||
		value.telemetryTarget !== (kind === "plugin" ? 8 : 16) ||
		!count(value.pendingCount) ||
		!count(value.telemetryShortfall) ||
		!count(value.editorialRevision) ||
		!count(value.currentEditorialRevision) ||
		value.staleEditorial !==
			(value.editorialRevision !== value.currentEditorialRevision) ||
		!Array.isArray(value.reservations) ||
		value.reservations.length !== value.reservedSlots ||
		!value.reservations.every(
			(entry, slot) =>
				fields(entry, [
					"slot",
					"id",
					"name",
					"displayName",
					"reason",
					"status",
					"pendingReasons"
				]) &&
				entry.slot === slot &&
				(entry.id === null || string(entry.id, 256)) &&
				(entry.name === null || string(entry.name, 256)) &&
				(entry.displayName === null || string(entry.displayName, 120)) &&
				(entry.reason === null || string(entry.reason, 500)) &&
				(entry.status === "ready" || entry.status === "pending") &&
				Array.isArray(entry.pendingReasons) &&
				entry.pendingReasons.length <= 12 &&
				entry.pendingReasons.every((reason) => string(reason, 256))
		) ||
		!candidates.every(
			(entry) =>
				record(entry) &&
				count(entry.slot) &&
				entry.slot < 16 &&
				string(entry.reason, 500) &&
				(entry.selectionBasis === "editorial" ||
					entry.selectionBasis === "telemetry")
		)
	)
		return false
	const lineup = value as unknown as Lineup
	const rows = candidates as Recommendation[]
	const assigned = lineup.reservations.filter((entry) => entry.id !== null)
	const telemetry = rows.filter((entry) => entry.selectionBasis === "telemetry")
	return (
		new Set(assigned.map((entry) => entry.id)).size === assigned.length &&
		lineup.pendingCount ===
			lineup.reservations.filter((entry) => entry.status === "pending")
				.length &&
		lineup.telemetryShortfall === lineup.telemetryTarget - telemetry.length &&
		rows.every(
			(entry, index) =>
				(index === 0 || rows[index - 1].slot < entry.slot) &&
				(entry.selectionBasis === "editorial"
					? entry.slot < lineup.reservedSlots
					: entry.slot >= lineup.reservedSlots &&
						entry.adoption !== null &&
						entry.adoption.installs30d > 0)
		) &&
		lineup.reservations.every((entry) => {
			const candidate = rows.find((row) => row.slot === entry.slot)
			return entry.status === "ready"
				? entry.id !== null &&
						entry.name !== null &&
						entry.reason !== null &&
						entry.pendingReasons.length === 0 &&
						candidate?.selectionBasis === "editorial" &&
						candidate.id === entry.id &&
						candidate.reason === entry.reason
				: candidate === undefined && entry.pendingReasons.length > 0
		})
	)
}

class DashboardLink extends LinkButton {
	label = "Full report"
	constructor(public url: string) {
		super()
	}
}
const safe = (value: string) =>
	value.replace(/([\\`*_~|>\[\]()#])/g, "\\$1").replace(/@/g, "@\u200b")
const day = (value: number) => new Date(value).toISOString().slice(0, 10)
const link = (value: string) =>
	`<${new URL(value).href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`

export const renderMonthlyDigest = (digest: MonthlyDigest) => {
	const preview = ["localhost", "127.0.0.1", "[::1]"].includes(
		new URL(digest.dashboardUrl).hostname
	)
	const pages: string[] = []
	for (const [name, catalog] of [
		["Plugins", digest.catalogs.plugins],
		["Skills", digest.catalogs.skills]
	] as const) {
		const { lineup } = catalog
		const notes = [
			...(lineup.pendingCount
				? [
						`${lineup.pendingCount} plugin slot${lineup.pendingCount === 1 ? "" : "s"} pending.`
					]
				: []),
			...(lineup.telemetryShortfall
				? [`${lineup.telemetryShortfall} ${name.toLowerCase()} slots unfilled.`]
				: []),
			...(lineup.staleEditorial
				? ["Selection changed; refresh the report before approval."]
				: [])
		]
		const rows = catalog.recommendations.map(
			(candidate) =>
				`• [${safe(candidate.displayName)}](${link(candidate.url)}) · ${candidate.adoption ? `${candidate.adoption.installs30d.toLocaleString("en-US")} installs` : "installs unavailable"}`
		)
		if (!rows.length) rows.push("No qualifying recommendations.")
		if (notes.length) rows.push(notes.join(" "))
		// Keep links whole and retain every recommendation. Reserve room for the
		// shared header, approval footer and delivery owner's report fingerprint.
		let section = `**${name}**`
		for (const row of rows) {
			if (section.length + row.length + 1 > 3400) {
				pages.push(section)
				section = `**${name} (continued)**`
			}
			section += `\n${row}`
		}
		const last = pages.length - 1
		if (last >= 0 && pages[last].length + section.length + 2 <= 3400)
			pages[last] += `\n\n${section}`
		else pages.push(section)
	}
	const dashboardUrl =
		digest.dashboardUrl.length <= 512
			? digest.dashboardUrl
			: new URL(
					`/management?view=search-insights&endDay=${digest.weekEnd}`,
					digest.dashboardUrl
				).href
	return pages.map((page, index) =>
		serializePayload({
			components: [
				new Container([
					new TextDisplay(
						`### ${preview ? "LOCAL PREVIEW · " : ""}Featured recommendations · ${day(digest.weekEnd)}${pages.length > 1 ? ` · ${index + 1}/${pages.length}` : ""}\n30-day installs · ${day(digest.weekEnd - 30 * 86400000)} – ${day(digest.weekEnd - 86400000)} UTC`
					),
					new TextDisplay(page),
					new TextDisplay("Approval required to change Featured."),
					new Row([new DashboardLink(dashboardUrl)])
				])
			],
			allowedMentions: { parse: [] }
		})
	)
}

// Keep the legacy formatter above unchanged: frozen part hashes depend on it.
export const renderMonthlySearchDigest = (digest: MonthlyDigest) => {
	const dashboardUrl =
		digest.dashboardUrl.length <= 512
			? digest.dashboardUrl
			: new URL(
					`/management?view=search-insights&endDay=${digest.weekEnd}`,
					digest.dashboardUrl
				).href
	const brief = (value: string) =>
		safe(value.length > 80 ? `${value.slice(0, 79)}…` : value)
	const rowText = (row: Catalog["movers"][number]) =>
		`[${brief(row.query)}](${link(row.searchUrl.length <= 512 ? row.searchUrl : dashboardUrl)}) (${row.scope}) · ${row.searches} searches · ${row.officialGaps} gaps · previous ${row.previousSearches}`
	const preview = ["localhost", "127.0.0.1", "[::1]"].includes(
		new URL(digest.dashboardUrl).hostname
	)
	return ([
		["Plugins", digest.catalogs.plugins],
		["Skills", digest.catalogs.skills]
	] as const).flatMap(([name, catalog]) => {
		const { coverage } = catalog
		const time = (value: number | null) => value === null ? "unknown" : day(value)
		const incomplete = coverage.dataThrough === null ||
			coverage.dataThrough < digest.weekEnd ||
			coverage.collectionStartedAt === null ||
			coverage.collectionStartedAt > digest.weekStart || coverage.gapStart !== null
		const header = [
			`### ${preview ? "LOCAL PREVIEW · " : ""}ClawHub weekly search intelligence · ${name}`,
			`${day(digest.weekStart)} – ${day(digest.weekEnd)} (UTC, end exclusive)`,
			`${catalog.totalSearches} searches · Web ${catalog.sourceCounts.clawhubWeb} · Control UI ${catalog.sourceCounts.openclawControlUi}`,
			`Data through ${time(coverage.dataThrough)}; collection started ${time(coverage.collectionStartedAt)}.${incomplete ? " Incomplete collection history." : ""}`,
			...(coverage.gapStart !== null && coverage.gapEnd !== null
				? [`Collection gap ${day(coverage.gapStart)} – ${day(coverage.gapEnd)} UTC.`] : []),
			`Classification ${catalog.classificationStatus}; search metadata ${catalog.currentMetadataStatus}.`
		].join("\n")
		const sections = [
			["company opportunities", catalog.companyOpportunities.map(row =>
				`${rowText(row)}${row.companyProductName ? ` · ${brief(row.companyProductName)}` : ""} · ${Math.round(row.confidence * 100)}% classifier confidence`)],
			["official gaps", catalog.officialGaps.map(rowText)],
			["movers", catalog.movers.map(rowText)]
		] as const
		const pages: string[] = []
		let page = ""
		for (const [title, rows] of sections) {
			const heading = `**${name} ${title}**`
			for (const row of [heading, ...(rows.length ? rows : ["None qualified."])]) {
				// Whole bounded rows only; reserve space for metadata and receipt fingerprint.
				if (page.length + row.length + 1 > 2600) {
					pages.push(page)
					page = `${heading} (continued)`
				}
				page += `\n${row}`
			}
		}
		pages.push(page)
		return pages.map(page => serializePayload({
			components: [new Container([
				new TextDisplay(header),
				new TextDisplay(page),
				new TextDisplay("Company classification is advisory. At least 3 searches required: either week for movers, current week for other rows. Long links open the full report." +
					(digest.truncated ? " Input capped; more evidence on the dashboard." : "")),
				new Row([new DashboardLink(dashboardUrl)])
			])],
			allowedMentions: { parse: [] }
		}))
	})
}
