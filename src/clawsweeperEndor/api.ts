import {
	Container,
	Routes,
	Separator,
	TextDisplay,
	serializePayload,
	type Client,
	type MessagePayloadObject
} from "@buape/carbon"
import { getRuntimeEnv } from "../runtime/env.js"
import {
	claimEndorDelivery,
	markEndorDeliveryDelivered,
	type ClaimEndorDeliveryInput,
	type ClaimEndorDeliveryResult
} from "./deliveries.js"

export type EndorRemediationNotification = {
	version: 1
	type: "clawsweeper.endor_remediation_reviewed"
	repo: string
	prNumber: number
	prUrl: string
	title: string
	findingSummary: string
	reviewedHeadSha: string
	outcome: "ready" | "needs_attention" | "unknown"
	reviewSummary: string
	reviewUrl: string
	checks: {
		state: "passing" | "pending" | "failing" | "unknown"
		total: number | null
		summary: string
	}
	mergeState: "clean" | "blocked" | "behind" | "unstable" | "unknown"
	cycles: number
	cleanStreak: number
	idempotencyKey: string
}

type EndorDiscordMessage = {
	components: Container[]
	allowedMentions: NonNullable<MessagePayloadObject["allowedMentions"]>
}

type EndorApiDependencies = {
	token: string
	channelId: string
	now?: () => Date
	claimDelivery: (input: ClaimEndorDeliveryInput) => Promise<ClaimEndorDeliveryResult>
	markDelivered: (
		idempotencyKey: string,
		payloadDigest: string,
		messageId: string
	) => Promise<void>
	sendMessage: (
		channelId: string,
		message: EndorDiscordMessage,
		nonce: string
	) => Promise<{ messageId: string }>
}

const apiPath = "/api/clawsweeper/endor-remediation/reviewed"
const pendingRetryWindowMs = 10 * 60 * 1000
const githubOrigin = "https://github.com"

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" }
	})

const readRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null

const requiredString = (value: unknown, maximumLength: number) =>
	typeof value === "string" && value.trim() && value.trim().length <= maximumLength
		? value.trim()
		: null

const integerInRange = (value: unknown, minimum: number, maximum: number) =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	value >= minimum &&
	value <= maximum
		? value
		: null

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | null =>
	typeof value === "string" && values.includes(value as T) ? value as T : null

const exactGithubUrl = (value: unknown, expectedPath: string, fragmentPattern?: RegExp) => {
	const raw = requiredString(value, 2048)
	if (!raw) {
		return null
	}
	try {
		const url = new URL(raw)
		if (
			url.origin !== githubOrigin ||
			url.pathname.toLowerCase() !== expectedPath.toLowerCase() ||
			url.search ||
			(fragmentPattern ? !fragmentPattern.test(url.hash) : Boolean(url.hash))
		) {
			return null
		}
		return url.toString()
	} catch {
		return null
	}
}

export const parseEndorRemediationNotification = (
	value: unknown
): EndorRemediationNotification | null => {
	const record = readRecord(value)
	const checks = readRecord(record?.checks)
	if (!record || !checks) {
		return null
	}

	const repo = requiredString(record.repo, 200)
	const prNumber = integerInRange(record.prNumber, 1, Number.MAX_SAFE_INTEGER)
	const title = requiredString(record.title, 256)
	const findingSummary = requiredString(record.findingSummary, 1000)
	const reviewedHeadSha = requiredString(record.reviewedHeadSha, 40)
	const outcome = oneOf(record.outcome, ["ready", "needs_attention", "unknown"] as const)
	const reviewSummary = requiredString(record.reviewSummary, 1000)
	const checkState = oneOf(checks.state, [
		"passing",
		"pending",
		"failing",
		"unknown"
	] as const)
	const checkSummary = requiredString(checks.summary, 1000)
	const checkTotal = checks.total === null
		? null
		: integerInRange(checks.total, 0, 10000)
	const mergeState = oneOf(record.mergeState, [
		"clean",
		"blocked",
		"behind",
		"unstable",
		"unknown"
	] as const)
	const cycles = integerInRange(record.cycles, 1, 6)
	const cleanStreak = integerInRange(record.cleanStreak, 0, 3)
	const idempotencyKey = requiredString(record.idempotencyKey, 512)

	if (
		record.version !== 1 ||
		record.type !== "clawsweeper.endor_remediation_reviewed" ||
		!repo ||
		!repo.match(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) ||
		!prNumber ||
		!title ||
		!findingSummary ||
		!reviewedHeadSha?.match(/^[0-9a-f]{40}$/i) ||
		!outcome ||
		!reviewSummary ||
		!checkState ||
		!checkSummary ||
		(checkTotal === null && checks.total !== null) ||
		!mergeState ||
		!cycles ||
		cleanStreak === null ||
		!idempotencyKey
	) {
		return null
	}

	const expectedKey = [
		"clawsweeper.endor_remediation_reviewed",
		repo,
		String(prNumber),
		reviewedHeadSha,
		outcome
	].join(":")
	const expectedPullPath = `/${repo}/pull/${prNumber}`
	const prUrl = exactGithubUrl(record.prUrl, expectedPullPath)
	const reviewUrl = exactGithubUrl(
		record.reviewUrl,
		expectedPullPath,
		/^#issuecomment-\d+$/
	)
	if (idempotencyKey !== expectedKey || !prUrl || !reviewUrl) {
		return null
	}

	return {
		version: 1,
		type: "clawsweeper.endor_remediation_reviewed",
		repo,
		prNumber,
		prUrl,
		title,
		findingSummary,
		reviewedHeadSha,
		outcome,
		reviewSummary,
		reviewUrl,
		checks: { state: checkState, total: checkTotal, summary: checkSummary },
		mergeState,
		cycles,
		cleanStreak,
		idempotencyKey
	}
}

const markdownText = (value: string) =>
	value
		.replaceAll("\\", "\\\\")
		.replace(/([`*_{}\[\]()<>#+\-.!|])/g, "\\$1")
		.replace(/\s+/g, " ")
		.trim()

const markdownUrl = (value: string) => `<${value.replaceAll(">", "%3E")}>`

export const buildEndorRemediationContainer = (
	notification: EndorRemediationNotification
) => {
	const status = notification.outcome === "ready"
		? "READY"
		: notification.outcome === "unknown"
			? "UNKNOWN"
			: "NEEDS ATTENTION"
	const accentColor = notification.outcome === "ready"
		? "#22c55e"
		: notification.outcome === "unknown"
			? "#f2c94c"
			: "#ef4444"

	return new Container(
		[
			new TextDisplay(`### 🔐 Endor remediation reviewed — ${status}`),
			new TextDisplay(
				`**Repository:** ${markdownText(notification.repo)}\n**Pull request:** #${notification.prNumber} — ${markdownText(notification.title)}`
			),
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(`**Finding summary:** ${markdownText(notification.findingSummary)}`),
			new TextDisplay(
				`**ClawSweeper review:** ${notification.cleanStreak}/3 clean after ${notification.cycles}/6 cycles — ${markdownText(notification.reviewSummary)}`
			),
			new TextDisplay(
				`**CI checks:** ${notification.checks.state} — ${markdownText(notification.checks.summary)}\n**GitHub merge state:** ${notification.mergeState}\n**Reviewed head:** \`${notification.reviewedHeadSha}\``
			),
			new TextDisplay(
				`[Open review](${markdownUrl(notification.reviewUrl)}) · [Open PR](${markdownUrl(notification.prUrl)})`
			),
			new TextDisplay(
				"To request the existing guarded merge path, open the PR on GitHub and comment `@clawsweeper automerge`."
			)
		],
		{ accentColor }
	)
}

const sha256 = async (value: string) => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export const endorDeliveryIdentity = async (notification: EndorRemediationNotification) => {
	const payloadDigest = await sha256(JSON.stringify(notification))
	return {
		payloadDigest,
		nonce: `endor-${(await sha256(notification.idempotencyKey)).slice(0, 19)}`
	}
}

const pendingIsRetryable = (createdAt: string, now: Date) => {
	const createdAtMs = Date.parse(createdAt)
	return Number.isFinite(createdAtMs) && now.getTime() - createdAtMs <= pendingRetryWindowMs
}

export const handleClawSweeperEndorApi = async (
	request: Request,
	dependencies: EndorApiDependencies
): Promise<Response | null> => {
	const url = new URL(request.url)
	if (url.pathname !== apiPath) {
		return null
	}
	const bearerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? ""
	if (!dependencies.token || bearerToken !== dependencies.token) {
		return jsonResponse({ error: "Unauthorized" }, 401)
	}
	if (request.method !== "POST") {
		return jsonResponse({ error: "Method not allowed" }, 405)
	}
	if (!dependencies.channelId) {
		return jsonResponse({ error: "Endor notification channel is not configured" }, 503)
	}

	let body: unknown
	try {
		body = await request.json()
	} catch {
		return jsonResponse({ error: "Invalid JSON" }, 400)
	}
	const notification = parseEndorRemediationNotification(body)
	if (!notification) {
		return jsonResponse({ error: "Invalid Endor remediation notification" }, 400)
	}
	if (request.headers.get("idempotency-key") !== notification.idempotencyKey) {
		return jsonResponse({ error: "Idempotency key does not match the notification" }, 400)
	}

	const identity = await endorDeliveryIdentity(notification)
	const claim = await dependencies.claimDelivery({
		idempotencyKey: notification.idempotencyKey,
		payloadDigest: identity.payloadDigest,
		nonce: identity.nonce,
		channelId: dependencies.channelId
	})
	if (claim.state === "conflict") {
		return jsonResponse({ error: "Idempotency key was already used for different content" }, 409)
	}
	if (claim.delivery.status === "delivered" && claim.delivery.messageId) {
		return jsonResponse({
			ok: true,
			delivered: true,
			duplicate: true,
			messageId: claim.delivery.messageId
		})
	}
	if (
		claim.state === "existing" &&
		!pendingIsRetryable(claim.delivery.createdAt, dependencies.now?.() ?? new Date())
	) {
		return jsonResponse({
			error: "Delivery status is ambiguous; inspect the configured Discord channel before retrying"
		}, 409)
	}

	const message: EndorDiscordMessage = {
		components: [buildEndorRemediationContainer(notification)],
		allowedMentions: { roles: [], users: [] }
	}
	const sent = await dependencies.sendMessage(
		dependencies.channelId,
		message,
		identity.nonce
	)
	await dependencies.markDelivered(
		notification.idempotencyKey,
		identity.payloadDigest,
		sent.messageId
	)

	return jsonResponse({
		ok: true,
		delivered: true,
		duplicate: claim.state === "existing",
		messageId: sent.messageId
	})
}

export const handleClawSweeperEndorApiRequest = (
	request: Request,
	client: Client
): Promise<Response | null> => {
	const env = getRuntimeEnv()
	return handleClawSweeperEndorApi(request, {
		token: env.CLAWSWEEPER_HERMIT_TOKEN?.trim() ?? "",
		channelId: env.CLAWSWEEPER_ENDOR_DISCORD_CHANNEL_ID?.trim() ?? "",
		claimDelivery: claimEndorDelivery,
		markDelivered: markEndorDeliveryDelivered,
		sendMessage: async (channelId, message, nonce) => {
			const response = await client.rest.post(Routes.channelMessages(channelId), {
				body: {
					...serializePayload(message),
					nonce,
					enforce_nonce: true
				}
			})
			const record = readRecord(response)
			const messageId = requiredString(record?.id, 100)
			if (!messageId) {
				throw new Error("Discord did not return an Endor notification message ID")
			}
			return { messageId }
		}
	})
}
