import { and, eq, sql } from "drizzle-orm"
import { getDb } from "../db.js"
import { claimRequests, type ClaimRequest } from "../db/schema.js"

export type ClaimRequestStatus =
	| "submitting"
	| "submitted"
	| "accepted"
	| "rejected"

type CreateClaimRequestInput = {
	userId: string
	guildId: string
	githubUsername: string
	mergedPrCount: number
}

type ClaimRequestReviewInput = {
	reviewMessageId: string
	reviewThreadId?: string | null
}

type ClaimRequestDecisionInput = {
	userId: string
	guildId: string
	status: Extract<ClaimRequestStatus, "accepted" | "rejected">
	decidedById?: string | null
	decisionReason?: string | null
}

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

export const getClaimRequest = async (
	userId: string,
	guildId: string
): Promise<ClaimRequest | null> => {
	const [claimRequest] = await getDb()
		.select()
		.from(claimRequests)
		.where(
			and(eq(claimRequests.userId, userId), eq(claimRequests.guildId, guildId))
		)
		.limit(1)

	return claimRequest ?? null
}

export const createClaimRequest = async ({
	userId,
	guildId,
	githubUsername,
	mergedPrCount
}: CreateClaimRequestInput): Promise<
	| { created: true; claimRequest: ClaimRequest }
	| { created: false; claimRequest: ClaimRequest | null }
> => {
	const [claimRequest] = await getDb()
		.insert(claimRequests)
		.values({
			userId,
			guildId,
			status: "submitting",
			githubUsername,
			mergedPrCount
		})
		.onConflictDoNothing({
			target: [claimRequests.guildId, claimRequests.userId]
		})
		.returning()

	if (claimRequest) {
		return { created: true, claimRequest }
	}

	return {
		created: false,
		claimRequest: await getClaimRequest(userId, guildId)
	}
}

export const markClaimRequestSubmitted = async (
	id: number,
	{ reviewMessageId, reviewThreadId }: ClaimRequestReviewInput
) => {
	await getDb()
		.update(claimRequests)
		.set({
			status: "submitted",
			reviewMessageId,
			reviewThreadId,
			updatedAt: now
		})
		.where(eq(claimRequests.id, id))
}

export const deleteClaimRequest = async (id: number) => {
	await getDb().delete(claimRequests).where(eq(claimRequests.id, id))
}

export const recordClaimDecision = async ({
	userId,
	guildId,
	status,
	decidedById,
	decisionReason
}: ClaimRequestDecisionInput) => {
	await getDb()
		.insert(claimRequests)
		.values({
			userId,
			guildId,
			status,
			decidedAt: now,
			decidedById: decidedById ?? null,
			decisionReason: decisionReason ?? null
		})
		.onConflictDoUpdate({
			target: [claimRequests.guildId, claimRequests.userId],
			set: {
				status,
				decidedAt: now,
				decidedById: decidedById ?? null,
				decisionReason: decisionReason ?? null,
				updatedAt: now
			}
		})
}
