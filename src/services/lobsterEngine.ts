import {
	lobsterPrimaryChecksum,
	lobsterPrimaryUrl,
	lobsterSceneChecksum,
	lobsterSceneUrl
} from "../config/lobster.js"
import {
	lobsterMetadataRecords,
	requireLobsterMetadataByAphiaId
} from "../config/lobsterMetadata.js"
import { getLobsterPrimaryArtwork } from "../config/lobsterPrimaryArtwork.js"
import { lobsterTaxonomy } from "../config/lobsterTaxonomy.js"
import type { LobsterEncounter } from "../db/schema.js"
import type { LobsterCounterEvent } from "../data/lobsterEncounters.js"
import type {
	LobsterMetadataRecord,
	LobsterScenePlan
} from "../../scripts/lib/lobster-metadata.js"

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

export type LegacyLobsterMetrics = {
	action: string
	resolve: number
	approachDistanceCm: number
	proceduralDrag: number
}

export type LobsterMetrics = {
	version: 2
	action: string
	outcomeLabel: string
	menace: number
	shellShock: number
	dignityRemaining: number
	escapeChance: number
	nerdNote: string
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

type MetricRange = readonly [minimum: number, maximum: number]

type LobsterOutcomeDefinition = {
	label: string
	weight: number
	verb: string
	metrics: {
		menace: MetricRange
		shellShock: MetricRange
		dignityRemaining: MetricRange
		escapeChance: MetricRange
	}
	lines: readonly string[]
	counterLines: readonly string[]
}

const outcomeDefinitions: Record<string, LobsterOutcomeDefinition> = {
	pinch: {
		label: "CLAW-CLAMPED",
		weight: 14,
		verb: "claw-clamped",
		metrics: {
			menace: [72, 100],
			shellShock: [58, 100],
			dignityRemaining: [0, 38],
			escapeChance: [2, 28]
		},
		lines: [
			"{actor} released {species}. It secured a legally defensible grip on {target} and declined to publish a release schedule.",
			"{actor} assigned {species} to {target}. The claw connected; the appeals desk immediately went to lunch.",
			"{species} clamped onto {target} with the confidence of an animal that has never completed mandatory workplace training."
		],
		counterLines: [
			"{target} returned {species} with the original paperwork still attached. {actor} has now been claw-clamped.",
			"{target} redirected the claw. {actor} received the same legally defensible grip with no introductory discount."
		]
	},
	"antenna-strike": {
		label: "ANTENNA-WHIPPED",
		weight: 14,
		verb: "antenna-whipped",
		metrics: {
			menace: [68, 98],
			shellShock: [52, 94],
			dignityRemaining: [3, 42],
			escapeChance: [4, 32]
		},
		lines: [
			"{actor} deployed {species}. It delivered a high-speed antenna memo directly to {target}'s personal space.",
			"{species} antenna-whipped {target}. Marine science has declined to soften the wording.",
			"{target} received one full-width antenna correction from {species}. The room observed a respectful silence."
		],
		counterLines: [
			"{target} reversed the antenna filing. {actor} has been struck by the same extremely long point.",
			"{species} pivoted on appeal and antenna-whipped {actor}. {target} requests that the record show perfect service."
		]
	},
	"large-chela-stand-off": {
		label: "CLAW-CORNERED",
		weight: 10,
		verb: "claw-cornered",
		metrics: {
			menace: [58, 92],
			shellShock: [32, 74],
			dignityRemaining: [12, 58],
			escapeChance: [10, 46]
		},
		lines: [
			"{actor} released {species}, which occupied {target}'s exit route and opened negotiations at clawpoint.",
			"{species} displayed both claws at {target}. No contact occurred; several conclusions did.",
			"{target} has been claw-cornered by {species}. The lobster currently controls the agenda."
		],
		counterLines: [
			"{target} transferred the claw standoff to {actor}. The lobster now controls a different agenda.",
			"{species} accepted {target}'s redirection and cornered {actor} under the same no-contact terms."
		]
	},
	"antenna-stand-off": {
		label: "ANTENNA-CORNERED",
		weight: 10,
		verb: "antenna-cornered",
		metrics: {
			menace: [55, 90],
			shellShock: [28, 70],
			dignityRemaining: [15, 62],
			escapeChance: [12, 50]
		},
		lines: [
			"{actor} deployed {species}. Its antennae entered the room several seconds before the rest of it and boxed in {target}.",
			"{species} established an antenna perimeter around {target}. Personal space has been temporarily delisted.",
			"{target} has been antenna-cornered by {species}. The lobster denies that the perimeter is excessive."
		],
		counterLines: [
			"{target} rotated the antenna perimeter toward {actor}. Personal space remains unavailable.",
			"{species} accepted the return order and antenna-cornered {actor} with full procedural continuity."
		]
	},
	"multi-chela-stand-off": {
		label: "OUTNUMBERED BY CLAWS",
		weight: 10,
		verb: "outnumbered by claws",
		metrics: {
			menace: [60, 94],
			shellShock: [35, 78],
			dignityRemaining: [8, 52],
			escapeChance: [8, 42]
		},
		lines: [
			"{actor} released {species}. {target} attempted to count the claws and lost control of the meeting.",
			"{species} presented multiple chelate arguments to {target}. Every one of them carried a motion.",
			"{target} has been outnumbered by claws. {species} has requested proportional representation."
		],
		counterLines: [
			"{target} reassigned the entire claw committee to {actor}. Quorum was immediate.",
			"{species} returned to {actor} with every chelate argument still pending."
		]
	},
	"subchelate-stand-off": {
		label: "TECHNICALLY CORNERED",
		weight: 10,
		verb: "technically cornered",
		metrics: {
			menace: [48, 82],
			shellShock: [20, 62],
			dignityRemaining: [18, 64],
			escapeChance: [18, 56]
		},
		lines: [
			"{actor} deployed {species}. {target} was cornered by appendages that legal insists are only technically claw-like.",
			"{species} established a subchelate standoff with {target}. The distinction is important to exactly three people.",
			"{target} has been technically cornered. {species} brought the footnotes."
		],
		counterLines: [
			"{target} returned the footnotes. {actor} is now technically cornered.",
			"{species} redirected the subchelate dispute toward {actor}, who may object in writing."
		]
	},
	"antenna-plate-refusal": {
		label: "FLATLY REJECTED",
		weight: 9,
		verb: "flatly rejected",
		metrics: {
			menace: [38, 76],
			shellShock: [18, 58],
			dignityRemaining: [4, 46],
			escapeChance: [38, 82]
		},
		lines: [
			"{actor} presented {target} to {species}. The lobster displayed two flattened antenna plates and rejected the entire premise.",
			"{species} flatly rejected {target}. This is both a ruling and an anatomy joke.",
			"{target} has been denied by {species}, whose face already resembles the final page of the appeal."
		],
		counterLines: [
			"{target} returned the flat rejection to {actor}. The antenna plates remain final.",
			"{species} reviewed the reassignment and flatly rejected {actor} with matching documentation."
		]
	},
	"tail-escape": {
		label: "OUTMANEUVERED",
		weight: 4,
		verb: "outmaneuvered",
		metrics: {
			menace: [30, 72],
			shellShock: [18, 62],
			dignityRemaining: [8, 54],
			escapeChance: [62, 100]
		},
		lines: [
			"{actor} released {species}. It tail-flipped out so decisively that {target} was left holding the embarrassment.",
			"{species} escaped backward at speed. {target} has somehow lost a confrontation with an absent lobster.",
			"{target} was outmaneuvered by {species}, which exited the incident before anyone could assign follow-up actions."
		],
		counterLines: [
			"{target} redirected the escape route. {species} passed {actor} at speed and left the embarrassment there.",
			"{species} tail-flipped through the return process. {actor} has now lost a confrontation with an absent lobster."
		]
	},
	refusal: {
		label: "REJECTED BY LOBSTER",
		weight: 1,
		verb: "rejected by lobster",
		metrics: {
			menace: [18, 58],
			shellShock: [8, 42],
			dignityRemaining: [0, 44],
			escapeChance: [72, 100]
		},
		lines: [
			"{species} reviewed {actor}'s request, looked directly at {target}, and refused the assignment on professional grounds.",
			"{target} has been rejected by {species}. No physical contact occurred, which somehow made it more personal.",
			"{actor} attempted to deploy {species}. The lobster cited standards and declined to associate with {target}."
		],
		counterLines: [
			"{target} returned the refusal to {actor}. {species} confirmed that the rejection is transferable.",
			"{species} reconsidered exactly one detail and now refuses {actor} instead."
		]
	},
	"ceremonial-display": {
		label: "FORMALLY JUDGED",
		weight: 1,
		verb: "formally judged",
		metrics: {
			menace: [20, 56],
			shellShock: [10, 44],
			dignityRemaining: [3, 48],
			escapeChance: [58, 96]
		},
		lines: [
			"{actor} summoned {species}, which conducted a formal ceremony recognizing {target} as today's designated problem.",
			"{species} performed a ceremonial display for {target}. The meaning was not explained, but the judgment was obvious.",
			"{target} has been formally judged by {species}. Minutes will not be distributed."
		],
		counterLines: [
			"{target} transferred ceremonial jurisdiction to {actor}. {species} resumed judging immediately.",
			"{species} repeated the ceremony for {actor}. The minutes remain classified."
		]
	},
	"editorial-observe": {
		label: "DEEPLY JUDGED",
		weight: 1,
		verb: "deeply judged",
		metrics: {
			menace: [16, 52],
			shellShock: [6, 38],
			dignityRemaining: [0, 42],
			escapeChance: [64, 100]
		},
		lines: [
			"{species} observed {target} with the concentrated disappointment of an organism that survived several geological management changes.",
			"{actor} deployed {species} to inspect {target}. The lobster found the situation visually exhausting.",
			"{target} has been deeply judged by {species}. No notes were provided because the problems were considered self-evident."
		],
		counterLines: [
			"{target} redirected the inspection. {species} is now deeply judging {actor}.",
			"{species} reviewed the return paperwork, looked at {actor}, and visibly lowered its expectations."
		]
	},
	"editorial-pose": {
		label: "DEEPLY JUDGED",
		weight: 1,
		verb: "deeply judged",
		metrics: {
			menace: [16, 52],
			shellShock: [6, 38],
			dignityRemaining: [0, 42],
			escapeChance: [64, 100]
		},
		lines: [
			"{species} held a devastating editorial pose while {target} reconsidered every recent decision.",
			"{actor} deployed {species}. It posed near {target} with enough judgment to alter the lighting.",
			"{target} has been compositionally defeated by {species}."
		],
		counterLines: [
			"{target} redirected the pose. {actor} is now compositionally defeated.",
			"{species} turned toward {actor}. The lighting became judgmental again."
		]
	}
}

const randomFromSeed = (seed: string) => hashSeed(seed) / 4294967296

const returnSafeActions = new Set([
	"refusal",
	"ceremonial-display",
	"editorial-observe",
	"editorial-pose",
	"large-chela-stand-off",
	"antenna-stand-off",
	"antenna-plate-refusal",
	"multi-chela-stand-off",
	"subchelate-stand-off"
])

const selectScene = (
	seed: string,
	scenes: readonly LobsterScenePlan[],
	excludedSceneId?: string
) => {
	const eligible = excludedSceneId
		? scenes.filter((scene) => scene.id !== excludedSceneId)
		: [...scenes]
	const weighted = eligible.map((scene) => ({
		scene,
		weight: outcomeDefinitions[scene.action]?.weight ?? 1
	}))
	const total = weighted.reduce((sum, item) => sum + item.weight, 0)
	let cursor = randomFromSeed(seed) * total
	for (const item of weighted) {
		cursor -= item.weight
		if (cursor < 0) {
			return item.scene
		}
	}
	const fallback = weighted.at(-1)?.scene
	if (!fallback) {
		throw new Error("Selected lobster has no eligible scene")
	}
	return fallback
}

const fillTemplate = (
	template: string,
	actorId: string,
	targetId: string,
	speciesName: string
) =>
	template
		.replaceAll("{actor}", `<@${actorId}>`)
		.replaceAll("{target}", `<@${targetId}>`)
		.replaceAll("{species}", `**${speciesName}**`)

const targetCoda: Record<LobsterTargetKind, string> = {
	member: "",
	self: "The incident is now classified as self-inflicted and impressively avoidable.",
	hermit:
		"Hermit logged the lobster as feedback. The lobster logged Hermit as a procedural obstacle.",
	rock_lobster:
		"Rock Lobster requested professional courtesy. The visiting lobster requested jurisdiction.",
	bot: "The bot classified the lobster as untrusted input. The lobster classified the bot as structurally suspicious."
}

const nerdNoteFor = (
	species: LobsterMetadataRecord,
	action: string
) => {
	switch (action) {
		case "pinch":
			return `Family evidence supports enlarged first-leg claws in ${species.family}. The taxonomy office approved this clamp.`
		case "antenna-strike":
			return `Committed evidence supports defensive antenna striking for this body plan. Marine science approved the swing and regrets the paperwork.`
		case "large-chela-stand-off":
			return `${species.family} evidence supports enlarged first-leg claws. No contact was required; the claws handled negotiations.`
		case "antenna-stand-off":
			return `Prominent antennae are supported for this body plan. Personal-space policy was not found in the source material.`
		case "multi-chela-stand-off":
			return `This family carries multiple chelate walking legs. The claw committee is anatomically legitimate.`
		case "subchelate-stand-off":
			return `Its first walking legs are subchelate rather than conventionally clawed. The distinction remains devastatingly technical.`
		case "antenna-plate-refusal":
			return `Slipper-lobster relatives carry flattened, plate-like antennae. Nature supplied its own rejection forms.`
		case "tail-escape":
			return `This body plan supports rapid backward tail-flip escapes. The lobster left; the humiliation remained.`
		default:
			return `${species.scientificName} is a marine member of ${species.family}. The judgment is scientifically classified and emotionally final.`
	}
}

const metricsFor = (
	seed: string,
	action: string,
	species: LobsterMetadataRecord
): LobsterMetrics => {
	const definition = outcomeDefinitions[action] ?? outcomeDefinitions.refusal!
	const metric = (name: keyof LobsterOutcomeDefinition["metrics"]) => {
		const [minimum, maximum] = definition.metrics[name]
		return randomInteger(`${seed}:${name}`, minimum, maximum)
	}
	return {
		version: 2,
		action,
		outcomeLabel: definition.label,
		menace: metric("menace"),
		shellShock: metric("shellShock"),
		dignityRemaining: metric("dignityRemaining"),
		escapeChance: metric("escapeChance"),
		nerdNote: nerdNoteFor(species, action)
	}
}

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
	const primary = getLobsterPrimaryArtwork(species.AphiaID)
	if (!primary) {
		throw new Error(
			`No primary lobster artwork is available for AphiaID ${species.AphiaID}`
		)
	}
	const sceneIndex = species.scenePlans.length
	const targetKind = targetKindFor(
		input.actor,
		input.target,
		input.hermitUserId,
		input.rockLobsterUserId
	)
	const definition =
		outcomeDefinitions[primary.action] ?? outcomeDefinitions.refusal!
	const line = definition.lines[
		deterministicIndex(
			`line:${input.seed}:${primary.sceneId}`,
			definition.lines.length
		)
	]!

	return {
		taxonomySnapshotId: lobsterTaxonomy.snapshotId,
		speciesAphiaId: species.AphiaID,
		speciesAcceptedName: species.scientificName,
		speciesDisplayName: species.displayName,
		speciesFamily: species.family,
		sceneId: primary.sceneId,
		sceneIndex,
		action: primary.action,
		assetUrl: lobsterPrimaryUrl(primary.relativeOutputPath),
		assetChecksum: lobsterPrimaryChecksum(
			species.AphiaID,
			primary.sceneId
		),
		headline: definition.label,
		narrative: fillTemplate(
			line,
			input.actor.id,
			input.target.id,
			species.displayName
		) + (targetCoda[targetKind] ? ` ${targetCoda[targetKind]}` : ""),
		metrics: metricsFor(
			`${input.seed}:${species.AphiaID}:${primary.sceneId}`,
			primary.action,
			species
		),
		accessibilityDescription: primary.altText,
		targetKind
	}
}

export const generateLobsterReturn = (
	encounter: LobsterEncounter
): LobsterCounterEvent => {
	const species = requireLobsterMetadataByAphiaId(encounter.speciesAphiaId)
	const primary = getLobsterPrimaryArtwork(species.AphiaID)
	if (
		encounter.sceneId !== primary?.sceneId &&
		!species.scenePlans.some((scene) => scene.id === encounter.sceneId)
	) {
		throw new Error(`Stored lobster scene ${encounter.sceneId} is not bundled`)
	}
	const returnScenes = species.scenePlans.filter(
		(scene) =>
			scene.id !== encounter.sceneId && returnSafeActions.has(scene.action)
	)
	const scene = selectScene(
		`return-scene:${encounter.interactionId}`,
		returnScenes
	)
	if (scene.id === encounter.sceneId) {
		throw new Error("Could not select a distinct lobster return scene")
	}
	const definition =
		outcomeDefinitions[scene.action] ?? outcomeDefinitions.refusal!
	const line = definition.counterLines[
		deterministicIndex(
			`return-line:${encounter.interactionId}:${scene.id}`,
			definition.counterLines.length
		)
	]!

	return {
		actorId: encounter.targetId,
		targetId: encounter.actorId,
		sceneId: scene.id,
		assetUrl: lobsterSceneUrl(species.AphiaID, scene.id),
		assetChecksum: lobsterSceneChecksum(species.AphiaID, scene.id),
		headline: `RETURN SUCCESSFUL · ${definition.label}`,
		narrative: fillTemplate(
			line,
			encounter.actorId,
			encounter.targetId,
			species.displayName
		),
		metrics: metricsFor(
			`return:${encounter.interactionId}:${scene.id}`,
			scene.action,
			species
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
				headline: "BUTTER BRIBE ACCEPTED",
				narrative: `**${species}** accepted <@${encounter.targetId}>'s butter retainer, closed the case, and left without providing a forwarding address.`
			}
			: {
				accepted,
				headline: "BUTTER BRIBE REJECTED",
				narrative: `**${species}** rejected <@${encounter.targetId}>'s butter as an offensive culinary stereotype. The encounter is closed; the judgment remains active.`
			}
}

export const formatLobsterEncounterId = (id: number) =>
	`LOB-${id.toString().padStart(4, "0")}`
