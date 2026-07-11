import {
	and,
	asc,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	or,
	sql
} from "drizzle-orm"
import { nominationConfig } from "../config/nominations.js"
import { getPrimaryDb } from "../db.js"
import {
	nominationApprovals,
	nominations,
	type Nomination
} from "../db/schema.js"

export type NominationDatabase = ReturnType<typeof getPrimaryDb>

export type NominationStatus =
	| "submitted"
	| "granting"
	| "approved"
	| "declined"
	| "expired"

export type NominationVoteChoice = "approve" | "decline"

export type NominationVote = {
	reviewerId: string
	choice: NominationVoteChoice
}

export type NominationVoteTotals = {
	approvals: number
	declines: number
}

export type NominationReviewState = {
	nomination: Nomination
	votes: NominationVote[]
	totals: NominationVoteTotals
}

export type NominationVoteResult =
	| { kind: "not_found" }
	| {
		kind:
			| "recorded"
			| "switched"
			| "unchanged"
			| "granting"
			| "declined"
			| "expired"
			| "closed"
		nomination: Nomination
		totals: NominationVoteTotals
		previousChoice: NominationVoteChoice | null
	}

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

const totalsFromVotes = (votes: NominationVote[]): NominationVoteTotals => ({
	approvals: votes.filter((vote) => vote.choice === "approve").length,
	declines: votes.filter((vote) => vote.choice === "decline").length
})

const normalizeVoteChoice = (choice: string): NominationVoteChoice =>
	choice === "decline" ? "decline" : "approve"

const mapNominationRow = (row: Record<string, unknown>): Nomination => ({
	id: Number(row.id),
	guildId: String(row.guild_id),
	channelId: String(row.channel_id),
	nomineeId: String(row.nominee_id),
	nominatorId: String(row.nominator_id),
	reason: String(row.reason),
	messageId: row.message_id === null ? null : String(row.message_id),
	targetRoleId: String(row.target_role_id),
	requiredApprovals: Number(row.required_approvals),
	status: String(row.status),
	expiresAt: row.expires_at === null ? null : String(row.expires_at),
	completedAt: row.completed_at === null ? null : String(row.completed_at),
	desiredCardRevision: Number(row.desired_card_revision),
	syncedCardRevision: Number(row.synced_card_revision),
	cardSyncStartedAt:
		row.card_sync_started_at === null
			? null
			: String(row.card_sync_started_at),
	cardSyncFailureCount: Number(row.card_sync_failure_count),
	grantStartedAt:
		row.grant_started_at === null ? null : String(row.grant_started_at),
	grantFailureCount: Number(row.grant_failure_count),
	createdAt: String(row.created_at),
	updatedAt: String(row.updated_at)
})

export const createNomination = async (
	input: CreateNominationInput
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
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
	const [nomination] = await getPrimaryDb()
		.select()
		.from(nominations)
		.where(eq(nominations.id, id))
		.limit(1)

	return nomination ?? null
}

export const getNominationVotes = async (
	nominationId: number
): Promise<NominationVote[]> => {
	const votes = await getPrimaryDb()
		.select({
			reviewerId: nominationApprovals.approverId,
			choice: nominationApprovals.voteChoice
		})
		.from(nominationApprovals)
		.where(eq(nominationApprovals.nominationId, nominationId))
		.orderBy(asc(nominationApprovals.createdAt), asc(nominationApprovals.id))

	return votes.map((vote) => ({
		reviewerId: vote.reviewerId,
		choice: normalizeVoteChoice(vote.choice)
	}))
}

export const getNominationVoteTotals = async (
	nominationId: number
): Promise<NominationVoteTotals> =>
	totalsFromVotes(await getNominationVotes(nominationId))

export const getNominationReviewState = async (
	nominationId: number
): Promise<NominationReviewState | null> => {
	const nomination = await getNomination(nominationId)
	if (!nomination) {
		return null
	}

	const votes = await getNominationVotes(nominationId)
	return {
		nomination,
		votes,
		totals: totalsFromVotes(votes)
	}
}

export const deleteNomination = async (nominationId: number): Promise<void> => {
	await getPrimaryDb().delete(nominations).where(eq(nominations.id, nominationId))
}

export const setNominationMessageId = async (
	nominationId: number,
	messageId: string
): Promise<void> => {
	await getPrimaryDb()
		.update(nominations)
		.set({
			messageId,
			desiredCardRevision: 1,
			syncedCardRevision: 1,
			cardSyncStartedAt: null,
			cardSyncFailureCount: 0,
			updatedAt: now
		})
		.where(eq(nominations.id, nominationId))
}

export const getActiveNominationForNominee = async (
	guildId: string,
	nomineeId: string,
	targetRoleId: string
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
		.select()
		.from(nominations)
		.where(
			and(
				eq(nominations.guildId, guildId),
				eq(nominations.nomineeId, nomineeId),
				eq(nominations.targetRoleId, targetRoleId),
				or(
					eq(nominations.status, "granting"),
					and(
						eq(nominations.status, "submitted"),
						gt(expiryDeadline, now)
					)
				)
			)
		)
		.limit(1)

	return nomination ?? null
}

export const recordNominationVote = async (
	nominationId: number,
	reviewerId: string,
	choice: NominationVoteChoice,
	referenceDate = new Date(),
	database: NominationDatabase = getPrimaryDb()
): Promise<NominationVoteResult> => {
	const transitionTime = referenceDate.toISOString()
	const mutationId = crypto.randomUUID()
	const client = database.$client
	const approvalCount = `(select count(*) from nomination_approvals votes where votes.nomination_id = nominations.id and votes.vote_choice = 'approve')`
	const declineCount = `(select count(*) from nomination_approvals votes where votes.nomination_id = nominations.id and votes.vote_choice = 'decline')`
	const results = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				"select vote_choice from nomination_approvals where nomination_id = ? and approver_id = ? limit 1"
			)
			.bind(nominationId, reviewerId),
		client
			.prepare(
				`update nominations
					set status = 'expired',
						completed_at = ?,
						desired_card_revision = desired_card_revision + 1,
						card_sync_started_at = coalesce(card_sync_started_at, ?),
						card_sync_failure_count = 0,
						updated_at = ?
					where id = ?
						and status = 'submitted'
						and coalesce(
							expires_at,
							strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ?)
						) <= ?
					returning id`
			)
			.bind(
				transitionTime,
				transitionTime,
				transitionTime,
				nominationId,
				fallbackExpirationModifier,
				transitionTime
			),
		client
			.prepare(
				`insert into nomination_approvals (
						nomination_id,
						approver_id,
						vote_choice,
						mutation_id
					)
					select ?, ?, ?, ?
					from nominations
					where id = ?
						and status = 'submitted'
						and coalesce(
							expires_at,
							strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ?)
						) > ?
					on conflict(nomination_id, approver_id) do update set
						vote_choice = excluded.vote_choice,
						mutation_id = excluded.mutation_id
					where nomination_approvals.vote_choice <> excluded.vote_choice
					returning vote_choice`
			)
			.bind(
				nominationId,
				reviewerId,
				choice,
				mutationId,
				nominationId,
				fallbackExpirationModifier,
				transitionTime
			),
		client
			.prepare(
				`update nominations
					set status = case
							when ${approvalCount} >= required_approvals then 'granting'
							when ${declineCount} >= required_approvals then 'declined'
							else status
						end,
						completed_at = case
							when ${declineCount} >= required_approvals then ?
							else completed_at
						end,
						grant_started_at = case
							when ${approvalCount} >= required_approvals
								then coalesce(grant_started_at, ?)
							else grant_started_at
						end,
						grant_failure_count = case
							when ${approvalCount} >= required_approvals then 0
							else grant_failure_count
						end,
						desired_card_revision = desired_card_revision + 1,
						card_sync_started_at = coalesce(card_sync_started_at, ?),
						card_sync_failure_count = 0,
						updated_at = ?
					where id = ?
						and status = 'submitted'
						and exists (
							select 1
							from nomination_approvals votes
							where votes.nomination_id = ?
								and votes.approver_id = ?
								and votes.mutation_id = ?
						)
					returning status`
			)
			.bind(
				transitionTime,
				transitionTime,
				transitionTime,
				transitionTime,
				nominationId,
				nominationId,
				reviewerId,
				mutationId
			),
		client
			.prepare("select * from nominations where id = ? limit 1")
			.bind(nominationId),
		client
			.prepare(
				"select approver_id, vote_choice from nomination_approvals where nomination_id = ? order by created_at, id"
			)
			.bind(nominationId)
	])

	const nominationRow = results[4]?.results[0]
	if (!nominationRow) {
		return { kind: "not_found" }
	}

	const nomination = mapNominationRow(nominationRow)
	const votes = (results[5]?.results ?? []).map((vote) => ({
		reviewerId: String(vote.approver_id),
		choice: normalizeVoteChoice(String(vote.vote_choice))
	}))
	const totals = totalsFromVotes(votes)
	const previousVote = results[0]?.results[0]
	const previousChoice = previousVote
		? normalizeVoteChoice(String(previousVote.vote_choice))
		: null
	const expiredByThisMutation = (results[1]?.results.length ?? 0) > 0
	const voteChanged = (results[2]?.results.length ?? 0) > 0

	if (expiredByThisMutation) {
		return {
			kind: "expired",
			nomination,
			totals,
			previousChoice
		}
	}

	if (!voteChanged) {
		return {
			kind:
				nomination.status === "submitted" && previousChoice === choice
					? "unchanged"
					: "closed",
			nomination,
			totals,
			previousChoice
		}
	}

	return {
		kind:
			nomination.status === "granting"
				? "granting"
				: nomination.status === "declined"
					? "declined"
					: previousChoice
						? "switched"
						: "recorded",
		nomination,
		totals,
		previousChoice
	}
}

export const markNominationApproved = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
		.update(nominations)
		.set({
			status: "approved",
			completedAt: now,
			grantStartedAt: null,
			grantFailureCount: 0,
			desiredCardRevision: sql`${nominations.desiredCardRevision} + 1`,
			cardSyncStartedAt: sql`coalesce(${nominations.cardSyncStartedAt}, ${now})`,
			cardSyncFailureCount: 0,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.status, "granting")
			)
		)
		.returning()

	return nomination ?? null
}

export const listGrantingNominations = async (
	limit = 25
): Promise<Nomination[]> =>
	getPrimaryDb()
		.select()
		.from(nominations)
		.where(eq(nominations.status, "granting"))
		.orderBy(asc(nominations.updatedAt), asc(nominations.id))
		.limit(limit)

export const markNominationGrantPending = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
		.update(nominations)
		.set({
			grantStartedAt: sql`coalesce(${nominations.grantStartedAt}, ${now})`,
			grantFailureCount: sql`${nominations.grantFailureCount} + 1`,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.status, "granting")
			)
		)
		.returning()

	return nomination ?? null
}

export const listExpiredSubmittedNominations = async (
	limit = 25
): Promise<Nomination[]> =>
	getPrimaryDb()
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

export const listStaleUnpublishedNominations = async (
	limit = 25
): Promise<Nomination[]> =>
	getPrimaryDb()
		.select()
		.from(nominations)
		.where(
			and(
				eq(nominations.status, "submitted"),
				isNull(nominations.messageId),
				lte(
					nominations.createdAt,
					sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')`
				)
			)
		)
		.orderBy(asc(nominations.createdAt), asc(nominations.id))
		.limit(limit)

export const markNominationSubmissionFailed = async (
	nominationId: number
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
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
				isNull(nominations.messageId)
			)
		)
		.returning()

	return nomination ?? null
}

export const markNominationExpired = async (
	nominationId: number,
	referenceDate = new Date(),
	database: NominationDatabase = getPrimaryDb()
): Promise<Nomination | null> => {
	const transitionTime = referenceDate.toISOString()
	const [result] = await database.$client.batch<Record<string, unknown>>([
		database.$client
			.prepare(
				`update nominations
					set status = 'expired',
						completed_at = ?,
						desired_card_revision = desired_card_revision + 1,
						card_sync_started_at = coalesce(card_sync_started_at, ?),
						card_sync_failure_count = 0,
						updated_at = ?
					where id = ?
						and status = 'submitted'
						and coalesce(
							expires_at,
							strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ?)
						) <= ?
					returning *`
			)
			.bind(
				transitionTime,
				transitionTime,
				transitionTime,
				nominationId,
				fallbackExpirationModifier,
				transitionTime
			)
	])
	const row = result?.results[0]
	return row ? mapNominationRow(row) : null
}

export const markExpiredSubmittedNominationForNominee = async (
	guildId: string,
	nomineeId: string,
	targetRoleId: string
): Promise<Nomination | null> => {
	const [nomination] = await getPrimaryDb()
		.update(nominations)
		.set({
			status: "expired",
			completedAt: now,
			desiredCardRevision: sql`${nominations.desiredCardRevision} + 1`,
			cardSyncStartedAt: sql`coalesce(${nominations.cardSyncStartedAt}, ${now})`,
			cardSyncFailureCount: 0,
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

export const listPendingNominationCardSyncs = async (
	limit = 25
): Promise<Nomination[]> =>
	getPrimaryDb()
		.select()
		.from(nominations)
		.where(
			and(
				isNotNull(nominations.messageId),
				sql`${nominations.desiredCardRevision} > ${nominations.syncedCardRevision}`
			)
		)
		.orderBy(asc(nominations.updatedAt), asc(nominations.id))
		.limit(limit)

export const markNominationCardSynced = async (
	nominationId: number,
	revision: number,
	database: NominationDatabase = getPrimaryDb()
): Promise<Nomination | null> => {
	const [nomination] = await database
		.update(nominations)
		.set({
			syncedCardRevision: revision,
			cardSyncStartedAt: null,
			cardSyncFailureCount: 0
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.desiredCardRevision, revision)
			)
		)
		.returning()

	return nomination ?? null
}

export const markNominationCardSyncFailed = async (
	nominationId: number,
	revision: number,
	database: NominationDatabase = getPrimaryDb()
): Promise<Nomination | null> => {
	const [nomination] = await database
		.update(nominations)
		.set({
			cardSyncStartedAt: sql`coalesce(${nominations.cardSyncStartedAt}, ${now})`,
			cardSyncFailureCount: sql`${nominations.cardSyncFailureCount} + 1`,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				eq(nominations.desiredCardRevision, revision)
			)
		)
		.returning()

	return nomination ?? null
}

export const markNominationCardStaleWrite = async (
	nominationId: number,
	renderedRevision: number,
	database: NominationDatabase = getPrimaryDb()
): Promise<Nomination | null> => {
	const [nomination] = await database
		.update(nominations)
		.set({
			desiredCardRevision: sql`${nominations.desiredCardRevision} + 1`,
			cardSyncStartedAt: sql`coalesce(${nominations.cardSyncStartedAt}, ${now})`,
			cardSyncFailureCount: 0,
			updatedAt: now
		})
		.where(
			and(
				eq(nominations.id, nominationId),
				gt(nominations.desiredCardRevision, renderedRevision)
			)
		)
		.returning()

	return nomination ?? null
}
