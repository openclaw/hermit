import type {
	AnalysisReport,
	ConcordanceLevel,
	ReviewMessage,
	Signal,
	SignalFamily
} from "./types.js"
import { repetitionSignal } from "./repetition.js"
import { timingSignals } from "./timing.js"

export const MAX_ANALYSIS_MESSAGES = 10000

const parseTimestamp = (value: string | number): number =>
	typeof value === "string" ? new Date(value).getTime() : value

export interface ReviewAnalyzerInput {
	guildId: string
	authorId: string
	startAt: number
	endAt: number
	messages: ReviewMessage[]
	truncated?: boolean
	scoreGate?: { minMessages: number; minSpanMs: number }
}

export function analyze(input: ReviewAnalyzerInput): AnalysisReport {
	if (
		!Number.isFinite(input.startAt) ||
		!Number.isFinite(input.endAt) ||
		input.startAt >= input.endAt
	) {
		throw new Error("Invalid observation window")
	}
	if (input.messages.length > MAX_ANALYSIS_MESSAGES) {
		throw new Error("Review exceeds analysis limit")
	}

	const unique = new Map<string, ReviewMessage>()
	for (const row of input.messages) {
		const ts = parseTimestamp(row.createdAt)
		if (
			row.guildId !== input.guildId ||
			row.authorId !== input.authorId ||
			!Number.isFinite(ts) ||
			ts < input.startAt ||
			ts > input.endAt
		) {
			continue
		}
		if (!unique.has(row.messageId)) {
			unique.set(row.messageId, row)
		}
	}

	const rows = [...unique.values()].sort((a, b) => {
		const diff = parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt)
		return diff || a.messageId.localeCompare(b.messageId)
	})

	const spanMs =
		rows.length > 1
			? parseTimestamp(rows[rows.length - 1]!.createdAt) -
				parseTimestamp(rows[0]!.createdAt)
			: 0

	const signals: Signal[] = timingSignals(rows)
	const repetition = repetitionSignal(rows)
	if (repetition) {
		signals.push(repetition)
	}

	// Operational Markers
	const operationalRows = rows.filter(
		(r) =>
			r.artifacts.includes("tool-envelope") ||
			r.artifacts.includes("execution-marker")
	)
	if (
		operationalRows.length >= 3 &&
		(new Set(operationalRows.map((r) => r.channelId)).size >= 2 ||
			operationalRows.length >= 5)
	) {
		signals.push({
			code: "operational-markers",
			family: "operational-artifact",
			points: 35,
			description: `${operationalRows.length} messages contain structured tool/execution markers outside excluded text.`,
			messageIds: operationalRows.slice(0, 6).map((r) => r.messageId),
			metrics: {
				messages: operationalRows.length,
				channels: new Set(operationalRows.map((r) => r.channelId)).size,
				markerTypes: new Set(
					operationalRows.flatMap((r) =>
						r.artifacts.filter(
							(a) => a === "tool-envelope" || a === "execution-marker"
						)
					)
				).size
			},
			alternative:
				"Unmarked logs, demonstrations, debugging, and jokes can contain these markers."
		})
	}

	// Stylometry
	const stylometryRows = rows.filter(
		(r) =>
			r.artifacts.includes("ai-discourse") ||
			r.artifacts.includes("ai-formatting") ||
			r.artifacts.includes("untyped-long-message") ||
			r.artifacts.includes("low-lexical-diversity")
	)
	const humanRows = rows.filter((r) =>
		r.artifacts.includes("human-conversational")
	)
	const substantiveRows = rows.filter((r) => (r.contentLength ?? 0) >= 60)
	const eligibleRows = rows.filter(
		(r) => r.contentLength !== null && (r.contentLength ?? 0) > 0
	)

	let lengthCV: number | null = null
	if (substantiveRows.length >= 8) {
		const lengths = substantiveRows.map((r) => r.contentLength!)
		const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
		const variance =
			lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length
		lengthCV = Math.sqrt(variance) / (mean || 1)
	}

	const denominator =
		substantiveRows.length >= 8
			? substantiveRows.length
			: eligibleRows.length || rows.length || 1
	const aiPrevalence = stylometryRows.length / denominator
	const humanRatio = humanRows.length / (rows.length || 1)
	const isHumanHelperDampened =
		stylometryRows.length < 5 &&
		(humanRatio >= 0.2 || humanRows.length >= 3) &&
		aiPrevalence < 0.25

	if (stylometryRows.length >= 2 && !isHumanHelperDampened) {
		const discourseCount = stylometryRows.filter((r) =>
			r.artifacts.includes("ai-discourse")
		).length
		const formattingCount = stylometryRows.filter((r) =>
			r.artifacts.includes("ai-formatting")
		).length
		const untypedCount = stylometryRows.filter((r) =>
			r.artifacts.includes("untyped-long-message")
		).length
		const lexicalCount = stylometryRows.filter((r) =>
			r.artifacts.includes("low-lexical-diversity")
		).length
		const details: string[] = []
		if (discourseCount) {
			details.push(
				`${discourseCount} AI discourse marker${discourseCount > 1 ? "s" : ""}`
			)
		}
		if (formattingCount) {
			details.push(
				`${formattingCount} structured list/header pattern${formattingCount > 1 ? "s" : ""}`
			)
		}
		if (untypedCount) {
			details.push(
				`${untypedCount} untyped long message${untypedCount > 1 ? "s" : ""}`
			)
		}
		if (lexicalCount) {
			details.push(
				`${lexicalCount} low lexical diversity message${lexicalCount > 1 ? "s" : ""}`
			)
		}
		if (lengthCV !== null && lengthCV < 0.28) {
			details.push(`unnatural length uniformity (CV ${lengthCV.toFixed(2)})`)
		}
		const points =
			aiPrevalence >= 0.35 || stylometryRows.length >= 5
				? 35
				: Math.max(15, Math.min(30, Math.round(15 + aiPrevalence * 35)))

		signals.push({
			code: "ai-stylometry",
			family: "stylometry",
			points,
			description: `${stylometryRows.length} messages exhibit characteristic AI assistant stylometry (${details.join(", ")}). Prevalence: ${Math.round(aiPrevalence * 100)}% of substantive messages.`,
			messageIds: stylometryRows.slice(0, 6).map((r) => r.messageId),
			metrics: {
				messages: stylometryRows.length,
				discourseMarkers: discourseCount,
				structuredFormatting: formattingCount,
				untypedMessages: untypedCount,
				lowLexicalDiversityMessages: lexicalCount,
				aiPrevalencePct: Math.round(aiPrevalence * 100),
				humanCounterIndicators: humanRows.length,
				...(lengthCV !== null
					? { lengthCV: Math.round(lengthCV * 100) / 100 }
					: {})
			},
			alternative:
				humanRows.length > 0
					? `Customer support templates, documentation, or prepared messages can share these markers. Sample also contains ${humanRows.length} message(s) with informal human conversational markers.`
					: "Polished customer support templates, copy-pasting, or professional writing styles can share these markers."
		})
	}

	// Family scoring
	const familyScores: Partial<Record<SignalFamily, number>> = {}
	for (const s of signals) {
		if (s.points > 0) {
			familyScores[s.family] = Math.max(familyScores[s.family] ?? 0, s.points)
		}
	}

	const minMessages = input.scoreGate?.minMessages ?? 20
	const minSpanMs = input.scoreGate?.minSpanMs ?? 30 * 60000
	const enough =
		rows.length >= minMessages && spanMs >= minSpanMs && !input.truncated
	const score = enough
		? Math.min(
				100,
				Object.values(familyScores).reduce((a, b) => a + b, 0)
			)
		: null

	const familyCount = Object.keys(familyScores).length
	let concordance: ConcordanceLevel = "None"
	if (familyCount >= 3) {
		concordance = "High"
	} else if (familyCount === 2) {
		concordance = "Moderate"
	} else if (familyCount === 1) {
		concordance = "Low"
	}

	const priority: AnalysisReport["priority"] = !enough
		? "insufficient-evidence"
		: familyCount >= 2 && score! >= 50
			? "review-recommended"
			: signals.some((signal) => signal.points > 0)
				? "some-indicators"
				: "no-strong-indicators"

	return {
		detectorVersion: "hermit-v1.0",
		subject: { guildId: input.guildId, authorId: input.authorId },
		window: { startAt: input.startAt, endAt: input.endAt },
		sample: {
			messages: rows.length,
			channels: new Set(rows.map((r) => r.channelId)).size,
			spanMs,
			truncated: Boolean(input.truncated)
		},
		priority,
		heuristicScore: score,
		concordance,
		familyScores,
		signals,
		limitations: [
			"Deterministic heuristics provide early detection; Krill provides model-estimated probability.",
			"Structural fingerprints and metadata only; no raw message text is retained.",
			...(rows.length === 0
				? ["No observed messages in the sampled window."]
				: []),
			...(isHumanHelperDampened
				? [
						"Stylometry escalation dampened: informal human conversational markers predominate over isolated formal messages."
					]
				: []),
			...(!enough && !input.truncated
				? [
						`Aggregate score requires at least ${minMessages} messages spanning ${Math.ceil(minSpanMs / 60000)} minutes.`
					]
				: [])
		]
	}
}
