import { eq } from "drizzle-orm"
import { getPrimaryDb } from "../db.js"
import {
	lobsterEncounters,
	type LobsterEncounter
} from "../db/schema.js"
import {
	actionCooldownExpiries,
	readActionCooldowns,
	type ActionCooldown
} from "./actionCooldowns.js"

export type LobsterDatabase = ReturnType<typeof getPrimaryDb>

export type LobsterCounterEvent = {
	actorId: string
	targetId: string
	sceneId: string
	assetUrl: string
	assetChecksum: string
	headline: string
	narrative: string
	metrics: unknown
	accessibilityDescription: string
}

export type CreateLobsterEncounterInput = {
	interactionId: string
	guildId: string
	channelId: string
	actorId: string
	targetId: string
	targetIsBot: boolean
	taxonomySnapshotId: string
	speciesAphiaId: number
	speciesAcceptedName: string
	speciesDisplayName: string
	speciesFamily: string
	sceneId: string
	assetUrl: string
	assetChecksum: string
	headline: string
	narrative: string
	metrics: unknown
	accessibilityDescription: string
}

export type CreateLobsterEncounterResult =
	| { kind: "created" | "existing"; encounter: LobsterEncounter }
	| { kind: "publication_failed"; encounter: LobsterEncounter }
	| { kind: "cooldown"; cooldowns: ActionCooldown[] }

type LobsterResponseContext = {
	encounterId: number
	guildId: string
	channelId: string
	messageId: string
	responderId: string
	responderIsBot: boolean
	responseResult: unknown
}

export type LobsterResponseInput = LobsterResponseContext & (
	| {
		responseType: "return_to_sender"
		counterEvent: LobsterCounterEvent
	}
	| {
		responseType: "offer_butter"
		counterEvent?: never
	}
)

export type LobsterResponseResult =
	| {
		kind: "recorded" | "already_recorded"
		encounter: LobsterEncounter
	}
	| { kind: "unauthorized"; encounter: LobsterEncounter }
	| { kind: "not_found" }

const toJson = (value: unknown) => {
	const serialized = JSON.stringify(value)
	if (serialized === undefined) {
		throw new Error("Encounter JSON fields must be serializable")
	}
	return serialized
}

export const getLobsterEncounter = async (
	id: number,
	database: LobsterDatabase = getPrimaryDb()
): Promise<LobsterEncounter | null> => {
	const [encounter] = await database
		.select()
		.from(lobsterEncounters)
		.where(eq(lobsterEncounters.id, id))
		.limit(1)

	return encounter ?? null
}

export const getLobsterEncounterByInteractionId = async (
	interactionId: string,
	database: LobsterDatabase = getPrimaryDb()
): Promise<LobsterEncounter | null> => {
	const [encounter] = await database
		.select()
		.from(lobsterEncounters)
		.where(eq(lobsterEncounters.interactionId, interactionId))
		.limit(1)

	return encounter ?? null
}

const existingResult = (
	encounter: LobsterEncounter
): CreateLobsterEncounterResult =>
	encounter.publicationStatus === "publication_failed"
		? { kind: "publication_failed", encounter }
		: { kind: "existing", encounter }

export const createLobsterEncounter = async (
	input: CreateLobsterEncounterInput,
	referenceDate = new Date(),
	database: LobsterDatabase = getPrimaryDb()
): Promise<CreateLobsterEncounterResult> => {
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
				"select id, publication_status from lobster_encounters where interaction_id = ? limit 1"
			)
			.bind(input.interactionId),
		client
			.prepare(
				`delete from action_cooldown_events
					where interaction_id = ?
						and action_kind = 'lobster'
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
					select ?, 'lobster', ?, ?, ?, ?, ?, ?, ?, ?
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
						and not exists (
							select 1
							from lobster_encounters
							where interaction_id = ?
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
				timestamp,
				input.interactionId
			),
		client
			.prepare(
				`insert into lobster_encounters (
						interaction_id,
						cooldown_event_id,
						guild_id,
						channel_id,
						actor_id,
						target_id,
						target_is_bot,
						taxonomy_snapshot_id,
						species_aphia_id,
						species_accepted_name,
						species_display_name,
						species_family,
						scene_id,
						asset_url,
						asset_checksum,
						headline,
						narrative,
						metrics_json,
						accessibility_description,
						publication_status,
						response_status,
						created_at,
						updated_at
					)
					select ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
						'pending', 'pending', ?, ?
					from action_cooldown_events
					where changes() = 1
						and interaction_id = ?
						and action_kind = 'lobster'
						and guild_id = ?
						and channel_id = ?
						and actor_id = ?
						and target_id = ?
						and actor_expires_at = ?
						and target_expires_at = ?
						and channel_expires_at = ?
						and created_at = ?
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
				input.taxonomySnapshotId,
				input.speciesAphiaId,
				input.speciesAcceptedName,
				input.speciesDisplayName,
				input.speciesFamily,
				input.sceneId,
				input.assetUrl,
				input.assetChecksum,
				input.headline,
				input.narrative,
				toJson(input.metrics),
				input.accessibilityDescription,
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

	const existingId = Number(results[0]?.results[0]?.id)
	if (Number.isInteger(existingId) && existingId > 0) {
		const encounter = await getLobsterEncounter(existingId, database)
		if (!encounter) {
			throw new Error(`Lobster encounter ${existingId} disappeared during retry`)
		}
		return existingResult(encounter)
	}

	const createdId = Number(results[3]?.results[0]?.id)
	if (Number.isInteger(createdId) && createdId > 0) {
		const encounter = await getLobsterEncounter(createdId, database)
		if (!encounter) {
			throw new Error(`Lobster encounter ${createdId} disappeared after creation`)
		}
		return { kind: "created", encounter }
	}

	const concurrentEncounter = await getLobsterEncounterByInteractionId(
		input.interactionId,
		database
	)
	if (concurrentEncounter) {
		return existingResult(concurrentEncounter)
	}

	const cooldowns = readActionCooldowns([
		{ kind: "actor", expiresAt: results[4]?.results[0]?.actor_expires_at },
		{ kind: "target", expiresAt: results[5]?.results[0]?.target_expires_at },
		{ kind: "channel", expiresAt: results[6]?.results[0]?.channel_expires_at }
	], referenceDate)
	if (cooldowns.length === 0) {
		throw new Error(
			"Lobster encounter was neither created nor blocked by a cooldown"
		)
	}
	return { kind: "cooldown", cooldowns }
}

export const bindLobsterMessage = async (
	encounterId: number,
	guildId: string,
	channelId: string,
	messageId: string,
	referenceDate = new Date(),
	database: LobsterDatabase = getPrimaryDb()
): Promise<{
	kind: "bound" | "already_bound" | "conflict" | "not_found"
	encounter?: LobsterEncounter
}> => {
	const timestamp = referenceDate.toISOString()
	const client = database.$client
	const results = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				`select guild_id, channel_id, message_id, publication_status
					from lobster_encounters
					where id = ?
					limit 1`
			)
			.bind(encounterId),
		client
			.prepare(
				`update lobster_encounters
					set message_id = ?,
						message_bound_at = coalesce(message_bound_at, ?),
						publication_status = 'published',
						updated_at = ?
					where id = ?
						and guild_id = ?
						and channel_id = ?
						and publication_status in ('pending', 'published')
						and (message_id is null or message_id = ?)
					returning id`
			)
			.bind(
				messageId,
				timestamp,
				timestamp,
				encounterId,
				guildId,
				channelId,
				messageId
			)
	])
	const encounter = await getLobsterEncounter(encounterId, database)
	const previous = results[0]?.results[0]
	if (!encounter || !previous) {
		return { kind: "not_found" }
	}
	if (
		previous.guild_id !== guildId ||
		previous.channel_id !== channelId ||
		previous.publication_status === "publication_failed" ||
		(
			typeof previous.message_id === "string" &&
			previous.message_id !== messageId
		)
	) {
		return { kind: "conflict", encounter }
	}
	return {
		kind:
			previous.message_id === messageId
				? "already_bound"
				: results[1]?.results[0]
					? "bound"
					: "conflict",
		encounter
	}
}

export const markLobsterPublicationFailed = async (
	encounterId: number,
	failure: string,
	referenceDate = new Date(),
	database: LobsterDatabase = getPrimaryDb()
): Promise<{
	kind: "marked_failed" | "already_failed" | "not_pending" | "not_found"
	encounter?: LobsterEncounter
}> => {
	const timestamp = referenceDate.toISOString()
	const client = database.$client
	const results = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				`update lobster_encounters
					set publication_status = 'publication_failed',
						publication_failure = ?,
						publication_failed_at = ?,
						updated_at = ?
					where id = ?
						and publication_status = 'pending'
						and message_id is null
					returning interaction_id`
			)
			.bind(failure, timestamp, timestamp, encounterId),
		client
			.prepare(
				`delete from action_cooldown_events
					where action_kind = 'lobster'
						and interaction_id = (
							select interaction_id
							from lobster_encounters
							where id = ?
								and publication_status = 'publication_failed'
								and message_id is null
						)`
			)
			.bind(encounterId)
	])
	const encounter = await getLobsterEncounter(encounterId, database)
	if (!encounter) {
		return { kind: "not_found" }
	}
	if (results[0]?.results[0]) {
		return { kind: "marked_failed", encounter }
	}
	return {
		kind:
			encounter.publicationStatus === "publication_failed"
				? "already_failed"
				: "not_pending",
		encounter
	}
}

export const recordLobsterResponse = async (
	input: LobsterResponseInput,
	referenceDate = new Date(),
	database: LobsterDatabase = getPrimaryDb()
): Promise<LobsterResponseResult> => {
	const timestamp = referenceDate.toISOString()
	const counter =
		input.responseType === "return_to_sender"
			? input.counterEvent
			: undefined
	const client = database.$client
	const [updateResult] = await client.batch<Record<string, unknown>>([
		client
			.prepare(
				`update lobster_encounters
					set response_status = 'responded',
						response_type = ?,
						response_actor_id = ?,
						responded_at = ?,
						response_result_json = ?,
						counter_actor_id = ?,
						counter_target_id = ?,
						counter_scene_id = ?,
						counter_asset_url = ?,
						counter_asset_checksum = ?,
						counter_headline = ?,
						counter_narrative = ?,
						counter_metrics_json = ?,
						counter_accessibility_description = ?,
						updated_at = ?
					where id = ?
						and guild_id = ?
						and channel_id = ?
						and message_id = ?
						and target_id = ?
						and target_is_bot = 0
						and publication_status = 'published'
						and response_status = 'pending'
					returning id`
			)
			.bind(
				input.responseType,
				input.responderId,
				timestamp,
				toJson(input.responseResult),
				counter?.actorId ?? null,
				counter?.targetId ?? null,
				counter?.sceneId ?? null,
				counter?.assetUrl ?? null,
				counter?.assetChecksum ?? null,
				counter?.headline ?? null,
				counter?.narrative ?? null,
				counter ? toJson(counter.metrics) : null,
				counter?.accessibilityDescription ?? null,
				timestamp,
				input.encounterId,
				input.guildId,
				input.channelId,
				input.messageId,
				input.responderIsBot ? "__bot_cannot_respond__" : input.responderId
			)
	])
	const encounter = await getLobsterEncounter(input.encounterId, database)
	if (!encounter) {
		return { kind: "not_found" }
	}

	const authorized =
		!input.responderIsBot &&
		!encounter.targetIsBot &&
		encounter.guildId === input.guildId &&
		encounter.channelId === input.channelId &&
		encounter.messageId === input.messageId &&
		encounter.targetId === input.responderId &&
		encounter.publicationStatus === "published"
	if (!authorized) {
		return { kind: "unauthorized", encounter }
	}
	return {
		kind: updateResult?.results[0] ? "recorded" : "already_recorded",
		encounter
	}
}
