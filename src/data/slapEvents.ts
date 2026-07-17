import {
	and,
	eq,
	isNull,
	or
} from "drizzle-orm"
import { getPrimaryDb } from "../db.js"
import {
	slapEvents,
	type SlapEvent
} from "../db/schema.js"
import type { SlapResult } from "../services/slapEngine.js"
import {
	actionCooldownExpiries,
	readActionCooldowns,
	type ActionCooldownKind
} from "./actionCooldowns.js"

export type SlapDatabase = ReturnType<typeof getPrimaryDb>

export type SlapCooldownKind = ActionCooldownKind

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
	const {
		actorExpiresAt,
		targetExpiresAt,
		channelExpiresAt
	} = actionCooldownExpiries(referenceDate)
	const client = database.$client
	const results = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				"select id from slap_events where interaction_id = ? limit 1"
			)
			.bind(input.interactionId),
		client
			.prepare(
				`delete from action_cooldown_events
					where interaction_id = ?
						and action_kind = 'slap'
						and actor_expires_at <= ?
						and target_expires_at <= ?
						and channel_expires_at <= ?
						and not exists (
							select 1
							from slap_events
							where interaction_id = action_cooldown_events.interaction_id
						)
						and not exists (
							select 1
							from lobster_encounters
							where cooldown_event_id = action_cooldown_events.id
						)`
			)
			.bind(input.interactionId, timestamp, timestamp, timestamp),
		client
			.prepare(
				`insert into action_cooldown_events (
						interaction_id,
						action_kind,
						guild_id,
						channel_id,
						actor_id,
						target_id,
						actor_expires_at,
						target_expires_at,
						channel_expires_at,
						created_at
					)
					select ?, 'slap', ?, ?, ?, ?, ?, ?, ?, ?
					where not exists (
						select 1
						from action_cooldown_events
						where guild_id = ?
							and actor_id = ?
							and actor_expires_at > ?
					)
						and not exists (
							select 1
							from action_cooldown_events
							where guild_id = ?
								and target_id = ?
								and target_expires_at > ?
						)
						and not exists (
							select 1
							from action_cooldown_events
							where guild_id = ?
								and channel_id = ?
								and channel_expires_at > ?
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
				actorExpiresAt,
				targetExpiresAt,
				channelExpiresAt,
				timestamp,
				input.guildId,
				input.actorId,
				timestamp,
				input.guildId,
				input.targetId,
				timestamp,
				input.guildId,
				input.channelId,
				timestamp
			),
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
					where changes() = 1
						and exists (
						select 1
						from action_cooldown_events
						where interaction_id = ?
							and action_kind = 'slap'
							and guild_id = ?
							and channel_id = ?
							and actor_id = ?
							and target_id = ?
							and actor_expires_at = ?
							and target_expires_at = ?
							and channel_expires_at = ?
							and created_at = ?
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
				input.interactionId,
				input.guildId,
				input.channelId,
				input.actorId,
				input.targetId,
				actorExpiresAt,
				targetExpiresAt,
				channelExpiresAt,
				timestamp
			),
		client
			.prepare(
				`select actor_expires_at
					from action_cooldown_events
					where guild_id = ?
						and actor_id = ?
						and actor_expires_at > ?
					order by actor_expires_at desc
					limit 1`
			)
			.bind(input.guildId, input.actorId, timestamp),
		client
			.prepare(
				`select target_expires_at
					from action_cooldown_events
					where guild_id = ?
						and target_id = ?
						and target_expires_at > ?
					order by target_expires_at desc
					limit 1`
			)
			.bind(input.guildId, input.targetId, timestamp),
		client
			.prepare(
				`select channel_expires_at
					from action_cooldown_events
					where guild_id = ?
						and channel_id = ?
						and channel_expires_at > ?
					order by channel_expires_at desc
					limit 1`
			)
			.bind(input.guildId, input.channelId, timestamp)
	])

	const existingId = results[0]?.results[0]?.id
	const createdId = results[3]?.results[0]?.id
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

	const cooldowns = readActionCooldowns([
		{ kind: "actor", expiresAt: results[4]?.results[0]?.actor_expires_at },
		{ kind: "target", expiresAt: results[5]?.results[0]?.target_expires_at },
		{ kind: "channel", expiresAt: results[6]?.results[0]?.channel_expires_at }
	], referenceDate)

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
