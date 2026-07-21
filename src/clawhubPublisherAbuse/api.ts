import {
	Container,
	Separator,
	TextDisplay,
	type Client,
	type MessagePayloadObject
} from "@buape/carbon"
import { formSettings } from "../../forms.config.js"
import { getRuntimeEnv } from "../runtime/env.js"

type PublisherAbuseSignal = {
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

type PublisherAbuseDigest = {
	kind: "publisher_abuse_signals_changed"
	changedCount: number
	hasMore: boolean
	dashboardUrl: string
	topSignals: PublisherAbuseSignal[]
}

type PublisherAbuseScanFailure = {
	kind: "publisher_abuse_signal_scan_failed"
	runId: string
	failureCount: number
	errorMessage: string
	failedAt: number
	dashboardUrl: string
}

type PublisherAbuseNotification = PublisherAbuseDigest | PublisherAbuseScanFailure

type PublisherAbuseDiscordMessage = {
	components: Container[]
	allowedMentions: NonNullable<MessagePayloadObject["allowedMentions"]>
}

type SendableChannel = {
	send: (message: PublisherAbuseDiscordMessage) => Promise<unknown>
}

type PublisherAbuseDigestApiDependencies = {
	token: string
	trustedOrigins?: string[]
	fetchChannel: (channelId: string) => Promise<unknown>
}

const apiPath = "/api/clawhub-publisher-abuse/signals/digest"
const defaultClawHubSiteUrl = "https://clawhub.ai"

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
	typeof value === "string" && value.trim() ? value.trim() : null

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

const trustedOriginSet = (origins: string[]) =>
	new Set(origins.map((origin) => urlOrigin(origin.trim()) ?? origin.trim()).filter(Boolean))

const validUrl = (value: unknown, trustedOrigins: ReadonlySet<string>) => {
	const url = requiredString(value)
	if (!url) {
		return null
	}
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

const parseSignal = (value: unknown, trustedOrigins: ReadonlySet<string>): PublisherAbuseSignal | null => {
	const record = readRecord(value)
	if (!record) {
		return null
	}

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

const parseDigest = (value: unknown, trustedOrigins: ReadonlySet<string>): PublisherAbuseDigest | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signals_changed") {
		return null
	}

	const changedCount = nonNegativeInteger(record.changedCount)
	const dashboardUrl = validUrl(record.dashboardUrl, trustedOrigins)
	const topSignals = Array.isArray(record.topSignals)
		? record.topSignals.map((signal) => parseSignal(signal, trustedOrigins))
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
		topSignals: topSignals.filter((signal): signal is PublisherAbuseSignal => signal !== null)
	}
}

const parseScanFailure = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): PublisherAbuseScanFailure | null => {
	const record = readRecord(value)
	if (!record || record.kind !== "publisher_abuse_signal_scan_failed") {
		return null
	}

	const runId = requiredString(record.runId)
	const failureCount = nonNegativeInteger(record.failureCount)
	const errorMessage = requiredString(record.errorMessage)
	const failedAt = nonNegativeInteger(record.failedAt)
	const dashboardUrl = validUrl(record.dashboardUrl, trustedOrigins)
	if (!runId || failureCount === null || failureCount === 0 || !errorMessage || failedAt === null || !dashboardUrl) {
		return null
	}

	return {
		kind: "publisher_abuse_signal_scan_failed",
		runId,
		failureCount,
		errorMessage,
		failedAt,
		dashboardUrl
	}
}

const parseNotification = (
	value: unknown,
	trustedOrigins: ReadonlySet<string>
): PublisherAbuseNotification | null =>
	parseDigest(value, trustedOrigins) ?? parseScanFailure(value, trustedOrigins)

const isSendableChannel = (channel: unknown): channel is SendableChannel => {
	const record = readRecord(channel)
	return typeof record?.send === "function"
}

const plural = (count: number, singular: string, pluralValue = `${singular}s`) =>
	count === 1 ? singular : pluralValue

const reviewVerb = (count: number) => count === 1 ? "needs" : "need"

const titleCaseSignalType = (signalType: string) =>
	signalType
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ")

const oneLineText = (value: string) =>
	value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()

const markdownText = (value: string) =>
	oneLineText(value).replace(/([\\`*_~|>\[\]()#])/g, "\\$1")

const markdownUrl = (value: string) => {
	const safeUrl = value.replace(/[<>]/g, (character) => character === "<" ? "%3C" : "%3E")
	return `<${safeUrl}>`
}

const metricLine = (signal: PublisherAbuseSignal) => {
	if (
		signal.recent7Downloads === null ||
		signal.recent7Installs === null ||
		signal.recent7InstallDownloadRatio === null
	) {
		return null
	}

	return `7d: ${signal.recent7Installs.toLocaleString()} installs / ${signal.recent7Downloads.toLocaleString()} downloads (${(signal.recent7InstallDownloadRatio * 100).toFixed(1)}%)`
}

const signalLinks = (signal: PublisherAbuseSignal) => [
	signal.skillUrl ? `[Skill](${markdownUrl(signal.skillUrl)})` : null,
	signal.publisherUrl ? `[Publisher](${markdownUrl(signal.publisherUrl)})` : null
].filter((link): link is string => Boolean(link))

const signalText = (signal: PublisherAbuseSignal) => {
	const title = markdownText(signal.skillDisplayName ?? signal.skillSlug)
	const links = signalLinks(signal)
	return [
		`**${markdownText(titleCaseSignalType(signal.signalType))}** · ${markdownText(signal.severity.toUpperCase())}`,
		`${title} · ${markdownText(signal.publisher)}/${markdownText(signal.skillSlug)}`,
		`Seen ${signal.seenCount}x`,
		metricLine(signal),
		links.length ? links.join(" · ") : null
	].filter((line): line is string => Boolean(line)).join("\n")
}

export const publisherAbuseDigestApiToken = (
	env: Partial<Pick<Env, "CLAWHUB_BAN_APPEALS_TOKEN" | "CLAWHUB_HERMIT_TOKEN">>
) => env.CLAWHUB_HERMIT_TOKEN?.trim() || env.CLAWHUB_BAN_APPEALS_TOKEN?.trim() || ""

export const buildPublisherAbuseDigestContainer = (digest: PublisherAbuseDigest) =>
	new Container(
		[
			new TextDisplay(`<@&${formSettings.clawhubAppealReviewRoleId}>`),
			new TextDisplay("### ClawHub publisher abuse signals changed"),
			new TextDisplay(
				`${digest.changedCount.toLocaleString()} changed ${plural(digest.changedCount, "signal")} ${reviewVerb(digest.changedCount)} review.\n[Open ClawHub abuse signals](${markdownUrl(digest.dashboardUrl)})`
			),
			new Separator({ divider: true, spacing: "small" }),
			...digest.topSignals.slice(0, 5).map((signal) => new TextDisplay(signalText(signal))),
			...(digest.hasMore || digest.topSignals.length > 5
				? [new TextDisplay("More signals are available in ClawHub.")]
				: [])
		],
		{ accentColor: "#f2c94c" }
	)

export const buildPublisherAbuseScanFailureContainer = (failure: PublisherAbuseScanFailure) =>
	new Container(
		[
			new TextDisplay(`<@&${formSettings.clawhubAppealReviewRoleId}>`),
			new TextDisplay("### ClawHub signal scan stopped"),
			new TextDisplay(
				`Stopped after ${failure.failureCount.toLocaleString()} failed attempts.\n[Open ClawHub abuse signals](${markdownUrl(failure.dashboardUrl)})`
			),
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(`**Run:** ${markdownText(failure.runId)}\n**Error:** ${markdownText(failure.errorMessage)}`)
		],
		{ accentColor: "#ef4444" }
	)

export const handlePublisherAbuseDigestApi = async (
	request: Request,
	dependencies: PublisherAbuseDigestApiDependencies
): Promise<Response | null> => {
	const url = new URL(request.url)
	if (url.pathname !== apiPath) {
		return null
	}
	if (!dependencies.token || bearerToken(request) !== dependencies.token) {
		return jsonResponse({ error: "Unauthorized" }, 401)
	}
	if (request.method !== "POST") {
		return jsonResponse({ error: "Method not allowed" }, 405)
	}

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

	const channel = await dependencies.fetchChannel(formSettings.clawhubAppealReviewChannelId)
	if (!isSendableChannel(channel)) {
		throw new Error(`Review channel ${formSettings.clawhubAppealReviewChannelId} is not sendable.`)
	}

	await channel.send({
		components: [
			notification.kind === "publisher_abuse_signals_changed"
				? buildPublisherAbuseDigestContainer(notification)
				: buildPublisherAbuseScanFailureContainer(notification)
		],
		allowedMentions: {
			roles: [formSettings.clawhubAppealReviewRoleId],
			users: []
		}
	})

	return notification.kind === "publisher_abuse_signals_changed"
		? jsonResponse({
			ok: true,
			delivered: true,
			changedCount: notification.changedCount
		})
		: jsonResponse({
			ok: true,
			delivered: true,
			kind: notification.kind
		})
}

export const handlePublisherAbuseDigestApiRequest = (
	request: Request,
	client: Client
): Promise<Response | null> => {
	const env = getRuntimeEnv()
	return handlePublisherAbuseDigestApi(request, {
		token: publisherAbuseDigestApiToken(env),
		trustedOrigins: publisherAbuseDigestTrustedOrigins(env),
		fetchChannel: (channelId) => client.fetchChannel(channelId)
	})
}
