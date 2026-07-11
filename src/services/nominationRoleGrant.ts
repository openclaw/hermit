import {
	getNomination,
	getNominationVoteTotals,
	markNominationApproved,
	markNominationGrantPending
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { getRuntimeEnv } from "../runtime/env.js"
import {
	getDiscordErrorStatus,
	logNominationOperation
} from "./nominationObservability.js"

const discordApiBase = "https://discord.com/api/v10"

type DiscordRoleResult = {
	ok: boolean
	status: number | string
}

const addTargetRole = async (
	nomination: Nomination
): Promise<DiscordRoleResult> => {
	const roleResponse = await fetch(
		`${discordApiBase}/guilds/${nomination.guildId}/members/${nomination.nomineeId}/roles/${nomination.targetRoleId}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`
			}
		}
	)

	return {
		ok: roleResponse.ok,
		status: roleResponse.status
	}
}

type NominationRoleGrantDependencies = {
	addTargetRole: typeof addTargetRole
	markNominationApproved: typeof markNominationApproved
	markNominationGrantPending: typeof markNominationGrantPending
	getNomination: typeof getNomination
	getNominationVoteTotals: typeof getNominationVoteTotals
	logNominationOperation: typeof logNominationOperation
}

export type NominationRoleGrantResult =
	| { status: "approved"; nomination: Nomination }
	| { status: "pending"; nomination: Nomination }

export const processNominationRoleGrant = async (
	nomination: Nomination,
	overrides: Partial<NominationRoleGrantDependencies> = {}
): Promise<NominationRoleGrantResult> => {
	const dependencies: NominationRoleGrantDependencies = {
		addTargetRole,
		markNominationApproved,
		markNominationGrantPending,
		getNomination,
		getNominationVoteTotals,
		logNominationOperation,
		...overrides
	}
	const totals = await dependencies
		.getNominationVoteTotals(nomination.id)
		.catch(() => ({ approvals: 0, declines: 0 }))
	const keepPending = async (
		discordResponseStatus: number | string
	): Promise<NominationRoleGrantResult> => {
		try {
			const pendingNomination =
				await dependencies.markNominationGrantPending(nomination.id)
			if (!pendingNomination) {
				const latestNomination =
					await dependencies.getNomination(nomination.id)
				if (latestNomination?.status === "approved") {
					dependencies.logNominationOperation({
						operation: "role_grant",
						nomination: latestNomination,
						totals,
						previousStatus: nomination.status,
						discordResponseStatus
					})
					return { status: "approved", nomination: latestNomination }
				}
			}
			const currentNomination = pendingNomination ?? nomination
			dependencies.logNominationOperation({
				operation: "role_grant",
				nomination: currentNomination,
				totals,
				previousStatus: nomination.status,
				discordResponseStatus,
				failed: true
			})
			return { status: "pending", nomination: currentNomination }
		} catch (error) {
			console.error(
				`Failed to defer role grant retry for nomination ${nomination.id}:`,
				error
			)
			dependencies.logNominationOperation({
				operation: "role_grant",
				nomination,
				totals,
				previousStatus: nomination.status,
				discordResponseStatus,
				failed: true
			})
			return { status: "pending", nomination }
		}
	}

	let roleResult: DiscordRoleResult
	try {
		roleResult = await dependencies.addTargetRole(nomination)
	} catch (error) {
		return keepPending(getDiscordErrorStatus(error))
	}

	if (!roleResult.ok) {
		return keepPending(roleResult.status)
	}

	try {
		const approvedNomination =
			await dependencies.markNominationApproved(nomination.id)
		if (approvedNomination) {
			dependencies.logNominationOperation({
				operation: "role_grant",
				nomination: approvedNomination,
				totals,
				previousStatus: nomination.status,
				discordResponseStatus: roleResult.status
			})
			return { status: "approved", nomination: approvedNomination }
		}

		const latestNomination = await dependencies.getNomination(nomination.id)
		if (latestNomination?.status === "approved") {
			dependencies.logNominationOperation({
				operation: "role_grant",
				nomination: latestNomination,
				totals,
				previousStatus: nomination.status,
				discordResponseStatus: roleResult.status
			})
			return { status: "approved", nomination: latestNomination }
		}
	} catch (error) {
		console.error(
			`Failed to finalize role grant for nomination ${nomination.id}:`,
			error
		)
	}

	return keepPending(roleResult.status)
}
