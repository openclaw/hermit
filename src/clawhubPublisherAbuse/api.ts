import {
	Container,
	Separator,
	TextDisplay,
	type Client,
	type MessagePayloadObject
} from "@buape/carbon"
import { getRuntimeEnv } from "../runtime/env.js"

type LegacySignal = {
	signalId: string
	signalType: string
	severity: string
	publisher: string
	skillSlug: string
	skillDisplayName: string | null
	seenCount: number
	firstSeenAt: number | null
	lastSeenAt: number | null
	recent7Downloads: number | null
	recent7Installs: number | null
	recent7InstallDownloadRatio: number | null
	recent30Downloads: number | null
	recent30Installs: number | null
	recent30InstallDownloadRatio: number | null
	allTimeDownloads: number | null
	allTimeInstalls: number | null
	allTimeInstallDownloadRatio: number | null
	skillUrl: string | null
	publisherUrl: string | null
}

type LegacyDigest = {
	kind: "publisher_abuse_signals_changed"
	changedCount: number
	hasMore: boolean
	dashboardUrl: string
	topSignals: LegacySignal[]
}

type ScanFailure = {
	kind: "publisher_abuse_signal_scan_failed"
	runId: string
	failureCount: number
	errorMessage: string
	failedAt: number
	dashboardUrl: string
}

type SignalContext = {
	signalId: string
	signalType: string
	scope: "skill" | "publisher"
	publisher: string
	skillSlug: string | null
	skillDisplayName: string | null
	dashboardUrl: string
}

type OwnerContactFailure = SignalContext & {
	kind: "publisher_abuse_signal_owner_contact_failed"
	failureReason: string
	attemptCount: number
	failedAt: number
}

type OwnerResponse = SignalContext & {
	kind: "publisher_abuse_signal_owner_response_submitted"
	responseKind: "expected" | "not_recognized" | "unsure"
	responsePreview: string | null
	submittedAt: number
}

type ActionableNotification = ScanFailure | OwnerContactFailure | OwnerResponse
type Notification = LegacyDigest | ActionableNotification

type DiscordMessage = {
	components: Container[]
	allowedMentions: NonNullable<MessagePayloadObject["allowedMentions"]>
}

type SendableChannel = {
	send: (message: DiscordMessage) => Promise<unknown>
}

type Dependencies = {
	token: string
	trustedOrigins?: string[]
	channelId: string
	roleId: string
	fetchChannel: (channelId: string) => Promise<unknown>
}

const apiPath = "/api/clawhub-publisher-abuse/signals/digest"
const defaultClawHubSiteUrl = "https://clawhub.ai"
const maxOwnerResponsePreviewLength = 500

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" }
	})

const bearerToken = (request: Request) =>
	request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? ""

const readRecord = (value: unknown) =>
	value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null

const requiredString = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null

const optionalString = (value: unknown) =>
	value === undefined || value === null || value === ""
		? null
		: requiredString(value)

const nonNegativeInteger = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null

const finiteNumber = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null

const nonNegativeNumber = (value: unknown) => {
	const number = finiteNumber(value)
	return number !== null && number >= 0 ? number : null
}

const optionalNonNegativeInteger = (value: unknown) =>
	value === undefined || value === null ? null : nonNegativeInteger(value)

const optionalNonNegativeNumber = (value: unknown) =>
	value === undefined || value === null ? null : nonNegativeNumber(value)

const urlOrigin = (value: string) => {
	try {
		const url = new URL(value)
		return ["http:", "https:"].includes(url.protocol) ? url.origin : null
	} catch {
		return null
	}
}

export const publisherAbuseDigestTrustedOrigins = (
	env: Pick<Env, "CLAWHUB_SITE_URL">
) => [urlOrigin(env.CLAWHUB_SITE_URL?.trim() || defaultClawHubSiteUrl) ?? defaultClawHubSiteUrl]

export const publisherAbuseSignalRouting = (
	env: Partial<Pick<Env, "CLAWHUB_SIGNALS_REVIEW_CHANNEL_ID" | "CLAWHUB_SIGNALS_REVIEW_ROLE_ID">>
) => ({
	channelId: env.CLAWHUB_SIGNALS_REVIEW_CHANNEL_ID?.trim() ?? "",
	roleId: env.CLAWHUB_SIGNALS_REVIEW_ROLE_ID?.trim() ?? ""
})

const trustedOriginSet = (origins: string[]) =>
	new Set(origins.map((origin) => urlOrigin(origin.trim()) ?? origin.trim()).filter(Boolean))

const validUrl = (value: unknown, trustedOrigins: ReadonlySet<string>) => {
	const url = requiredString(value)
	if (!url) return null
	try {
		const parsed = new URL(url)
		return ["http:", "https:"].includes(parsed.protocol) && trustedOrigins.has(parsed.origin)
			? parsed.toString()
			: null
	} catch {
		return null
	}
}

const optionalValidUrl = (value: unknown, trustedOrigins: ReadonlySet<string>) =>
	value === undefined || value === null || value === "" ? null : validUrl(value, trustedOrigins)

const invalidOptionalUrl = (rawValue: unknown, parsedValue: string | null) =>
	rawValue !== undefined && rawValue !== null && rawValue !== "" && parsedValue === null

const optionalIntegerFields = [
	"firstSeenAt",
	"lastSeenAt",
	"recent7Downloads",
	"recent7Installs",
	"recent30Downloads",
	"recent30Installs",
	"allTimeDownloads",
	"allTimeInstalls"
]

const optionalRatioFields = [
	"recent7InstallDownloadRatio",
	"recent30InstallDownloadRatio",
	"allTimeInstallDownloadRatio"
]

const hasInvalidOptionalInteger = (record: Record<string, unknown>) =>
	optionalIntegerFields.some((field) =>
		record[field] !== undefined &&
		record[field] !== null &&
		nonNegativeInteger(record[field]) === null
	)

const hasInvalidOptionalRatio = (record: Record<string, unknown>) =>
	optionalRatioFields.some((field) =>
		record[field] !== undefined &&
		record[field] !== null &&
		nonNegativeNumber(record[field]) === null
	)

const parseLegacySignal = (value: unknown, trustedOrigins: ReadonlySet<string>): LegacySignal | null => {
	const record = readRecord(value)
	if (!record) return null

	const signalId = requiredString(record.signalId)
	const signalType = requiredString(record.signalType)
	const severity = requiredString(record.severity)
	const publisher = requiredString(record.publisher)
	const skillSlug = requiredString(record.skillSlug)
	const seenCount = nonNegativeInteger(record.seenCount)
	const skillUrl = optionalValidUrl(record.skillUrl, trustedOrigins)
	const publisherUrl = optionalValidUrl(record.publisherUrl, trustedOrigins)

	if (
		!signalId ||
		!signalType ||
		!severity ||
		!publisher ||
		!skillSlug ||
		seenCount === null ||
		invalidOptionalUrl(record.skillUrl, skillUrl) ||
		invalidOptionalUrl(record.publisherUrl, publisherUrl) ||
		hasInvalidOptionalInteger(record) ||
		hasInvalidOptionalRatio(record)
	) {
		return null
	}

	return {
		signalId,
		signalType,
		severity,
		publisher,
		skillSlug,
		skillDisplayName: optionalString(record.skillDisplayName),
		seenCount,
		firstSeenAt: optionalNonNegativeInteger(record.firstSeenAt),
		lastSeenAt: optionalNonNegativeInteger(record.lastSeenAt),
		recent7Downloads: optionalNonNegativeInteger(record.recent7Downloads),
		recent7Installs: optionalNonNegativeInteger(record.recent7Installs),
		recent7InstallDownloadRatio: optionalNonNegativeNumber(record.recent7InstallDownloadRatio),
		recent30Downloads: optionalNonNegativeInteger(record.recent30Downloads),
		recent30Installs: optionalNonNegativeInteger(record.recent30Installs),
		recent30InstallDownloadRatio: optionalNonNegativeNumber(record.recent30InstallDownloadRatio),
		allTimeDownloads: optionalNonNegativeInteger(record.allTimeDownloads),
		allTimeInstalls: optionalNonNegativeInteger(record.allTimeInstalls),
		allTimeInstallDownloadRatio: optionalNonNegativeNumber(record.allTimeInstallDownloadRatio),
		skillUrl,
		publisherUrl
	}
}

const parseLegacyDigest = (value: unknown, trustedOrigins: ReadonlySet<string>): LegacyDigest | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signals_changed") return null

	const changedCount = nonNegativeInteger(record.changedCount)
	const dashboardUrl = validUrl(record.dashboardUrl, trustedOrigins)
	const topSignals = Array.isArray(record.topSignals)
		? record.topSignals.map((signal) => parseLegacySignal(signal, trustedOrigins))
		: []

	if (
		changedCount === null ||
		typeof record.hasMore !== "boolean" ||
		!dashboardUrl ||
		topSignals.length === 0 ||
		topSignals.some((signal) => signal === null)
	) {
		return null
	}

	return {
		kind: "publisher_abuse_signals_changed",
		changedCount,
		hasMore: record.hasMore,
		dashboardUrl,
		topSignals: topSignals.filter((signal): signal is LegacySignal => signal !== null)
	}
}

const parseSignalContext = (
	record: Record<string, unknown>,
	trustedOrigins: ReadonlySet<string>
): SignalContext | null => {
	const signalId = requiredString(record.signalId)
	const signalType = requiredString(record.signalType)
	const scope = record.scope === "skill" || record.scope === "publisher" ? record.scope : null
	const publisher = requiredString(record.publisher)
	const skillSlug = optionalString(record.skillSlug)
	const skillDisplayName = optionalString(record.skillDisplayName)
	const dashboardUrl = validUrl(record.dashboardUrl, trustedOrigins)
	if (
		!signalId ||
		!signalType ||
		!scope ||
		!publisher ||
		!dashboardUrl ||
		(record.skillSlug !== undefined && record.skillSlug !== null && skillSlug === null) ||
		(record.skillDisplayName !== undefined && record.skillDisplayName !== null && skillDisplayName === null) ||
		(scope === "skill" && (!skillSlug || !skillDisplayName))
	) {
		return null
	}
	return { signalId, signalType, scope, publisher, skillSlug, skillDisplayName, dashboardUrl }
}

const parseScanFailure = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): ScanFailure | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signal_scan_failed") return null

	const runId = requiredString(record.runId)
	const failureCount = nonNegativeInteger(record.failureCount)
	const errorMessage = requiredString(record.errorMessage)
	const failedAt = nonNegativeInteger(record.failedAt)
	const dashboardUrl = validUrl(record.dashboardUrl, trustedOrigins)
	if (!runId || failureCount === null || failureCount === 0 || !errorMessage || failedAt === null || !dashboardUrl) {
		return null
	}
	return { kind: "publisher_abuse_signal_scan_failed", runId, failureCount, errorMessage, failedAt, dashboardUrl }
}

const parseOwnerContactFailure = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): OwnerContactFailure | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signal_owner_contact_failed") return null
	const context = parseSignalContext(record, trustedOrigins)
	const failureReason = requiredString(record.failureReason)
	const attemptCount = nonNegativeInteger(record.attemptCount)
	const failedAt = nonNegativeInteger(record.failedAt)
	if (!context || !failureReason || attemptCount === null || attemptCount === 0 || failedAt === null) {
		return null
	}
	return {
		...context,
		kind: "publisher_abuse_signal_owner_contact_failed",
		failureReason,
		attemptCount,
		failedAt
	}
}

const parseOwnerResponse = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): OwnerResponse | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signal_owner_response_submitted") return null
	const context = parseSignalContext(record, trustedOrigins)
	const responseKind = ["expected", "not_recognized", "unsure"].includes(String(record.responseKind))
		? record.responseKind as OwnerResponse["responseKind"]
		: null
	const responsePreview = optionalString(record.responsePreview)
	const submittedAt = nonNegativeInteger(record.submittedAt)
	if (
		!context ||
		!responseKind ||
		submittedAt === null ||
		(record.responsePreview !== undefined && record.responsePreview !== null && responsePreview === null)
	) {
		return null
	}
	return {
		...context,
		kind: "publisher_abuse_signal_owner_response_submitted",
		responseKind,
		responsePreview,
		submittedAt
	}
}

const parseNotification = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): Notification | null => {
	const record = readRecord(value)
	if (!record) return null
	switch (record.kind) {
		case "publisher_abuse_signals_changed":
			return parseLegacyDigest(value, trustedOrigins)
		case "publisher_abuse_signal_scan_failed":
			return parseScanFailure(value, trustedOrigins)
		case "publisher_abuse_signal_owner_contact_failed":
			return parseOwnerContactFailure(value, trustedOrigins)
		case "publisher_abuse_signal_owner_response_submitted":
			return parseOwnerResponse(value, trustedOrigins)
		default:
			return null
	}
}

const isSendableChannel = (channel: unknown): channel is SendableChannel => {
	const record = readRecord(channel)
	return typeof record?.send === "function"
}

const oneLineText = (value: string) =>
	value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()

const boundedPreview = (value: string) => {
	const characters = [...oneLineText(value)]
	return characters.length <= maxOwnerResponsePreviewLength
		? characters.join("")
		: `${characters.slice(0, maxOwnerResponsePreviewLength - 1).join("")}…`
}

const markdownText = (value: string) =>
	oneLineText(value).replace(/([\\`*_~|>\[\]()#])/g, "\\$1")

const markdownUrl = (value: string) => {
	const safeUrl = value.replace(/[<>]/g, (character) => character === "<" ? "%3C" : "%3E")
	return `<${safeUrl}>`
}

const signalContextText = (notification: SignalContext) =>
	notification.scope === "publisher"
		? `**Publisher:** @${markdownText(notification.publisher)}`
		: `**Skill:** ${markdownText(notification.skillDisplayName ?? notification.skillSlug ?? "Unknown skill")} · @${markdownText(notification.publisher)}/${markdownText(notification.skillSlug ?? "unknown")}`

const responseKindText = (kind: OwnerResponse["responseKind"]) => {
	if (kind === "expected") return "Expected traffic"
	if (kind === "not_recognized") return "Unrecognized traffic"
	return "Unsure"
}

export const buildPublisherAbuseActionableContainer = (
	notification: ActionableNotification,
	roleId: string
) => {
	if (notification.kind === "publisher_abuse_signal_scan_failed") {
		return new Container(
			[
				new TextDisplay(`<@&${roleId}>`),
				new TextDisplay("### ClawHub signal scan stopped"),
				new TextDisplay(
					`Stopped after ${notification.failureCount.toLocaleString()} failed attempts.\n[Open ClawHub abuse signals](${markdownUrl(notification.dashboardUrl)})`
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(`**Run:** ${markdownText(notification.runId)}\n**Error:** ${markdownText(notification.errorMessage)}`)
			],
			{ accentColor: "#ef4444" }
		)
	}

	if (notification.kind === "publisher_abuse_signal_owner_contact_failed") {
		return new Container(
			[
				new TextDisplay(`<@&${roleId}>`),
				new TextDisplay("### ClawHub owner contact failed"),
				new TextDisplay(
					`${signalContextText(notification)}\n**Attempts:** ${notification.attemptCount.toLocaleString()}\n**Failure:** ${markdownText(notification.failureReason)}`
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(`[Open Signal](${markdownUrl(notification.dashboardUrl)})`)
			],
			{ accentColor: "#ef4444" }
		)
	}

	return new Container(
		[
			new TextDisplay(`<@&${roleId}>`),
			new TextDisplay("### ClawHub owner explanation received"),
			new TextDisplay(
				`${signalContextText(notification)}\n**Response:** ${responseKindText(notification.responseKind)}`
			),
			...(notification.responsePreview
				? [
					new Separator({ divider: true, spacing: "small" }),
					new TextDisplay(`**Owner note:** ${markdownText(boundedPreview(notification.responsePreview))}`)
				]
				: []),
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(`[Open Signal](${markdownUrl(notification.dashboardUrl)})`)
		],
		{ accentColor: "#3b82f6" }
	)
}

export const publisherAbuseDigestApiToken = (
	env: Partial<Pick<Env, "CLAWHUB_BAN_APPEALS_TOKEN" | "CLAWHUB_HERMIT_TOKEN">>
) => env.CLAWHUB_HERMIT_TOKEN?.trim() || env.CLAWHUB_BAN_APPEALS_TOKEN?.trim() || ""

export const handlePublisherAbuseDigestApi = async (
	request: Request,
	dependencies: Dependencies
): Promise<Response | null> => {
	const url = new URL(request.url)
	if (url.pathname !== apiPath) return null
	if (!dependencies.token || bearerToken(request) !== dependencies.token) {
		return jsonResponse({ error: "Unauthorized" }, 401)
	}
	if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

	let body: unknown
	try {
		body = await request.json()
	} catch {
		return jsonResponse({ error: "Invalid JSON" }, 400)
	}

	const trustedOrigins = trustedOriginSet(dependencies.trustedOrigins ?? [defaultClawHubSiteUrl])
	const notification = parseNotification(body, trustedOrigins)
	if (!notification) {
		return jsonResponse({ error: "Invalid publisher abuse notification payload" }, 400)
	}

	if (notification.kind === "publisher_abuse_signals_changed") {
		return jsonResponse({
			ok: true,
			delivered: false,
			deprecated: true,
			kind: notification.kind
		})
	}

	if (!dependencies.channelId || !dependencies.roleId) {
		return jsonResponse({ error: "Publisher abuse signal routing is not configured" }, 503)
	}
	const channel = await dependencies.fetchChannel(dependencies.channelId)
	if (!isSendableChannel(channel)) {
		throw new Error(`Review channel ${dependencies.channelId} is not sendable.`)
	}

	await channel.send({
		components: [buildPublisherAbuseActionableContainer(notification, dependencies.roleId)],
		allowedMentions: {
			roles: [dependencies.roleId],
			users: []
		}
	})

	return jsonResponse({ ok: true, delivered: true, kind: notification.kind })
}

export const handlePublisherAbuseDigestApiRequest = (
	request: Request,
	client: Client
): Promise<Response | null> => {
	const env = getRuntimeEnv()
	const routing = publisherAbuseSignalRouting(env)
	return handlePublisherAbuseDigestApi(request, {
		token: publisherAbuseDigestApiToken(env),
		trustedOrigins: publisherAbuseDigestTrustedOrigins(env),
		...routing,
		fetchChannel: (channelId) => client.fetchChannel(channelId)
	})
}
