import { betaPingsConfig } from "../config/betaPings.js"

export type BetaPingsMember = {
	roles: readonly { id: string }[]
	addRole: (roleId: string, reason?: string) => Promise<void>
	removeRole: (roleId: string, reason?: string) => Promise<void>
}

export const isBetaPingsLocation = (
	guildId: string | null | undefined,
	channelId: string | null | undefined
) =>
	guildId === betaPingsConfig.guildId &&
	channelId === betaPingsConfig.channelId

export const toggleBetaPingsRole = async (
	member: BetaPingsMember
): Promise<{ enabled: boolean }> => {
	const hasRole = member.roles.some(
		(role) => role.id === betaPingsConfig.roleId
	)
	const reason = "Self-service Beta Pings toggle"

	if (hasRole) {
		await member.removeRole(betaPingsConfig.roleId, reason)
		return { enabled: false }
	}

	await member.addRole(betaPingsConfig.roleId, reason)
	return { enabled: true }
}
