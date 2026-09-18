export type Artifact =
	| "tool-envelope"
	| "execution-marker"
	| "ai-discourse"
	| "ai-formatting"
	| "untyped-long-message"
	| "human-conversational"
	| "low-lexical-diversity"

export type SignalFamily =
	| "timing"
	| "repetition"
	| "operational-artifact"
	| "semantic"
	| "stylometry"

export interface ObservationRecord {
	guildId: string
	messageId: string
	authorId: string
	channelId: string
	createdAt: string | number
	replyToId: string | null
	contentLength: number
	lineCount: number
	fingerprint: string
	artifacts: Artifact[]
	similarity?: string | null
	semanticScore?: number | null
}

export interface ReviewMessage extends ObservationRecord {
	replyLatencyMs: number | null
}

export interface Signal {
	code:
		| "reply-cadence"
		| "cross-channel-bursts"
		| "repeated-content"
		| "operational-markers"
		| "semantic-similarity"
		| "ai-stylometry"
		| "rapid-response-speed"
		| "unbroken-circadian"
	metrics: Record<string, number>
	family: SignalFamily
	points: number
	description: string
	messageIds: string[]
	alternative: string
}

export type ConcordanceLevel = "None" | "Low" | "Moderate" | "High"

export interface AnalysisReport {
	detectorVersion: "hermit-v1.0"
	subject: { guildId: string; authorId: string }
	window: { startAt: number; endAt: number }
	sample: { messages: number; channels: number; spanMs: number; truncated: boolean }
	priority:
		| "insufficient-evidence"
		| "no-strong-indicators"
		| "some-indicators"
		| "review-recommended"
	heuristicScore: number | null
	concordance: ConcordanceLevel
	familyScores: Partial<Record<SignalFamily, number>>
	signals: Signal[]
	limitations: string[]
}

export interface KrillEvaluation {
	automationProbability: number
	confidence: "high" | "moderate" | "low"
	brief: string
	disposition: "confirmed_bot" | "likely_bot" | "uncertain" | "likely_human"
	recommendedAction: "apply_bot_role" | "watchlist" | "dismiss"
	model: string
	evaluatedAt: string
}
