import { and, asc, eq, gt, lte, sql } from "drizzle-orm"
import { nominationConfig } from "../config/nominations.js"
import { getDb } from "../db.js"
import {
	nominationApprovals,
	nominations,
	type Nomination
} from "../db/schema.js"

export type NominationStatus = "submitted" | "approved" | "expired"

type CreateNominationInput = {
	guildId: string
	channelId: string
	nomineeId: string
	nominatorId: string
	reason: string
	expiresAt: string
	targetRoleId: string
	requiredApprovals: number
}

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const fallbackExpirationModifier = `+${nominationConfig.expirationHours} hours`
const expiryDeadline = sql<string>`coalesce(
	${nominations.expiresAt},
	strftime('%Y-%m-%dT%H:%M:%fZ', ${nominations.createdAt}, ${fallbackExpirationModifier})
)`

const getNominationExpiryTime = (nomination: Nomination) => {
	if (nomination.expiresAt) {
		return Date.parse(nomination.expiresAt)
	}

	const createdAtTime = Date.parse(nomination.createdAt)
	if (Number.isNaN(createdAtTime)) {
		return Number.POSITIVE_INFINITY
	}

	return createdAtTime + nominationConfig.expirationHours * 60 * 60 * 1000
}

export const createNomination = async (
	input: CreateNominationInput
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.insert(nominations)
		.values({
			...input,
			status: "submitted"
		})
		.onConflictDoNothing()
		.returning()

	return nomination ?? null
}

export const getNomination = async (id: number): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.select()
		.from(nominations)
		.where(eq(nominations.id, id))
		.limit(1)

	return nomination ?? null
}

export const deleteNomination = async (nominationId: number): Promise<void> => {
	await getDb().delete(nominations).where(eq(nominations.id, nominationId))
}

export const setNominationMessageId = async (
	nominationId: number,
	messageId: string
): Promise<void> => {
	await getDb()
		.update(nominations)
		.set({
			messageId,
			updatedAt: now
		})
		.where(eq(nominations.id, nominationId))
}

export const isNominationExpired = (
	nomination: Nomination,
	referenceDate = new Date()
) =>
	nomination.status === "expired" ||
	(nomination.status === "submitted" &&
		getNominationExpiryTime(nomination) <= referenceDate.getTime())

export const getActiveNominationForNominee = async (
	guildId: string,
	nomineeId: string,
	targetRoleId: string
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.select()
		.from(nominations)
		.where(
			and(
				eq(nominations.guildId, guildId),
				eq(nominations.nomineeId, nomineeId),
				eq(nominations.targetRoleId, targetRoleId),
				eq(nominations.status, "submitted"),
				gt(expiryDeadline, now)
			)
		)
		.limit(1)

	return nomination ?? null
}

export const recordNominationApproval = async (
	nominationId: number,
	approverId: string
): Promise<boolean> => {
	const [approval] = await getDb()
		.insert(nominationApprovals)
		.values({
			nominationId,
			approverId
		})
		.onConflictDoNothing({
			target: [nominationApprovals.nominationId, nominationApprovals.approverId]
		})
		.returning()

	return Boolean(approval)
}

export const getNominationApproverIds = async (
	nominationId: number
): Promise<string[]> => {
	const approvals = await getDb()
		.select({ approverId: nominationApprovals.approverId })
		.from(nominationApprovals)
		.where(eq(nominationApprovals.nominationId, nominationId))
		.orderBy(asc(nominationApprovals.createdAt), asc(nominationApprovals.id))

	return approvals.map((approval) => approval.approverId)
}

export const markNominationApproved = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.update(nominations)
		.set({
			status: "approved",
			completedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.status, "submitted"),
				gt(expiryDeadline, now)
			)
		)
		.returning()

	return nomination ?? null
}

export const restoreApprovedNominationToSubmitted = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.update(nominations)
		.set({
			status: "submitted",
			completedAt: null,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.status, "approved")
			)
		)
		.returning()

	return nomination ?? null
}

export const listExpiredSubmittedNominations = async (
	limit = 25
): Promise<Nomination[]> =>
	getDb()
		.select()
		.from(nominations)
		.where(
			and(
				eq(nominations.status, "submitted"),
				lte(expiryDeadline, now)
			)
		)
		.orderBy(asc(expiryDeadline), asc(nominations.id))
		.limit(limit)

export const markNominationExpired = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.update(nominations)
		.set({
			status: "expired",
			completedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.status, "submitted"),
				lte(expiryDeadline, now)
			)
		)
		.returning()

	return nomination ?? null
}

export const markExpiredSubmittedNominationForNominee = async (
	guildId: string,
	nomineeId: string,
	targetRoleId: string
): Promise<Nomination | null> => {
	const [nomination] = await getDb()
		.update(nominations)
		.set({
			status: "expired",
			completedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.guildId, guildId),
				eq(nominations.nomineeId, nomineeId),
				eq(nominations.targetRoleId, targetRoleId),
				eq(nominations.status, "submitted"),
				lte(expiryDeadline, now)
			)
		)
		.returning()

	return nomination ?? null
}
