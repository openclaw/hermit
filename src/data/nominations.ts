import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "../db.js"
import {
	nominationApprovals,
	nominations,
	type Nomination
} from "../db/schema.js"

export type NominationStatus = "submitted" | "approved"

type CreateNominationInput = {
	guildId: string
	channelId: string
	nomineeId: string
	nominatorId: string
	reason: string
	targetRoleId: string
	requiredApprovals: number
}

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

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
				eq(nominations.status, "submitted")
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
				eq(nominations.status, "submitted")
			)
		)
		.returning()

	return nomination ?? null
}
