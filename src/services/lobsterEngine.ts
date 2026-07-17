import {
	lobsterSceneChecksum,
	lobsterSceneUrl
} from "../config/lobster.js"
import {
	lobsterMetadataRecords,
	requireLobsterMetadataByAphiaId
} from "../config/lobsterMetadata.js"
import { lobsterTaxonomy } from "../config/lobsterTaxonomy.js"
import type { LobsterEncounter } from "../db/schema.js"
import type { LobsterCounterEvent } from "../data/lobsterEncounters.js"

export type LobsterSubject = {
	id: string
	bot: boolean
}

export type LobsterTargetKind =
	| "member"
	| "self"
	| "hermit"
	| "rock_lobster"
	| "bot"

export type LobsterMetrics = {
	action: string
	resolve: number
	approachDistanceCm: number
	proceduralDrag: number
}

export type LobsterEncounterResult = {
	taxonomySnapshotId: string
	speciesAphiaId: number
	speciesAcceptedName: string
	speciesDisplayName: string
	speciesFamily: string
	sceneId: string
	sceneIndex: number
	action: string
	assetUrl: string
	assetChecksum: string
	headline: string
	narrative: string
	metrics: LobsterMetrics
	accessibilityDescription: string
	targetKind: LobsterTargetKind
}

export type LobsterButterResult = {
	accepted: boolean
	headline: string
	narrative: string
}

const hashSeed = (value: string) => {
	let hash = 0x811c9dc5
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

export const deterministicIndex = (seed: string, length: number) => {
	if (!Number.isSafeInteger(length) || length <= 0) {
		throw new Error("Cannot select from an empty lobster collection")
	}
	return Math.floor((hashSeed(seed) / 4294967296) * length)
}

const randomInteger = (seed: string, minimum: number, maximum: number) =>
	minimum + deterministicIndex(seed, maximum - minimum + 1)

const actionCopy: Record<string, string> = {
	refusal: "stages a clear refusal and leaves the request unsigned",
	"ceremonial-display": "appears ceremonially and assumes immediate jurisdiction",
	"editorial-observe": "observes the filing with exacting editorial concern",
	"editorial-pose": "holds an editorial pose while the room reconsiders its choices",
	"large-chela-stand-off": "opens a non-contact large-chela stand-off",
	"antenna-stand-off": "establishes a non-contact antenna stand-off",
	"antenna-plate-refusal": "presents its antenna plates and refuses further process",
	"multi-chela-stand-off": "coordinates a multi-chela stand-off",
	"subchelate-stand-off": "sets a subchelate stand-off without contact",
	pinch: "delivers one species-authorized pinch",
	"antenna-strike": "executes one documented antenna strike",
	"tail-escape": "tail-flips through the filing and exits backward",
	"body-check": "commits to a forceful body check",
	ambush: "emerges from cover and completes the encounter"
}

const targetClause = (
	kind: LobsterTargetKind,
	actorId: string,
	targetId: string
) => {
	switch (kind) {
		case "self":
			return `<@${actorId}> selected themselves, so the encounter became an internal review.`
		case "hermit":
			return `Hermit accepted service, corrected the form, and returned it to <@${actorId}>.`
		case "rock_lobster":
			return "Rock Lobster acknowledged the visiting species under standard crustacean protocol."
		case "bot":
			return `<@${targetId}> recorded the encounter as structured input and continued operating.`
		case "member":
			return `<@${targetId}> is now the named subject of the encounter filed by <@${actorId}>.`
	}
}

const metricsFor = (
	seed: string,
	action: string
): LobsterMetrics => ({
	action,
	resolve: randomInteger(`${seed}:resolve`, 41, 100),
	approachDistanceCm: randomInteger(`${seed}:distance`, 8, 240),
	proceduralDrag: randomInteger(`${seed}:drag`, 1, 99)
})

export const targetKindFor = (
	actor: LobsterSubject,
	target: LobsterSubject,
	hermitUserId: string,
	rockLobsterUserId: string
): LobsterTargetKind => {
	if (actor.id === target.id) {
		return "self"
	}
	if (target.id === hermitUserId) {
		return "hermit"
	}
	if (target.id === rockLobsterUserId) {
		return "rock_lobster"
	}
	return target.bot ? "bot" : "member"
}

export const generateLobsterEncounter = (input: {
	seed: string
	actor: LobsterSubject
	target: LobsterSubject
	hermitUserId: string
	rockLobsterUserId: string
}): LobsterEncounterResult => {
	const speciesIndex = deterministicIndex(
		`species:${input.seed}`,
		lobsterMetadataRecords.length
	)
	const species = lobsterMetadataRecords[speciesIndex]
	if (!species) {
		throw new Error("Selected lobster species is unavailable")
	}
	const sceneIndex = deterministicIndex(
		`scene:${input.seed}`,
		species.scenePlans.length
	)
	const scene = species.scenePlans[sceneIndex]
	if (!scene) {
		throw new Error(`No scene plan is available for AphiaID ${species.AphiaID}`)
	}
	const targetKind = targetKindFor(
		input.actor,
		input.target,
		input.hermitUserId,
		input.rockLobsterUserId
	)
	const action = actionCopy[scene.action] ?? "completes the approved encounter"

	return {
		taxonomySnapshotId: lobsterTaxonomy.snapshotId,
		speciesAphiaId: species.AphiaID,
		speciesAcceptedName: species.scientificName,
		speciesDisplayName: species.displayName,
		speciesFamily: species.family,
		sceneId: scene.id,
		sceneIndex,
		action: scene.action,
		assetUrl: lobsterSceneUrl(species.AphiaID, scene.id),
		assetChecksum: lobsterSceneChecksum(species.AphiaID, scene.id),
		headline: scene.headline,
		narrative: `**${species.displayName}** ${action}. ${targetClause(
			targetKind,
			input.actor.id,
			input.target.id
		)}`,
		metrics: metricsFor(`${input.seed}:${species.AphiaID}:${scene.id}`, scene.action),
		accessibilityDescription: scene.altText,
		targetKind
	}
}

export const generateLobsterReturn = (
	encounter: LobsterEncounter
): LobsterCounterEvent => {
	const species = requireLobsterMetadataByAphiaId(encounter.speciesAphiaId)
	const initialIndex = species.scenePlans.findIndex(
		(scene) => scene.id === encounter.sceneId
	)
	if (initialIndex < 0) {
		throw new Error(`Stored lobster scene ${encounter.sceneId} is not bundled`)
	}
	const offset = 1 + deterministicIndex(
		`return-scene:${encounter.interactionId}`,
		species.scenePlans.length - 1
	)
	const scene = species.scenePlans[(initialIndex + offset) % species.scenePlans.length]
	if (!scene || scene.id === encounter.sceneId) {
		throw new Error("Could not select a distinct lobster return scene")
	}

	return {
		actorId: encounter.targetId,
		targetId: encounter.actorId,
		sceneId: scene.id,
		assetUrl: lobsterSceneUrl(species.AphiaID, scene.id),
		assetChecksum: lobsterSceneChecksum(species.AphiaID, scene.id),
		headline: `${species.displayName} returns the encounter`,
		narrative: `<@${encounter.targetId}> returned the filing. **${species.displayName}** redirected its ${scene.action.replaceAll("-", " ")} scene toward <@${encounter.actorId}> without changing species.`,
		metrics: metricsFor(
			`return:${encounter.interactionId}:${scene.id}`,
			scene.action
		),
		accessibilityDescription: `${scene.altText} The scene represents the encounter being returned to the original actor.`
	}
}

export const generateLobsterButterResult = (
	encounter: LobsterEncounter
): LobsterButterResult => {
	const accepted =
		deterministicIndex(`butter:${encounter.interactionId}`, 2) === 0
	const species = encounter.speciesDisplayName
	return accepted
		? {
			accepted,
			headline: "Butter offer accepted",
			narrative: `**${species}** accepted <@${encounter.targetId}>'s butter settlement and closed the encounter without further contact.`
		}
		: {
			accepted,
			headline: "Butter offer rejected",
			narrative: `**${species}** rejected <@${encounter.targetId}>'s butter settlement as an unsupported culinary assumption. The encounter is closed.`
		}
}

export const formatLobsterEncounterId = (id: number) =>
	`LOB-${id.toString().padStart(4, "0")}`
