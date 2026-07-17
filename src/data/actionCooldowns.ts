export const actionCooldownDurations = {
	actorSeconds: 30,
	targetSeconds: 90,
	channelSeconds: 12
} as const

export type ActionKind = "slap" | "lobster"
export type ActionCooldownKind = "actor" | "target" | "channel"

export type ActionCooldown = {
	kind: ActionCooldownKind
	remainingSeconds: number
}

export const actionCooldownExpiries = (referenceDate: Date) => ({
	actorExpiresAt: new Date(
		referenceDate.getTime() + actionCooldownDurations.actorSeconds * 1000
	).toISOString(),
	targetExpiresAt: new Date(
		referenceDate.getTime() + actionCooldownDurations.targetSeconds * 1000
	).toISOString(),
	channelExpiresAt: new Date(
		referenceDate.getTime() + actionCooldownDurations.channelSeconds * 1000
	).toISOString()
})

const remainingSeconds = (expiresAt: string, referenceDate: Date) =>
	Math.max(
		1,
		Math.ceil(
			(new Date(expiresAt).getTime() - referenceDate.getTime()) / 1000
		)
	)

export const readActionCooldowns = (
	rows: Array<{
		kind: ActionCooldownKind
		expiresAt: unknown
	}>,
	referenceDate: Date
): ActionCooldown[] =>
	rows.flatMap(({ kind, expiresAt }) =>
		typeof expiresAt === "string"
			? [{ kind, remainingSeconds: remainingSeconds(expiresAt, referenceDate) }]
			: []
	)
