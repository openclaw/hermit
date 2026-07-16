import {
	and,
	eq,
	isNull,
	or
} from "drizzle-orm"
import { slapConfig } from "../config/slap.js"
import { getPrimaryDb } from "../db.js"
import {
	slapEvents,
	type SlapEvent
} from "../db/schema.js"
import type { SlapResult } from "../services/slapEngine.js"

export type SlapDatabase = ReturnType<typeof getPrimaryDb>

export type SlapCooldownKind = "actor" | "target" | "channel"

export type CreateSlapEventResult =
	| { kind: "created" | "existing"; event: SlapEvent }
	| {
		kind: "cooldown"
		cooldowns: Array<{
			kind: SlapCooldownKind
			remainingSeconds: number
		}>
	}

type CreateSlapEventInput = {
	interactionId: string
	guildId: string
	channelId: string
	actorId: string
	targetId: string
	targetIsBot: boolean
	result: SlapResult
}

const cooldownThreshold = (referenceDate: Date, seconds: number) =>
	new Date(referenceDate.getTime() - seconds * 1000).toISOString()

const remainingCooldownSeconds = (
	createdAt: string,
	cooldownSeconds: number,
	referenceDate: Date
) =>
	Math.max(
		1,
		Math.ceil(
			(new Date(createdAt).getTime() +
				cooldownSeconds * 1000 -
				referenceDate.getTime()) /
				1000
		)
	)

export const getSlapEvent = async (
	id: number,
	database: SlapDatabase = getPrimaryDb()
): Promise<SlapEvent | null> => {
	const [event] = await database
		.select()
		.from(slapEvents)
		.where(eq(slapEvents.id, id))
		.limit(1)

	return event ?? null
}

export const getSlapEventByInteractionId = async (
	interactionId: string,
	database: SlapDatabase = getPrimaryDb()
): Promise<SlapEvent | null> => {
	const [event] = await database
		.select()
		.from(slapEvents)
		.where(eq(slapEvents.interactionId, interactionId))
		.limit(1)

	return event ?? null
}

export const createSlapEvent = async (
	input: CreateSlapEventInput,
	referenceDate = new Date(),
	database: SlapDatabase = getPrimaryDb()
): Promise<CreateSlapEventResult> => {
	const timestamp = referenceDate.toISOString()
	const actorThreshold = cooldownThreshold(
		referenceDate,
		slapConfig.cooldowns.actorSeconds
	)
	const targetThreshold = cooldownThreshold(
		referenceDate,
		slapConfig.cooldowns.targetSeconds
	)
	const channelThreshold = cooldownThreshold(
		referenceDate,
		slapConfig.cooldowns.channelSeconds
	)
	const client = database.$client
	const results = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				"select id from slap_events where interaction_id = ? limit 1"
			)
			.bind(input.interactionId),
		client
			.prepare(
				`insert into slap_events (
						interaction_id,
						guild_id,
						channel_id,
						actor_id,
						target_id,
						target_is_bot,
						fish_slug,
						fish_name,
						rarity,
						outcome,
						headline,
						narrative,
						impact,
						dignity_remaining,
						fish_condition,
						image_url,
						created_at,
						updated_at
					)
					select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
					where not exists (
						select 1
						from slap_events
						where guild_id = ?
							and actor_id = ?
							and created_at > ?
					)
						and not exists (
							select 1
							from slap_events
							where guild_id = ?
								and target_id = ?
								and created_at > ?
						)
						and not exists (
							select 1
							from slap_events
							where guild_id = ?
								and channel_id = ?
								and created_at > ?
						)
					on conflict(interaction_id) do nothing
					returning id`
			)
			.bind(
				input.interactionId,
				input.guildId,
				input.channelId,
				input.actorId,
				input.targetId,
				input.targetIsBot ? 1 : 0,
				input.result.fishSlug,
				input.result.fishName,
				input.result.rarity,
				input.result.outcome,
				input.result.headline,
				input.result.narrative,
				input.result.impact,
				input.result.dignityRemaining,
				input.result.fishCondition,
				input.result.imageUrl,
				timestamp,
				timestamp,
				input.guildId,
				input.actorId,
				actorThreshold,
				input.guildId,
				input.targetId,
				targetThreshold,
				input.guildId,
				input.channelId,
				channelThreshold
			),
		client
			.prepare(
				`select created_at
					from slap_events
					where guild_id = ?
						and actor_id = ?
						and created_at > ?
					order by created_at desc
					limit 1`
			)
			.bind(input.guildId, input.actorId, actorThreshold),
		client
			.prepare(
				`select created_at
					from slap_events
					where guild_id = ?
						and target_id = ?
						and created_at > ?
					order by created_at desc
					limit 1`
			)
			.bind(input.guildId, input.targetId, targetThreshold),
		client
			.prepare(
				`select created_at
					from slap_events
					where guild_id = ?
						and channel_id = ?
						and created_at > ?
					order by created_at desc
					limit 1`
			)
			.bind(input.guildId, input.channelId, channelThreshold)
	])

	const existingId = results[0]?.results[0]?.id
	const createdId = results[1]?.results[0]?.id
	const eventId = Number(existingId ?? createdId)
	if (Number.isInteger(eventId) && eventId > 0) {
		const event = await getSlapEvent(eventId, database)
		if (!event) {
			throw new Error(`Slap event ${eventId} disappeared after creation`)
		}
		return {
			kind: existingId === undefined ? "created" : "existing",
			event
		}
	}

	const concurrentEvent = await getSlapEventByInteractionId(
		input.interactionId,
		database
	)
	if (concurrentEvent) {
		return { kind: "existing", event: concurrentEvent }
	}

	const cooldownRows = [
		{
			kind: "actor" as const,
			row: results[2]?.results[0],
			seconds: slapConfig.cooldowns.actorSeconds
		},
		{
			kind: "target" as const,
			row: results[3]?.results[0],
			seconds: slapConfig.cooldowns.targetSeconds
		},
		{
			kind: "channel" as const,
			row: results[4]?.results[0],
			seconds: slapConfig.cooldowns.channelSeconds
		}
	]
	const cooldowns = cooldownRows.flatMap(({ kind, row, seconds }) => {
		const createdAt = row?.created_at
		return typeof createdAt === "string"
			? [{
				kind,
				remainingSeconds: remainingCooldownSeconds(
					createdAt,
					seconds,
					referenceDate
				)
			}]
			: []
	})

	if (cooldowns.length === 0) {
		throw new Error("Slap event was neither created nor blocked by a cooldown")
	}
	return { kind: "cooldown", cooldowns }
}

export const bindSlapMessage = async (
	eventId: number,
	messageId: string,
	referenceDate = new Date(),
	database: SlapDatabase = getPrimaryDb()
): Promise<SlapEvent | null> => {
	await database
		.update(slapEvents)
		.set({
			messageId,
			updatedAt: referenceDate.toISOString()
		})
		.where(
			and(
				eq(slapEvents.id, eventId),
				or(isNull(slapEvents.messageId), eq(slapEvents.messageId, messageId))
			)
		)

	return getSlapEvent(eventId, database)
}

export const recordSlapCounter = async (
	eventId: number,
	actorId: string,
	targetId: string,
	result: SlapResult,
	referenceDate = new Date(),
	database: SlapDatabase = getPrimaryDb()
): Promise<{ kind: "recorded" | "already_recorded"; event: SlapEvent } | null> => {
	const [updated] = await database
		.update(slapEvents)
		.set({
			counterActorId: actorId,
			counterTargetId: targetId,
			counterFishSlug: result.fishSlug,
			counterFishName: result.fishName,
			counterRarity: result.rarity,
			counterOutcome: result.outcome,
			counterHeadline: result.headline,
			counterNarrative: result.narrative,
			counterImpact: result.impact,
			counterDignityRemaining: result.dignityRemaining,
			counterFishCondition: result.fishCondition,
			counterImageUrl: result.imageUrl,
			counteredAt: referenceDate.toISOString(),
			updatedAt: referenceDate.toISOString()
		})
		.where(
			and(
				eq(slapEvents.id, eventId),
				isNull(slapEvents.counteredAt)
			)
		)
		.returning({ id: slapEvents.id })

	const event = await getSlapEvent(eventId, database)
	if (!event) {
		return null
	}
	return {
		kind: updated ? "recorded" : "already_recorded",
		event
	}
}

export const recordSlapAppeal = async (
	eventId: number,
	userId: string,
	ruling: string,
	referenceDate = new Date(),
	database: SlapDatabase = getPrimaryDb()
): Promise<{ kind: "recorded" | "already_recorded"; event: SlapEvent } | null> => {
	const [updated] = await database
		.update(slapEvents)
		.set({
			appealedById: userId,
			appealRuling: ruling,
			appealedAt: referenceDate.toISOString(),
			updatedAt: referenceDate.toISOString()
		})
		.where(
			and(
				eq(slapEvents.id, eventId),
				isNull(slapEvents.appealedAt)
			)
		)
		.returning({ id: slapEvents.id })

	const event = await getSlapEvent(eventId, database)
	if (!event) {
		return null
	}
	return {
		kind: updated ? "recorded" : "already_recorded",
		event
	}
}
