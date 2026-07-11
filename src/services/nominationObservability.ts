import type { Nomination } from "../db/schema.js"
import type { NominationVoteTotals } from "../data/nominations.js"

type NominationOperation = "vote" | "role_grant" | "card_sync"

type NominationLogInput = {
	operation: NominationOperation
	nomination: Nomination
	totals: NominationVoteTotals
	previousStatus?: string
	discordResponseStatus?: number | string | null
	failed?: boolean
}

const pendingDurationMinutes = (startedAt: string | null) => {
	if (!startedAt) {
		return 0
	}

	const startedAtTime = Date.parse(startedAt)
	if (Number.isNaN(startedAtTime)) {
		return 0
	}

	return Math.max(0, Math.floor((Date.now() - startedAtTime) / 60_000))
}

export const getDiscordErrorStatus = (error: unknown): number | string => {
	if (!error || typeof error !== "object") {
		return "unknown"
	}

	const record = error as Record<string, unknown>
	for (const key of ["status", "statusCode", "code"]) {
		const value = record[key]
		if (typeof value === "number" || typeof value === "string") {
			return value
		}
	}

	return "unknown"
}

export const logNominationOperation = ({
	operation,
	nomination,
	totals,
	previousStatus,
	discordResponseStatus = null,
	failed = false
}: NominationLogInput) => {
	const isRoleGrant = operation === "role_grant"
	const retryCount = isRoleGrant
		? nomination.grantFailureCount
		: operation === "card_sync"
			? nomination.cardSyncFailureCount
			: 0
	const pendingMinutes = pendingDurationMinutes(
		isRoleGrant
			? nomination.grantStartedAt
			: operation === "card_sync"
				? nomination.cardSyncStartedAt
				: null
	)
	const payload = {
		event: "shell_society_nomination",
		operation,
		nominationId: nomination.id,
		stateTransition: `${previousStatus ?? nomination.status}->${nomination.status}`,
		approvalCount: totals.approvals,
		declineCount: totals.declines,
		consecutiveRetryCount: retryCount,
		pendingDurationMinutes: pendingMinutes,
		discordResponseStatus,
		desiredCardRevision: nomination.desiredCardRevision,
		synchronizedCardRevision: nomination.syncedCardRevision
	}
	const requiresEscalation =
		failed ||
		retryCount >= 3 ||
		pendingMinutes >= 30 ||
		discordResponseStatus === 404
	const message = JSON.stringify(payload)

	if (requiresEscalation) {
		console.error(message)
		return
	}

	console.log(message)
}
