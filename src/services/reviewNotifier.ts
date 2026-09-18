import { type Client, Routes, serializePayload } from "@buape/carbon"
import { reviewConfig } from "../config/review.js"
import {
	allocateReescalationRevision,
	attachReviewCaseReceipt,
	deferReviewReceiptReconciliation,
	listOutstandingReviewReceipts,
	claimReviewCaseDelivery,
	getReviewCase,
	getUndeliveredEscalations,
	listOutOfSyncCases,
	markReviewCardStaleWrite,
	markReviewCardSynced,
	updateReviewCase
} from "../data/review.js"
import type { ReviewCase } from "../db/schema.js"
import type { AnalysisReport, KrillEvaluation } from "../review/types.js"
import { buildReviewCardContainer } from "../components/reviewButtons.js"

type FindCardResult =
	| { status: "found"; messageId: string }
	| { status: "not_found" }
	| { status: "inconclusive" }

const hasReviewIdentity = (value: unknown, caseId: string): boolean => {
	if (Array.isArray(value)) return value.some((item) => hasReviewIdentity(item, caseId))
	if (!value || typeof value !== "object") return false
	const component = value as { content?: unknown; custom_id?: unknown; components?: unknown }
	if (component.content === `-# hermit-review:v1:${caseId}`) return true
	// Compatibility for existing open cards. Match the entire case ID, not a
	// substring of another case, a model brief, or an unrelated message body.
	if (typeof component.custom_id === "string") {
		for (const prefix of ["review-dismiss", "review-watchlist", "review-confirm-bot"]) {
			if (component.custom_id === `${prefix}:caseId=${caseId}`) return true
		}
	}
	return hasReviewIdentity(component.components, caseId)
}

const isReviewReceipt = (
	message: unknown,
	channelId: string,
	caseId: string
): message is { id: string } => {
	if (!message || typeof message !== "object") return false
	const candidate = message as {
		id?: unknown; channel_id?: unknown; components?: unknown
		author?: { id?: unknown; bot?: unknown }
	}
	const botId = process.env.DISCORD_CLIENT_ID
	return Boolean(botId) &&
		candidate.author?.id === botId && candidate.author?.bot === true &&
		typeof candidate.id === "string" && candidate.id.length > 0 &&
		(candidate.channel_id === undefined || candidate.channel_id === channelId) &&
		hasReviewIdentity(candidate.components, caseId)
}

const findExistingReviewCard = async (
	client: Client,
	channelId: string,
	caseId: string,
	_targetUserId: string
): Promise<FindCardResult> => {
	if (!process.env.DISCORD_CLIENT_ID) return { status: "inconclusive" }
	try {
		let before: string | undefined
		// Bounded lookup. Exhausting the budget is not proof a send failed.
		for (let page = 0; page < 5; page++) {
			const messages = await client.rest.get(Routes.channelMessages(channelId), {
				limit: 50,
				...(before ? { before } : {})
			}) as unknown
			if (!Array.isArray(messages)) return { status: "inconclusive" }
			for (const message of messages) {
				if (isReviewReceipt(message, channelId, caseId)) {
					return { status: "found", messageId: message.id }
				}
			}
			if (messages.length < 50) return { status: "not_found" }
			const lastId = messages[messages.length - 1]?.id
			if (typeof lastId !== "string" || !lastId || lastId === before) {
				return { status: "inconclusive" }
			}
			before = lastId
		}
		return { status: "inconclusive" }
	} catch (error) {
		console.warn("Failed to check existing channel messages:", error)
		return { status: "inconclusive" }
	}
}

const attachAndSyncReviewReceipt = async (
	client: Client,
	caseId: string,
	channelId: string,
	messageId: string
): Promise<boolean> => {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getReviewCase(caseId)
		if (!current || current.guildId !== reviewConfig.guildId) return false
		if ((current.reviewMessageId && current.reviewMessageId !== messageId) ||
			(current.reviewChannelId && current.reviewChannelId !== channelId)) {
			throw new Error(`Conflicting review receipt for ${caseId}`)
		}
		if (current.deliveryStatus === "delivered" && current.reviewMessageId === messageId) {
			return syncSharedReviewCard(client, current)
		}
		const attached = await attachReviewCaseReceipt(current, channelId, messageId)
		if (attached) return syncSharedReviewCard(client, attached)
	}
	// A changing row remains eligible for a later receipt-recovery pass.
	return false
}

const generateNonce = async (key: string): Promise<string> => {
	const hashBuffer = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(key)
	)
	return Array.from(new Uint8Array(hashBuffer), (b) =>
		b.toString(16).padStart(2, "0")
	)
		.join("")
		.slice(0, 25)
}

export async function postReviewEscalationCard(
	client: Client,
	reviewCase: ReviewCase,
	report?: AnalysisReport | null,
	krill?: KrillEvaluation | null
) {
	// Strictly enforce guild boundary
	if (reviewCase.guildId !== reviewConfig.guildId) {
		return
	}

	// Atomically claim delivery, ensuring the case is currently escalated and eligible
	const claimedCase = await claimReviewCaseDelivery(reviewCase.caseId)
	if (!claimedCase || claimedCase.status !== "escalated") {
		return
	}

	const channelId = reviewConfig.reviewChannelId

	// If the case already has a reviewMessageId (e.g. watchlist case escalating again),
	// reopen/refresh the existing card with active buttons rather than posting a duplicate
	if (claimedCase.reviewMessageId) {
		const allocated = await allocateReescalationRevision(claimedCase.caseId)
		if (!allocated || allocated.status !== "escalated") {
			return
		}

		const container = buildReviewCardContainer(allocated, report, krill, false)
		const payload = serializePayload({
			components: [container],
			allowedMentions: { parse: [] }
		})

		try {
			await client.rest.patch(
				Routes.channelMessage(channelId, allocated.reviewMessageId!),
				{ body: payload }
			)
			const synced = await markReviewCardSynced(
				allocated.caseId,
				allocated.cardRevision
			)
			if (!synced) {
				await markReviewCardStaleWrite(
					allocated.caseId,
					allocated.cardRevision
				)
				await syncSharedReviewCard(client, allocated)
			} else {
				await updateReviewCase(allocated.caseId, {
					reviewChannelId: channelId,
					deliveryStatus: "delivered"
				})
			}
			return
		} catch (patchError: any) {
			if (patchError?.status === 404) {
				// Old card deleted in Discord; clear messageId and proceed to send fresh
				await updateReviewCase(allocated.caseId, { reviewMessageId: null })
				claimedCase.reviewMessageId = null
			} else {
				console.warn("[ReviewNotifier] Failed to refresh existing card:", patchError)
				const repairs = await Promise.allSettled([
					markReviewCardStaleWrite(allocated.caseId, allocated.cardRevision),
					deferReviewReceiptReconciliation(allocated)
				])
				const failures = repairs.filter((result) => result.status === "rejected")
				if (failures.length > 0) {
					throw new AggregateError(
						failures.map((result) => result.reason),
						"Failed to persist existing-card recovery work"
					)
				}
				return
			}
		}
	}

	// Treat uncertain deliveries and stale claims conservatively:
	// A stale claim (>120s) means a previous worker may have already sent the card before being interrupted.
	const wasUncertain =
		claimedCase.previousDeliveryStatus === "uncertain" ||
		claimedCase.previousDeliveryStatus === "delivering"

	if (wasUncertain) {
		const lookup = await findExistingReviewCard(
			client,
			channelId,
			claimedCase.caseId,
			claimedCase.targetUserId
		)
		if (lookup.status === "found") {
			await attachAndSyncReviewReceipt(client, claimedCase.caseId, channelId, lookup.messageId)
			return
		}
		// Inconclusive or not found: preserve uncertainty; do not send another POST
		console.warn(
			`[ReviewNotifier] Delivery for case ${claimedCase.caseId} remains uncertain; reconciliation did not find Hermit card`
		)
		await updateReviewCase(claimedCase.caseId, {
			deliveryStatus: "uncertain"
		})
		return
	}

	// Reconcile before first send
	const existingCheck = await findExistingReviewCard(
		client,
		channelId,
		claimedCase.caseId,
		claimedCase.targetUserId
	)
	if (existingCheck.status === "found") {
		await attachAndSyncReviewReceipt(client, claimedCase.caseId, channelId, existingCheck.messageId)
		return
	}

	// Guard against case revisions made while awaiting channel history
	const freshCase = await getReviewCase(claimedCase.caseId)
	if (!freshCase || freshCase.status !== "escalated") {
		// Staff intervened (dismissed/watchlist); abort send immediately
		return
	}
	const caseToRender = freshCase

	try {
		// Render with fresh case state
		const container = buildReviewCardContainer(caseToRender, report, krill, false)
		const payload = serializePayload({
			components: [container],
			allowedMentions: { parse: [] }
		})
		const nonce = await generateNonce(
			`review-escalate:${claimedCase.caseId}:${claimedCase.cardRevision || 1}`
		)

		const sent = (await client.rest.post(Routes.channelMessages(channelId), {
			body: {
				...payload,
				nonce,
				enforce_nonce: true
			}
		})) as { id: string }

		if (sent?.id) {
			try {
				await attachAndSyncReviewReceipt(client, claimedCase.caseId, channelId, sent.id)
			} catch (dbError) {
				// Leave the existing attempted-send state (or attached dirty receipt)
				// recoverable. Never overwrite a newer receipt with this old response.
				console.error("Review receipt attachment/synchronization failed:", dbError)
			}
		} else {
			await updateReviewCase(claimedCase.caseId, {
				deliveryStatus: "uncertain"
			})
		}
	} catch (error) {
		const status =
			error && typeof error === "object" && "status" in error
				? (error as any).status
				: null
		// Only an explicit 4xx rejection proves Discord rejected the message
		const rejected =
			typeof status === "number" && status >= 400 && status < 500 && status !== 408
		console.error("Failed to post review escalation card to Discord:", error)
		await updateReviewCase(claimedCase.caseId, {
			deliveryStatus: rejected ? "failed" : "uncertain"
		})
	}
}

export async function syncSharedReviewCard(
	client: Client,
	reviewCase: ReviewCase
): Promise<boolean> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const fresh = await getReviewCase(reviewCase.caseId)
		if (!fresh || fresh.guildId !== reviewConfig.guildId ||
			!fresh.reviewMessageId || !fresh.reviewChannelId) return false
		if (fresh.cardRevision <= fresh.syncedCardRevision) return true

		const renderedRevision = fresh.cardRevision
		try {
			const container = buildReviewCardContainer(fresh, null, null, fresh.status !== "escalated")
			await client.rest.patch(
				Routes.channelMessage(fresh.reviewChannelId, fresh.reviewMessageId),
				{ body: serializePayload({ components: [container], allowedMentions: { parse: [] } }) }
			)
			const synced = await markReviewCardSynced(fresh.caseId, renderedRevision)
			if (synced) return true
			await markReviewCardStaleWrite(fresh.caseId, renderedRevision)
		} catch (error) {
			console.warn("Failed to synchronize shared review card:", error)
			// Discord may have applied this payload after a newer acknowledged
			// write. A lost response is not proof that this write was rejected.
			// Let persistence errors propagate so maintenance reports them.
			await markReviewCardStaleWrite(fresh.caseId, renderedRevision)
			return false
		}
	}
	// Each stale acknowledgment above left durable dirty work for maintenance.
	return false
}

export async function recoverReviewReceipts(client: Client) {
	const outstanding = await listOutstandingReviewReceipts(reviewConfig.guildId, 10)
	for (const reviewCase of outstanding) {
		try {
			if (reviewCase.guildId !== reviewConfig.guildId) continue
			const channelId = reviewCase.reviewChannelId ?? reviewConfig.reviewChannelId
			let result: FindCardResult
			if (reviewCase.reviewMessageId) {
				const message = await client.rest.get(
					Routes.channelMessage(channelId, reviewCase.reviewMessageId)
				)
				result = isReviewReceipt(message, channelId, reviewCase.caseId) &&
					message.id === reviewCase.reviewMessageId
					? { status: "found", messageId: message.id }
					: { status: "inconclusive" }
			} else {
				result = await findExistingReviewCard(client, channelId, reviewCase.caseId, reviewCase.targetUserId)
			}
			if (result.status === "found") {
				await attachAndSyncReviewReceipt(client, reviewCase.caseId, channelId, result.messageId)
			} else {
				await deferReviewReceiptReconciliation(reviewCase)
				console.warn(`[ReviewNotifier] Receipt for ${reviewCase.caseId} remains unresolved (${result.status})`)
			}
		} catch (error) {
			console.error(`[ReviewNotifier] Receipt recovery failed for ${reviewCase.caseId}:`, error)
			try {
				await deferReviewReceiptReconciliation(reviewCase)
			} catch (persistenceError) {
				console.error("Failed to persist receipt recovery backoff:", persistenceError)
			}
		}
	}
}

export async function recoverSharedCardSync(client: Client) {
	const outOfSync = await listOutOfSyncCases(10)
	for (const reviewCase of outOfSync) {
		try {
			await syncSharedReviewCard(client, reviewCase)
		} catch (error) {
			console.error(`Shared card recovery failed for ${reviewCase.caseId}:`, error)
		}
	}
}

export async function recoverReviewEscalations(client: Client) {
	const pending = await getUndeliveredEscalations(reviewConfig.guildId, 5)
	for (const reviewCase of pending) {
		try {
			await postReviewEscalationCard(client, reviewCase)
		} catch (error) {
			console.error(`Escalation recovery failed for ${reviewCase.caseId}:`, error)
		}
	}
}
