import {
	getNomination,
	markNominationApproved,
	markNominationGrantPending
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { getRuntimeEnv } from "../runtime/env.js"

const discordApiBase = "https://discord.com/api/v10"

const addTargetRole = async (nomination: Nomination) => {
	const roleResponse = await fetch(
		`${discordApiBase}/guilds/${nomination.guildId}/members/${nomination.nomineeId}/roles/${nomination.targetRoleId}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`
			}
		}
	)

	return roleResponse.ok
}

type NominationRoleGrantDependencies = {
	addTargetRole: typeof addTargetRole
	markNominationApproved: typeof markNominationApproved
	markNominationGrantPending: typeof markNominationGrantPending
	getNomination: typeof getNomination
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
		...overrides
	}
	const keepPending = async (): Promise<NominationRoleGrantResult> => {
		try {
			const pendingNomination =
				await dependencies.markNominationGrantPending(nomination.id)
			return { status: "pending", nomination: pendingNomination ?? nomination }
		} catch (error) {
			console.error(
				`Failed to defer role grant retry for nomination ${nomination.id}:`,
				error
			)
			return { status: "pending", nomination }
		}
	}

	let roleAdded = false
	try {
		roleAdded = await dependencies.addTargetRole(nomination)
	} catch (error) {
		console.error(
			`Failed to add role for nomination ${nomination.id}:`,
			error
		)
	}

	if (!roleAdded) {
		return keepPending()
	}

	try {
		const approvedNomination =
			await dependencies.markNominationApproved(nomination.id)
		if (approvedNomination) {
			return { status: "approved", nomination: approvedNomination }
		}

		const latestNomination = await dependencies.getNomination(nomination.id)
		if (latestNomination?.status === "approved") {
			return { status: "approved", nomination: latestNomination }
		}
	} catch (error) {
		console.error(
			`Failed to finalize role grant for nomination ${nomination.id}:`,
			error
		)
	}

	return keepPending()
}
