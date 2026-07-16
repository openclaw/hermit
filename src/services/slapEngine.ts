import {
	slapConfig,
	type SlapFish,
	type SlapOutcome,
	type SlapRarity
} from "../config/slap.js"

export type SlapSubject = {
	id: string
	bot: boolean
}

export type SlapResult = {
	fishSlug: string
	fishName: string
	rarity: SlapRarity
	outcome: SlapOutcome
	headline: string
	narrative: string
	impact: number
	dignityRemaining: number
	fishCondition: string
	imageUrl: string
}

const fishConditions: Record<SlapOutcome, readonly string[]> = {
	normal: [
		"Operational; mildly judgmental",
		"Damp but within tolerance",
		"Cleared for one additional meeting",
		"Awaiting towel reimbursement"
	],
	critical: [
		"Promoted on impact",
		"Requires structural inspection",
		"Emotionally unavailable",
		"Now classified as office equipment"
	],
	dodge: [
		"Returning to sender",
		"Navigation system vindicated",
		"Unapologetically aerodynamic"
	],
	refusal: [
		"On protected leave",
		"Represented by counsel",
		"Inside a grievance bucket"
	],
	double: [
		"Overachieving",
		"Certified for duplicate service",
		"Requesting overtime"
	],
	legendary: [
		"Older than policy",
		"Unchanged since the Devonian",
		"Beyond performance review"
	],
	self: [
		"Confused but compliant",
		"Added to the training deck"
	],
	hermit: [
		"Confiscated as evidence",
		"Formatting corrected"
	],
	rock_lobster: [
		"Outranked by crustacean",
		"Released without prejudice"
	],
	bot: [
		"Retrying with exponential backoff",
		"Checksum intact"
	]
}

const hashSeed = (value: string) => {
	let hash = 0x811c9dc5
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

const randomSource = (seed: string) => {
	let state = hashSeed(seed)
	return () => {
		state += 0x6d2b79f5
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296
	}
}

const pickOne = <T>(items: readonly T[], random: () => number): T => {
	const selected = items[Math.floor(random() * items.length)]
	if (selected === undefined) {
		throw new Error("Cannot select from an empty slap collection")
	}
	return selected
}

const pickWeighted = <T>(
	items: readonly (readonly [T, number])[],
	random: () => number
): T => {
	const totalWeight = items.reduce((total, [, weight]) => total + weight, 0)
	let cursor = random() * totalWeight
	for (const [item, weight] of items) {
		cursor -= weight
		if (cursor < 0) {
			return item
		}
	}

	const fallback = items.at(-1)?.[0]
	if (fallback === undefined) {
		throw new Error("Cannot select from an empty weighted slap collection")
	}
	return fallback
}

const randomInteger = (
	minimum: number,
	maximum: number,
	random: () => number
) => Math.floor(random() * (maximum - minimum + 1)) + minimum

const selectFish = (
	outcome: SlapOutcome,
	random: () => number
): SlapFish => {
	const eligibleFish = outcome === "legendary"
		? slapConfig.fish.filter((fish) => fish.rarity === "legendary")
		: slapConfig.fish

	return pickWeighted(
		eligibleFish.map((fish) => [fish, fish.weight] as const),
		random
	)
}

const determineOutcome = (
	actor: SlapSubject,
	target: SlapSubject,
	random: () => number,
	mode: "initial" | "counter"
): SlapOutcome => {
	if (mode === "counter") {
		return pickWeighted(slapConfig.counterOutcomeWeights, random)
	}
	if (actor.id === target.id) {
		return "self"
	}
	if (target.id === slapConfig.hermitUserId) {
		return "hermit"
	}
	if (target.id === slapConfig.rockLobsterUserId) {
		return "rock_lobster"
	}
	if (target.bot) {
		return "bot"
	}
	return pickWeighted(slapConfig.outcomeWeights, random)
}

const metricsFor = (
	outcome: SlapOutcome,
	random: () => number
): Pick<SlapResult, "impact" | "dignityRemaining"> => {
	switch (outcome) {
		case "normal":
			return {
				impact: randomInteger(18, 96, random),
				dignityRemaining: randomInteger(24, 89, random)
			}
		case "critical":
			return {
				impact: randomInteger(240, 880, random),
				dignityRemaining: randomInteger(0, 16, random)
			}
		case "dodge":
		case "refusal":
		case "hermit":
		case "rock_lobster":
			return { impact: 0, dignityRemaining: 100 }
		case "double":
			return {
				impact: randomInteger(190, 620, random),
				dignityRemaining: randomInteger(0, 10, random)
			}
		case "legendary":
			return {
				impact: randomInteger(2400, 9999, random),
				dignityRemaining: 0
			}
		case "self":
			return {
				impact: randomInteger(36, 280, random),
				dignityRemaining: randomInteger(3, 62, random)
			}
		case "bot":
			return {
				impact: randomInteger(1, 9, random),
				dignityRemaining: 100
			}
	}
}

const fillTemplate = (
	template: string,
	actorId: string,
	targetId: string,
	fishName: string
) =>
	template
		.replaceAll("{actor}", `<@${actorId}>`)
		.replaceAll("{target}", `<@${targetId}>`)
		.replaceAll("{fish}", `**${fishName}**`)

export const generateSlapResult = (input: {
	seed: string
	actor: SlapSubject
	target: SlapSubject
	mode?: "initial" | "counter"
}): SlapResult => {
	const random = randomSource(input.seed)
	const outcome = determineOutcome(
		input.actor,
		input.target,
		random,
		input.mode ?? "initial"
	)
	const fish = selectFish(outcome, random)
	const narrative = fillTemplate(
		pickOne(slapConfig.lines[outcome], random),
		input.actor.id,
		input.target.id,
		fish.name
	)
	const metrics = metricsFor(outcome, random)

	return {
		fishSlug: fish.slug,
		fishName: fish.name,
		rarity: fish.rarity,
		outcome,
		headline: slapConfig.headlines[outcome],
		narrative,
		...metrics,
		fishCondition: pickOne(fishConditions[outcome], random),
		imageUrl: fish.imageUrl
	}
}

export const getAppealRuling = (eventId: number) =>
	pickOne(slapConfig.appealRulings, randomSource(`appeal:${eventId}`))

export const formatSlapIncidentId = (eventId: number) =>
	`FSH-${eventId.toString().padStart(4, "0")}`
