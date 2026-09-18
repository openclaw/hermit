import { and, eq, gte, gt, sql, desc, asc, inArray } from "drizzle-orm"
import { getDb } from "../db.js"
import {
	reviewCases,
	reviewObservations,
	type NewReviewCase,
	type NewReviewObservation,
	type ReviewCase,
	type ReviewObservation
} from "../db/schema.js"
import type { ReviewMessage } from "../review/types.js"
import { reviewConfig } from "../config/review.js"
import {
	getRecentDiscrawlObservations,
	getDiscrawlObservationCount,
	fetchRemoteDiscrawlObservations,
	fetchRemoteDiscrawlCount
} from "../services/discrawl.js"

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

export const recordObservation = async (
	observation: NewReviewObservation
): Promise<ReviewObservation | null> => {
	if (reviewConfig.discrawlExportPath || reviewConfig.discrawlExportUrl) {
		return null
	}
	const [record] = await getDb()
		.insert(reviewObservations)
		.values(observation)
		.onConflictDoNothing({ target: [reviewObservations.messageId] })
		.returning()

	return record ?? null
}

export const getRecentUserObservations = async (
	guildId: string,
	authorId: string,
	windowDays = 7,
	limit = 200
): Promise<ReviewMessage[]> => {
	if (reviewConfig.discrawlExportUrl) {
		return fetchRemoteDiscrawlObservations(
			reviewConfig.discrawlExportUrl,
			reviewConfig.discrawlSecret || "",
			guildId,
			authorId,
			windowDays,
			limit
		)
	}
	if (reviewConfig.discrawlExportPath) {
		return getRecentDiscrawlObservations(
			reviewConfig.discrawlExportPath,
			guildId,
			authorId,
			windowDays,
			limit
		)
	}

	const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString()

	const rows = await getDb()
		.select()
		.from(reviewObservations)
		.where(
			and(
				eq(reviewObservations.guildId, guildId),
				eq(reviewObservations.authorId, authorId),
				gte(reviewObservations.createdAt, cutoff)
			)
		)
		.orderBy(desc(reviewObservations.createdAt))
		.limit(limit)

	if (rows.length === 0) {
		return []
	}

	// Fetch reply parent timestamps to compute replyLatencyMs
	const replyIds = rows
		.map((r) => r.replyToId)
		.filter((id): id is string => Boolean(id))

	const parentMap = new Map<string, number>()
	if (replyIds.length > 0) {
		const parents = await getDb()
			.select({
				messageId: reviewObservations.messageId,
				createdAt: reviewObservations.createdAt
			})
			.from(reviewObservations)
			.where(inArray(reviewObservations.messageId, replyIds))

		for (const p of parents) {
			parentMap.set(p.messageId, new Date(p.createdAt).getTime())
		}
	}

	return rows.map((r) => {
		const createdTime = new Date(r.createdAt).getTime()
		let replyLatencyMs: number | null = null
		if (r.replyToId && parentMap.has(r.replyToId)) {
			const parentTime = parentMap.get(r.replyToId)!
			if (createdTime >= parentTime) {
				replyLatencyMs = createdTime - parentTime
			}
		}

		let parsedArtifacts: string[] = []
		try {
			parsedArtifacts = JSON.parse(r.artifacts)
		} catch {
			parsedArtifacts = []
		}

		return {
			...r,
			createdAt: createdTime,
			artifacts: parsedArtifacts as any,
			replyLatencyMs
		}
	})
}

export const createReviewCase = async (
	data: NewReviewCase
): Promise<ReviewCase | null> => {
	const [reviewCase] = await getDb()
		.insert(reviewCases)
		.values(data)
		.onConflictDoUpdate({
			target: [reviewCases.caseId],
			set: {
				status: sql`CASE 
					WHEN review_cases.status = 'open' THEN ${data.status}
					WHEN review_cases.status = 'watchlist' AND review_cases.expires_at IS NOT NULL AND review_cases.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN ${data.status}
					ELSE review_cases.status 
				END`,
				deliveryStatus: sql`CASE
					WHEN review_cases.status = 'open' THEN ${data.deliveryStatus ?? "pending"}
					WHEN review_cases.status = 'watchlist' AND review_cases.expires_at IS NOT NULL AND review_cases.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'pending'
					ELSE review_cases.delivery_status
				END`,
				heuristicScore: data.heuristicScore,
				concordance: data.concordance,
				behavioralFamilies: data.behavioralFamilies,
				evidenceMessageId: data.evidenceMessageId,
				krillProbability: data.krillProbability,
				krillBrief: data.krillBrief,
				krillModel: data.krillModel,
				reviewChannelId: data.reviewChannelId,
				updatedAt: now
			}
		})
		.returning()

	return reviewCase ?? null
}

export const getReviewCase = async (
	caseId: string
): Promise<ReviewCase | null> => {
	const [record] = await getDb()
		.select()
		.from(reviewCases)
		.where(eq(reviewCases.caseId, caseId))
		.limit(1)

	return record ?? null
}

export const updateReviewCase = async (
	caseId: string,
	update: Partial<NewReviewCase>
): Promise<ReviewCase | null> => {
	const [updated] = await getDb()
		.update(reviewCases)
		.set({
			...update,
			updatedAt: now
		})
		.where(eq(reviewCases.caseId, caseId))
		.returning()

	return updated ?? null
}

export const claimReviewCaseDelivery = async (
	caseId: string,
	claimTimeoutMs = 120_000
): Promise<ReviewCase | null> => {
	const staleCutoff = new Date(Date.now() - claimTimeoutMs).toISOString()
	const [claimed] = await getDb()
		.update(reviewCases)
		.set({
			previousDeliveryStatus: reviewCases.deliveryStatus,
			deliveryStatus: "delivering",
			updatedAt: now
		})
		.where(
			and(
				eq(reviewCases.caseId, caseId),
				eq(reviewCases.status, "escalated"),
				sql`(${reviewCases.deliveryStatus} IN ('pending', 'failed', 'uncertain') OR (${reviewCases.deliveryStatus} = 'delivering' AND ${reviewCases.updatedAt} <= ${staleCutoff}))`
			)
		)
		.returning()

	return claimed ?? null
}

export const recordReviewCaseDecision = async (
	caseId: string,
	decision: {
		status: "dismissed" | "watchlist" | "confirmed_bot"
		expiresAt?: string | null
		decidedById?: string | null
		decisionReason: string
	}
): Promise<ReviewCase | null> => {
	const [updated] = await getDb()
		.update(reviewCases)
		.set({
			status: decision.status,
			expiresAt: decision.expiresAt ?? null,
			decidedById: decision.decidedById,
			decisionReason: decision.decisionReason,
			cardRevision: sql`${reviewCases.cardRevision} + 1`,
			updatedAt: now
		})
		.where(eq(reviewCases.caseId, caseId))
		.returning()

	return updated ?? null
}

export const markReviewCardSynced = async (
	caseId: string,
	revision: number
): Promise<ReviewCase | null> => {
	const [updated] = await getDb()
		.update(reviewCases)
		.set({
			syncedCardRevision: revision,
			updatedAt: now
		})
		.where(
			and(
				eq(reviewCases.caseId, caseId),
				eq(reviewCases.cardRevision, revision)
			)
		)
		.returning()

	return updated ?? null
}

export const markReviewCardStaleWrite = async (
	caseId: string,
	renderedRevision: number
): Promise<ReviewCase | null> => {
	const [updated] = await getDb()
		.update(reviewCases)
		.set({
			cardRevision: sql`${reviewCases.cardRevision} + 1`,
			updatedAt: now
		})
		.where(
			and(
				eq(reviewCases.caseId, caseId),
				gt(reviewCases.cardRevision, renderedRevision)
			)
		)
		.returning()

	return updated ?? null
}

export const allocateReescalationRevision = async (
	caseId: string
): Promise<ReviewCase | null> => {
	const [record] = await getDb()
		.update(reviewCases)
		.set({
			cardRevision: sql`${reviewCases.cardRevision} + 1`,
			deliveryStatus: "delivering",
			updatedAt: now
		})
		.where(
			and(
				eq(reviewCases.caseId, caseId),
				eq(reviewCases.status, "escalated")
			)
		)
		.returning()

	return record ?? null
}

export const getUndeliveredEscalations = async (
	guildId: string,
	limit = 10,
	claimTimeoutMs = 120_000
): Promise<ReviewCase[]> => {
	const staleCutoff = new Date(Date.now() - claimTimeoutMs).toISOString()
	const uncertainBackoffCutoff = new Date(Date.now() - 60_000).toISOString()
	return getDb()
		.select()
		.from(reviewCases)
		.where(
			and(
				eq(reviewCases.guildId, guildId),
				eq(reviewCases.status, "escalated"),
				sql`(${reviewCases.deliveryStatus} IN ('pending', 'failed') 
					OR (${reviewCases.deliveryStatus} = 'uncertain' AND ${reviewCases.updatedAt} <= ${uncertainBackoffCutoff})
					OR (${reviewCases.deliveryStatus} = 'delivering' AND ${reviewCases.updatedAt} <= ${staleCutoff}))`
			)
		)
		.orderBy(
			sql`CASE 
				WHEN ${reviewCases.deliveryStatus} = 'pending' THEN 0 
				WHEN ${reviewCases.deliveryStatus} = 'failed' THEN 1 
				ELSE 2 
			END ASC`,
			asc(reviewCases.updatedAt)
		)
		.limit(limit)
}

export const expireWatchlistCases = async (): Promise<number> => {
	const expired = await getDb()
		.update(reviewCases)
		.set({
			status: "open",
			expiresAt: null,
			decisionReason: "Watchlist monitoring period expired; eligible for re-evaluation.",
			updatedAt: now
		})
		.where(
			and(
				eq(reviewCases.status, "watchlist"),
				sql`expires_at IS NOT NULL AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
			)
		)
		.returning()

	return expired.length
}

export const pruneOldObservations = async (
	retentionDays = 14
): Promise<number> => {
	const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
	const deleted = await getDb()
		.delete(reviewObservations)
		.where(sql`created_at < ${cutoff}`)
		.returning()

	return deleted.length
}

export const getUserObservationCount = async (
	guildId: string,
	authorId: string,
	windowDays = 7
): Promise<number> => {
	if (reviewConfig.discrawlExportUrl) {
		return fetchRemoteDiscrawlCount(
			reviewConfig.discrawlExportUrl,
			reviewConfig.discrawlSecret || "",
			guildId,
			authorId,
			windowDays
		)
	}
	if (reviewConfig.discrawlExportPath) {
		return getDiscrawlObservationCount(
			reviewConfig.discrawlExportPath,
			guildId,
			authorId,
			windowDays
		)
	}

	const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString()
	const [result] = await getDb()
		.select({ count: sql<number>`count(*)` })
		.from(reviewObservations)
		.where(
			and(
				eq(reviewObservations.guildId, guildId),
				eq(reviewObservations.authorId, authorId),
				gte(reviewObservations.createdAt, cutoff)
			)
		)

	return result?.count ?? 0
}

export const listOutOfSyncCases = async (limit = 10): Promise<ReviewCase[]> => {
	return getDb()
		.select()
		.from(reviewCases)
		.where(
			and(
				sql`review_message_id IS NOT NULL`,
				sql`synced_card_revision < card_revision`
			)
		)
		.limit(limit)
}

// Receipt recovery is read-only until a conditional receipt/backoff write.
// It deliberately does not acquire the escalation claim or authorize a POST.
export const listOutstandingReviewReceipts = async (
	guildId: string,
	limit = 10,
	claimTimeoutMs = 120_000
): Promise<ReviewCase[]> => {
	const staleCutoff = new Date(Date.now() - claimTimeoutMs).toISOString()
	const backoffCutoff = new Date(Date.now() - 60_000).toISOString()
	return getDb()
		.select()
		.from(reviewCases)
		.where(and(
			eq(reviewCases.guildId, guildId),
			sql`((${reviewCases.deliveryStatus} = 'uncertain' AND ${reviewCases.updatedAt} <= ${backoffCutoff})
				OR (${reviewCases.deliveryStatus} = 'delivering' AND ${reviewCases.updatedAt} <= ${staleCutoff}))`
		))
		.orderBy(asc(reviewCases.updatedAt), asc(reviewCases.caseId))
		.limit(limit)
}

// Compare the observed row, rather than letting a late lookup overwrite a
// newer receipt, disposition, or retry. No exclusive lease is needed for GET.
const receiptSnapshotMatches = (snapshot: ReviewCase) => and(
	eq(reviewCases.caseId, snapshot.caseId),
	eq(reviewCases.guildId, snapshot.guildId),
	eq(reviewCases.status, snapshot.status),
	eq(reviewCases.deliveryStatus, snapshot.deliveryStatus),
	eq(reviewCases.cardRevision, snapshot.cardRevision),
	eq(reviewCases.updatedAt, snapshot.updatedAt),
	sql`${reviewCases.reviewMessageId} IS ${snapshot.reviewMessageId}`,
	sql`${reviewCases.reviewChannelId} IS ${snapshot.reviewChannelId}`
)

export const attachReviewCaseReceipt = async (
	snapshot: ReviewCase,
	channelId: string,
	messageId: string
): Promise<ReviewCase | null> => {
	if (!channelId || !messageId ||
		(snapshot.reviewMessageId && snapshot.reviewMessageId !== messageId) ||
		(snapshot.reviewChannelId && snapshot.reviewChannelId !== channelId)) {
		throw new Error(`Conflicting review receipt for ${snapshot.caseId}`)
	}
	const [updated] = await getDb()
		.update(reviewCases)
		.set({
			reviewMessageId: messageId,
			reviewChannelId: channelId,
			deliveryStatus: "delivered",
			// Receipt identity is not proof that the displayed contents are current.
			cardRevision: sql`${reviewCases.cardRevision} + 1`,
			updatedAt: now
		})
		.where(receiptSnapshotMatches(snapshot))
		.returning()
	return updated ?? null
}

export const deferReviewReceiptReconciliation = async (
	snapshot: ReviewCase
): Promise<ReviewCase | null> => {
	if (!["uncertain", "delivering"].includes(snapshot.deliveryStatus)) return null
	const [updated] = await getDb()
		.update(reviewCases)
		.set({ deliveryStatus: "uncertain", updatedAt: now })
		.where(receiptSnapshotMatches(snapshot))
		.returning()
	return updated ?? null
}
