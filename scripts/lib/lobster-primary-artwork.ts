import { createHash } from "node:crypto"
import {
	ACTION_REGISTRY,
	type LobsterActionId,
	type LobsterMetadataDataset,
	type LobsterMetadataRecord
} from "./lobster-metadata.js"

export const PRIMARY_ARTWORK_SCHEMA_VERSION = 1 as const
export const PRIMARY_ARTWORK_PLAN_ID = "LOB-PRIMARY-ART-v2" as const
export const PRIMARY_ARTWORK_PROMPT_VERSION = "lob-primary-v2" as const
export const PRIMARY_ARTWORK_WIDTH = 768 as const
export const PRIMARY_ARTWORK_HEIGHT = 512 as const
export const PRIMARY_ARTWORK_BATCH_SIZE = 24 as const

export const PRIMARY_PHYSICAL_ACTION_PRIORITY = [
	"pinch",
	"antenna-strike",
	"body-check",
	"ambush",
	"tail-escape"
] as const satisfies readonly LobsterActionId[]

export const PRIMARY_MORPHOLOGY_ACTION_PRIORITY = [
	"large-chela-stand-off",
	"antenna-stand-off",
	"multi-chela-stand-off",
	"subchelate-stand-off",
	"antenna-plate-refusal"
] as const satisfies readonly LobsterActionId[]

export const PRIMARY_FALLBACK_ACTION_PRIORITY = [
	"refusal",
	"ceremonial-display",
	"editorial-observe",
	"editorial-pose"
] as const satisfies readonly LobsterActionId[]

export type PrimaryReviewState = "not-reviewed" | "approved" | "rejected"
export type PrimaryGenderPresentation = "woman" | "man" | "nonbinary"

type PrimaryArtDirection = {
	id: string
	kind: "photorealistic" | "non-photorealistic"
}

type PrimaryEnvironment = {
	id: string
	family: string
	officeLike: boolean
	diverLike: boolean
}

const media: readonly PrimaryArtDirection[] = [
	{ id: "documentary-photo", kind: "photorealistic" },
	{ id: "stop-motion-clay", kind: "non-photorealistic" },
	{ id: "inked-comic-panel", kind: "non-photorealistic" },
	{ id: "miniature-diorama-photo", kind: "photorealistic" },
	{ id: "woodblock-print", kind: "non-photorealistic" },
	{ id: "cinematic-photo", kind: "photorealistic" },
	{ id: "gouache-illustration", kind: "non-photorealistic" },
	{ id: "sports-broadcast-photo", kind: "photorealistic" },
	{ id: "paper-cut-collage", kind: "non-photorealistic" },
	{ id: "museum-archive-photo", kind: "photorealistic" },
	{ id: "pulp-adventure-illustration", kind: "non-photorealistic" },
	{ id: "fashion-editorial-photo", kind: "photorealistic" },
	{ id: "watercolor-illustration", kind: "non-photorealistic" },
	{ id: "street-reportage-photo", kind: "photorealistic" },
	{ id: "risograph-poster", kind: "non-photorealistic" },
	{ id: "theatrical-production-photo", kind: "photorealistic" },
	{ id: "cel-animation-frame", kind: "non-photorealistic" },
	{ id: "oil-painting-tableau", kind: "non-photorealistic" }
]

const environments: readonly PrimaryEnvironment[] = [
	{ id: "seaside-boardwalk", family: "coast-public", officeLike: false, diverLike: false },
	{ id: "night-market", family: "market-festival", officeLike: false, diverLike: false },
	{ id: "museum-loading-bay", family: "museum-theater", officeLike: false, diverLike: false },
	{ id: "tram-platform", family: "street-transit", officeLike: false, diverLike: false },
	{ id: "community-theater-stage", family: "museum-theater", officeLike: false, diverLike: false },
	{ id: "castle-courtyard", family: "historic-mythic", officeLike: false, diverLike: false },
	{ id: "railway-concourse", family: "street-transit", officeLike: false, diverLike: false },
	{ id: "rooftop-garden", family: "garden-observatory", officeLike: false, diverLike: false },
	{ id: "carnival-midway", family: "market-festival", officeLike: false, diverLike: false },
	{ id: "public-library-steps", family: "civic-outdoor", officeLike: false, diverLike: false },
	{ id: "ferry-terminal", family: "vessel-port", officeLike: false, diverLike: false },
	{ id: "sculpture-park", family: "garden-observatory", officeLike: false, diverLike: false },
	{ id: "observatory-deck", family: "garden-observatory", officeLike: false, diverLike: false },
	{ id: "winter-festival", family: "market-festival", officeLike: false, diverLike: false },
	{ id: "courthouse-steps", family: "civic-outdoor", officeLike: false, diverLike: false },
	{ id: "harbor-market", family: "vessel-port", officeLike: false, diverLike: false },
	{ id: "regatta-finish", family: "arena-sport", officeLike: false, diverLike: false },
	{ id: "concert-backstage", family: "museum-theater", officeLike: false, diverLike: false },
	{ id: "botanical-conservatory", family: "garden-observatory", officeLike: false, diverLike: false },
	{ id: "archaeological-dig", family: "expedition-field", officeLike: false, diverLike: false },
	{ id: "lighthouse-landing", family: "coast-public", officeLike: false, diverLike: false },
	{ id: "town-square-parade", family: "civic-outdoor", officeLike: false, diverLike: false }
]

const eras = [
	"contemporary",
	"1920s",
	"1940s",
	"1960s",
	"1980s",
	"near-future",
	"victorian",
	"renaissance",
	"bronze-age-imagined",
	"prehistoric-imagined",
	"mythic-timeless"
] as const

const tones = [
	"deadpan",
	"wry",
	"playful",
	"triumphant",
	"mock-heroic",
	"bureaucratically-absurd",
	"mischievous",
	"theatrical",
	"dryly-dramatic",
	"celebratory",
	"awkwardly-formal",
	"tabloid-serious",
	"storybook-chaotic",
	"ceremonially-ridiculous",
	"operatically-tense",
	"documentary-comic"
] as const

const castPatterns = [
	"target-solo",
	"target-and-bystander",
	"target-and-friend",
	"target-with-small-crowd",
	"target-and-transit-worker",
	"target-and-street-musician",
	"target-and-museum-guide",
	"target-and-market-vendor",
	"target-and-stagehand",
	"target-and-sports-official",
	"target-and-historian",
	"target-and-gardener"
] as const

const actionDirections: Record<LobsterActionId, string> = {
	refusal: "performs a clear non-contact refusal toward the target",
	"ceremonial-display": "performs a formal non-contact judgment of the target",
	"editorial-observe": "visibly judges the target from a neutral observation pose",
	"editorial-pose": "holds a neutral editorial pose aimed toward the target",
	"large-chela-stand-off":
		"corners the target with enlarged first-leg chelae without making contact",
	"antenna-stand-off":
		"corners the target with enlarged antennae without making contact",
	"antenna-plate-refusal":
		"flatly blocks the target with plate-like second antennae",
	"multi-chela-stand-off":
		"confronts the target with the documented multiple chelate walking legs",
	"subchelate-stand-off":
		"technically corners the target with the documented subchelate first legs",
	pinch:
		"clamps an enlarged first-leg chela onto the target's loose outerwear cuff",
	"antenna-strike":
		"strikes toward the target with an enlarged antenna and knocks their hat sideways",
	"tail-escape":
		"tail-flips away after visibly outmaneuvering the target",
	"body-check": "makes a clear non-gory body check against the target",
	ambush: "springs a visible non-gory ambush on the target"
}

const pinchContactRemediations = new Set([
	210067,
	220231,
	382832,
	382868,
	383037,
	383045,
	1609822
])

const glypheidaeAnatomyRemediations = new Set([382840])
const noTextRemediations = new Set([382894])
const polychelidaeAnatomyRemediations = new Set([246203, 382976, 383001])
const scyllaridaeAnatomyRemediations = new Set([
	210364,
	382910,
	382947,
	382961,
	382964,
	382969,
	382972,
	382974,
	382975,
	762297
])

const remediationFor = (AphiaID: number) => {
	if (AphiaID === 246203) {
		return "Final remediation: strict unobstructed side profile with the far side completely hidden. Show one clearly countable row of exactly five fully visible, separated near-side walking legs from front to rear. Legs one through four each end in one small pincer; leg five ends in a simple point. Do not crop, overlap, merge, hide, add, or duplicate any leg."
	}
	if (AphiaID === 210067 || AphiaID === 382832) {
		return "Second remediation: frame the wrist in close-up. The claw must visibly encircle the separate folded cuff hem at the very end of the sleeve, below all main sleeve fabric. Show the bare hand emerging safely beyond the cuff with clear air between claw and skin. No grip anywhere above the wrist."
	}
	if (AphiaID === 382840) {
		return "Second remediation: strict side profile of a low horizontal lobster. The first legs end in simple narrow bent subchelate clasps with one small movable tip closing against the leg segment. Absolutely no two-finger pincers, broad chelae, crab claws, or oversized grasping claws anywhere."
	}
	if (polychelidaeAnatomyRemediations.has(AphiaID)) {
		return "Second remediation: strict clean side profile with all far-side legs hidden behind the body. Show exactly five visible near-side walking legs: the first four each end in one small coherent pincer and the fifth ends in a simple point. No other legs or claws may be visible. Keep the body low, horizontal, and lobster-like."
	}
	if (AphiaID === 382969) {
		return "Second remediation: strict front three-quarter view of a low flattened slipper lobster. Show exactly two broad separate plate antennae and no structure between them: no central beak, jaw, horn, trunk, third plate, or projecting mouthpart."
	}
	if (pinchContactRemediations.has(AphiaID)) {
		return "Remediation: show one claw firmly closed around only the loose outerwear cuff edge at the wrist. Keep a clear visible gap from skin and hand. Do not grip the upper arm, elbow, mid-sleeve, cloak body, torso fabric, or bare hand. Keep the hand, wrist, cuff, and claw visibly separate and coherent."
	}
	if (glypheidaeAnatomyRemediations.has(AphiaID)) {
		return "Remediation: show a low horizontal lobster body with elongated subchelate first legs only. Do not give it large true pincer claws, crab claws, oversized chelae, or an upright body."
	}
	if (noTextRemediations.has(AphiaID)) {
		return "Remediation: every scorecard or sign must be completely blank, with no numbers, letters, symbols, marks, or pseudo-text."
	}
	if (scyllaridaeAnatomyRemediations.has(AphiaID)) {
		return "Remediation: show a low, dorsoventrally flattened slipper-lobster body with two separate broad plate-like second antennae at the front, reading as paired paddles or shields. The plates must not fuse into a beak, jaw, horn, wing, trunk, scarf, or pincer. Use ordinary walking legs with no giant claws, and keep the body horizontal rather than upright."
	}
	return null
}

const humorBeats: Record<LobsterActionId, readonly string[]> = {
	refusal: [
		"the target is left holding an unopened ceremonial ribbon",
		"a tiny velvet rope is already in place for no defensible reason"
	],
	"ceremonial-display": [
		"a witness solemnly raises an empty scorecard",
		"the target receives a uselessly grand ribbon"
	],
	"editorial-observe": [
		"the target realizes the lobster has brought reading glasses",
		"a witness takes notes on an obviously blank clipboard"
	],
	"editorial-pose": [
		"the target is caught mid-apology to nobody in particular",
		"a nearby folding chair has been reserved for due process"
	],
	"large-chela-stand-off": [
		"the target's oversized keyring is now clearly under lobster jurisdiction",
		"a witness quietly moves the snack bowl out of reach"
	],
	"antenna-stand-off": [
		"the antennae form an absurdly effective velvet-rope barrier",
		"the target's hat is already leaning away from the confrontation"
	],
	"antenna-plate-refusal": [
		"the target's handshake meets an unmistakable crustacean stop sign",
		"a witness attempts to present a ticket that nobody requested"
	],
	"multi-chela-stand-off": [
		"the target starts counting claws and visibly gives up halfway",
		"a dropped snack bag becomes disputed territory"
	],
	"subchelate-stand-off": [
		"the target consults a pocket ruler and regrets becoming technical",
		"a witness produces a magnifying glass at exactly the wrong moment"
	],
	pinch: [
		"the target's sleeve is held under a visibly unofficial release schedule",
		"a witness offers a comically tiny pair of safety scissors"
	],
	"antenna-strike": [
		"the target's hat lands perfectly on a nearby traffic cone",
		"a witness raises a scorecard before remembering there is no competition"
	],
	"tail-escape": [
		"the target points in the wrong direction while the lobster is already gone",
		"a witness starts a stopwatch several seconds too late"
	],
	"body-check": [
		"the target's foam clipboard spins away with unnecessary drama",
		"a witness marks the encounter fair on an empty scorecard"
	],
	ambush: [
		"the target's snack bag is confiscated as tactical evidence",
		"a witness unveils a warning cone after the fact"
	]
}

export type PrimaryArtworkReview = {
	status: PrimaryReviewState
	reviewedAt: string | null
	notes: string | null
}

export type PrimaryArtworkEntry = {
	sceneId: string
	AphiaID: number
	scientificName: string
	displayName: string
	family: string
	bodyPlan: string
	action: {
		id: LobsterActionId
		kind: "physical" | "morphology" | "fallback"
		direction: string
		evidenceScope: string
		citationIds: string[]
	}
	source:
		| { kind: "generated" }
		| {
				kind: "reused-supporting"
				supportingSceneId: string
				supportingOutputPath: string
		  }
	dimensions: {
		width: typeof PRIMARY_ARTWORK_WIDTH
		height: typeof PRIMARY_ARTWORK_HEIGHT
		format: "webp"
		aspectRatio: "3:2"
	}
	medium: string
	mediumKind: PrimaryArtDirection["kind"]
	environment: string
	environmentFamily: string
	era: string
	tone: string
	cast: {
		patternId: string
		target: {
			adultStatus: "adult"
			identity: "generic-unidentified-person"
			genderPresentation: PrimaryGenderPresentation
			prominence: "prominent"
		}
		supportingAdults: string
		diverPresent: false
	}
	targetRelationship: string
	humorBeat: string
	familyAnatomyConstraints: string[]
	promptVersion: typeof PRIMARY_ARTWORK_PROMPT_VERSION
	prompt: string
	promptSha256: string
	altText: string
	outputPath: string
	reviews: {
		targetRelation: PrimaryArtworkReview
		actionClarity: PrimaryArtworkReview
		humor: PrimaryArtworkReview
		anatomy: PrimaryArtworkReview & {
			designatedApprover: "Peter Steinberger"
		}
		finalArt: PrimaryArtworkReview & {
			designatedApprover: "Hannes Rudolph"
		}
	}
}

export type PrimaryArtworkPlan = {
	schemaVersion: typeof PRIMARY_ARTWORK_SCHEMA_VERSION
	planId: typeof PRIMARY_ARTWORK_PLAN_ID
	promptVersion: typeof PRIMARY_ARTWORK_PROMPT_VERSION
	taxonomy: {
		snapshotId: string
		path: "data/lobster/taxonomy/lobster-species.json"
		sha256: string
	}
	metadata: {
		path: "data/lobster/metadata/lobster-metadata.json"
		sha256: string
	}
	output: {
		root: "assets/lobster/primary"
		pathTemplate: "assets/lobster/primary/{aphiaId}/{sceneId}.webp"
		format: "webp"
		width: typeof PRIMARY_ARTWORK_WIDTH
		height: typeof PRIMARY_ARTWORK_HEIGHT
	}
	selectionPolicy: {
		permittedActionsOnly: true
		order: ["physical", "morphology", "fallback"]
		physicalPriority: typeof PRIMARY_PHYSICAL_ACTION_PRIORITY
		morphologyPriority: typeof PRIMARY_MORPHOLOGY_ACTION_PRIORITY
		fallbackPriority: typeof PRIMARY_FALLBACK_ACTION_PRIORITY
	}
	reviewPolicy: {
		releaseRequiresAllApproved: true
		scientificAnatomy: {
			designatedApprover: "Peter Steinberger"
			status: "designated-not-reviewed"
			statement: string
		}
		finalArt: {
			designatedApprover: "Hannes Rudolph"
			status: "designated-not-reviewed"
			statement: string
		}
	}
	entries: PrimaryArtworkEntry[]
}

export type PrimaryArtworkRuntimeEntry = {
	AphiaID: number
	action: LobsterActionId
	sceneId: string
	relativeOutputPath: string
	altText: string
	source: "generated" | "reused-supporting"
	reviewStates: {
		targetRelation: PrimaryReviewState
		actionClarity: PrimaryReviewState
		humor: PrimaryReviewState
		anatomy: PrimaryReviewState
		finalArt: PrimaryReviewState
	}
	reusedSupportingSceneId?: string
}

export type PrimaryArtworkRuntimeManifest = {
	schemaVersion: typeof PRIMARY_ARTWORK_SCHEMA_VERSION
	planId: typeof PRIMARY_ARTWORK_PLAN_ID
	entries: PrimaryArtworkRuntimeEntry[]
}

export type PrimaryArtworkBatches = {
	schemaVersion: typeof PRIMARY_ARTWORK_SCHEMA_VERSION
	planId: typeof PRIMARY_ARTWORK_PLAN_ID
	batchSizeLimit: typeof PRIMARY_ARTWORK_BATCH_SIZE
	batches: Array<{
		id: string
		index: number
		sceneIds: string[]
	}>
}

export const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

export const serializePrimaryArtworkJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`

const selectFromPriority = (
	permitted: ReadonlySet<LobsterActionId>,
	priority: readonly LobsterActionId[]
) => priority.find((action) => permitted.has(action))

export const selectPrimaryAction = (record: LobsterMetadataRecord) => {
	const permitted = new Set(record.permittedActions.map(({ id }) => id))
	const selected =
		selectFromPriority(permitted, PRIMARY_PHYSICAL_ACTION_PRIORITY) ??
		selectFromPriority(permitted, PRIMARY_MORPHOLOGY_ACTION_PRIORITY) ??
		selectFromPriority(permitted, PRIMARY_FALLBACK_ACTION_PRIORITY)
	if (!selected) {
		throw new Error(`AphiaID ${record.AphiaID} has no permitted primary action`)
	}
	return selected
}

const actionEvidence = (
	record: LobsterMetadataRecord,
	action: LobsterActionId
) => {
	const permission = record.permittedActions.find(({ id }) => id === action)
	if (!permission) {
		throw new Error(`AphiaID ${record.AphiaID} uses prohibited action ${action}`)
	}
	const registry = ACTION_REGISTRY[action]
	if (!registry.capability) {
		return {
			evidenceScope: permission.reason,
			citationIds: [...record.broadBodyPlan.citationIds]
		}
	}
	const capability = record.capabilities[registry.capability]
	if (capability.value !== true || capability.citationIds.length === 0) {
		throw new Error(
			`AphiaID ${record.AphiaID} action ${action} lacks exact capability evidence`
		)
	}
	return {
		evidenceScope: capability.evidenceScope,
		citationIds: [...capability.citationIds]
	}
}

const actionKind = (
	action: LobsterActionId
): PrimaryArtworkEntry["action"]["kind"] => {
	const kind = ACTION_REGISTRY[action].kind
	return kind === "physical" || kind === "morphology" ? kind : "fallback"
}

const noReview = (): PrimaryArtworkReview => ({
	status: "not-reviewed",
	reviewedAt: null,
	notes: null
})

const supportingAdults = (patternId: string) => {
	if (patternId === "target-solo") return "none"
	return patternId.replace("target-and-", "").replace("target-with-", "")
}

const buildPrompt = (
	entry: Omit<PrimaryArtworkEntry, "prompt" | "promptSha256" | "altText" | "reviews">
) => {
	const anatomy = entry.familyAnatomyConstraints.join(" ")
	return [
		`Create one exact 768x512 WebP-ready primary encounter scene for ${entry.sceneId}.`,
		`Subject: ${entry.scientificName} (AphiaID ${entry.AphiaID}), family ${entry.family}, shown with the ${entry.bodyPlan}.`,
		`Action: the lobster ${entry.action.direction}.`,
		`Target relationship: ${entry.targetRelationship}.`,
		`Humor beat: ${entry.humorBeat}.`,
		`The target is a generic unidentified adult with ${entry.cast.target.genderPresentation} gender presentation, not an avatar and not based on any real Discord user.`,
		`Cast pattern: ${entry.cast.patternId}; supporting adults: ${entry.cast.supportingAdults}. No divers.`,
		`Anatomy constraints for ${entry.family}: ${anatomy}`,
		`Evidence scope: ${entry.action.evidenceScope}`,
		`Art direction: ${entry.medium} (${entry.mediumKind}); ${entry.environment} in the ${entry.environmentFamily} setting family; ${entry.era} era; ${entry.tone} tone.`,
		"The lobster, target, direction of action, and visible comedic consequence must be immediately legible.",
		"The staged setting is art direction, not a claim about natural habitat or species range.",
		"Do not invent limbs, claws, antenna shapes, behavior, or species-specific markings beyond the committed evidence.",
		"No gore, injury detail, children, avatars, actual Discord users, text, captions, logos, brands, watermarks, signatures, or interface elements."
	].join(" ")
}

export const buildPrimaryArtworkPlan = (
	metadata: LobsterMetadataDataset,
	bindings: {
		metadataSha256: string
		taxonomySha256: string
	}
): PrimaryArtworkPlan => {
	const entries = metadata.records.map((record, index): PrimaryArtworkEntry => {
		const action = selectPrimaryAction(record)
		const evidence = actionEvidence(record, action)
		const sceneId = `lob-v2-a${record.AphiaID}-primary`
		const medium = media[(index * 5) % media.length]!
		const environment = environments[(index * 7) % environments.length]!
		const era = eras[(index * 7) % eras.length]!
		const tone = tones[(index * 11) % tones.length]!
		const patternId =
			castPatterns[(index * 5) % castPatterns.length]!
		const genderPresentation = (
			["woman", "man", "nonbinary"] as const
		)[index % 3]!
		const humorOptions = humorBeats[action]
		const eligibleHumorOptions =
			patternId === "target-solo"
				? humorOptions.filter((beat) => !beat.includes("witness"))
				: humorOptions
		const humorBeat =
			eligibleHumorOptions[
				(index + record.AphiaID) % eligibleHumorOptions.length
			]!
		const targetRelationship =
			`A prominent generic adult target faces the lobster at close conversational distance; ` +
			`the lobster is oriented toward that target and ${actionDirections[action]}.`
		const draft = {
			sceneId,
			AphiaID: record.AphiaID,
			scientificName: record.scientificName,
			displayName: record.displayName,
			family: record.family,
			bodyPlan: record.broadBodyPlan.value ?? "evidence-limited lobster body plan",
			action: {
				id: action,
				kind: actionKind(action),
				direction: actionDirections[action],
				...evidence
			},
			source: { kind: "generated" as const },
			dimensions: {
				width: PRIMARY_ARTWORK_WIDTH,
				height: PRIMARY_ARTWORK_HEIGHT,
				format: "webp" as const,
				aspectRatio: "3:2" as const
			},
			medium: medium.id,
			mediumKind: medium.kind,
			environment: environment.id,
			environmentFamily: environment.family,
			era,
			tone,
			cast: {
				patternId,
				target: {
					adultStatus: "adult" as const,
					identity: "generic-unidentified-person" as const,
					genderPresentation,
					prominence: "prominent" as const
				},
				supportingAdults: supportingAdults(patternId),
				diverPresent: false as const
			},
			targetRelationship,
			humorBeat,
			familyAnatomyConstraints: [...(record.anatomyFacts.value ?? [])],
			promptVersion: PRIMARY_ARTWORK_PROMPT_VERSION,
			outputPath: `assets/lobster/primary/${record.AphiaID}/${sceneId}.webp`
		}
		const prompt = buildPrompt(draft)
		const remediation = remediationFor(record.AphiaID)
		const finalPrompt = remediation ? `${prompt} ${remediation}` : prompt
		return {
			...draft,
			prompt: finalPrompt,
			promptSha256: sha256(finalPrompt),
			altText:
				`${record.displayName} ${actionDirections[action]} in a ${medium.id} scene at ` +
				`${environment.id}; ${humorBeat}.`,
			reviews: {
				targetRelation: noReview(),
				actionClarity: noReview(),
				humor: noReview(),
				anatomy: {
					designatedApprover: "Peter Steinberger",
					...noReview()
				},
				finalArt: {
					designatedApprover: "Hannes Rudolph",
					...noReview()
				}
			}
		}
	})
	return {
		schemaVersion: PRIMARY_ARTWORK_SCHEMA_VERSION,
		planId: PRIMARY_ARTWORK_PLAN_ID,
		promptVersion: PRIMARY_ARTWORK_PROMPT_VERSION,
		taxonomy: {
			snapshotId: metadata.taxonomySnapshotId,
			path: "data/lobster/taxonomy/lobster-species.json",
			sha256: bindings.taxonomySha256
		},
		metadata: {
			path: "data/lobster/metadata/lobster-metadata.json",
			sha256: bindings.metadataSha256
		},
		output: {
			root: "assets/lobster/primary",
			pathTemplate: "assets/lobster/primary/{aphiaId}/{sceneId}.webp",
			format: "webp",
			width: PRIMARY_ARTWORK_WIDTH,
			height: PRIMARY_ARTWORK_HEIGHT
		},
		selectionPolicy: {
			permittedActionsOnly: true,
			order: ["physical", "morphology", "fallback"],
			physicalPriority: PRIMARY_PHYSICAL_ACTION_PRIORITY,
			morphologyPriority: PRIMARY_MORPHOLOGY_ACTION_PRIORITY,
			fallbackPriority: PRIMARY_FALLBACK_ACTION_PRIORITY
		},
		reviewPolicy: {
			releaseRequiresAllApproved: true,
			scientificAnatomy: {
				designatedApprover: "Peter Steinberger",
				status: "designated-not-reviewed",
				statement:
					"Peter Steinberger is the designated scientific anatomy approver. This plan does not claim that he reviewed or approved any primary scene."
			},
			finalArt: {
				designatedApprover: "Hannes Rudolph",
				status: "designated-not-reviewed",
				statement:
					"Hannes Rudolph is the designated final-art approver. This plan does not claim final-art approval for any primary scene."
			}
		},
		entries
	}
}

export const buildPrimaryArtworkRuntimeManifest = (
	plan: PrimaryArtworkPlan
): PrimaryArtworkRuntimeManifest => ({
	schemaVersion: PRIMARY_ARTWORK_SCHEMA_VERSION,
	planId: PRIMARY_ARTWORK_PLAN_ID,
	entries: plan.entries.map((entry) => ({
		AphiaID: entry.AphiaID,
		action: entry.action.id,
		sceneId: entry.sceneId,
		relativeOutputPath: entry.outputPath.replace(/^assets\//, ""),
		altText: entry.altText,
		source: entry.source.kind,
		reviewStates: {
			targetRelation: entry.reviews.targetRelation.status,
			actionClarity: entry.reviews.actionClarity.status,
			humor: entry.reviews.humor.status,
			anatomy: entry.reviews.anatomy.status,
			finalArt: entry.reviews.finalArt.status
		},
		...(entry.source.kind === "reused-supporting"
			? { reusedSupportingSceneId: entry.source.supportingSceneId }
			: {})
	}))
})

export const buildPrimaryArtworkBatches = (
	plan: PrimaryArtworkPlan
): PrimaryArtworkBatches => ({
	schemaVersion: PRIMARY_ARTWORK_SCHEMA_VERSION,
	planId: PRIMARY_ARTWORK_PLAN_ID,
	batchSizeLimit: PRIMARY_ARTWORK_BATCH_SIZE,
	batches: Array.from(
		{ length: Math.ceil(plan.entries.length / PRIMARY_ARTWORK_BATCH_SIZE) },
		(_, index) => {
			const batchIndex = index + 1
			return {
				id: `lob-primary-v2-b${batchIndex.toString().padStart(3, "0")}`,
				index: batchIndex,
				sceneIds: plan.entries
					.slice(
						index * PRIMARY_ARTWORK_BATCH_SIZE,
						(index + 1) * PRIMARY_ARTWORK_BATCH_SIZE
					)
					.map(({ sceneId }) => sceneId)
			}
		}
	)
})

const requireObject = (
	value: unknown,
	context: string
): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${context} must be an object`)
	}
	return value as Record<string, unknown>
}

const requireExactKeys = (
	value: Record<string, unknown>,
	keys: readonly string[],
	context: string
) => {
	const expected = new Set(keys)
	const unknown = Object.keys(value).filter((key) => !expected.has(key))
	const missing = keys.filter((key) => !(key in value))
	if (unknown.length > 0) {
		throw new Error(`${context} contains unknown key ${unknown.sort()[0]}`)
	}
	if (missing.length > 0) {
		throw new Error(`${context} is missing key ${missing[0]}`)
	}
}

const requireString = (value: unknown, context: string) => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${context} must be a non-empty string`)
	}
}

const requireReviewState = (value: unknown, context: string) => {
	if (!["not-reviewed", "approved", "rejected"].includes(String(value))) {
		throw new Error(`${context} has invalid review state`)
	}
}

const maxShare = (values: readonly string[]) => {
	const counts = new Map<string, number>()
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
	return Math.max(...counts.values()) / values.length
}

export const validatePrimaryArtworkPlan = (
	plan: PrimaryArtworkPlan,
	metadata: LobsterMetadataDataset
) => {
	if (plan.entries.length !== 264 || metadata.records.length !== 264) {
		throw new Error("primary artwork requires exactly 264 entries")
	}
	const metadataById = new Map(
		metadata.records.map((record) => [record.AphiaID, record])
	)
	const seenIds = new Set<number>()
	const seenSceneIds = new Set<string>()
	const seenPaths = new Set<string>()
	for (const [index, entry] of plan.entries.entries()) {
		const record = metadataById.get(entry.AphiaID)
		if (!record) throw new Error(`unknown primary AphiaID ${entry.AphiaID}`)
		if (seenIds.has(entry.AphiaID)) {
			throw new Error(`duplicate primary AphiaID ${entry.AphiaID}`)
		}
		seenIds.add(entry.AphiaID)
		if (index > 0 && entry.AphiaID <= plan.entries[index - 1]!.AphiaID) {
			throw new Error("primary AphiaIDs must be sorted")
		}
		const expectedSceneId = `lob-v2-a${entry.AphiaID}-primary`
		if (entry.sceneId !== expectedSceneId || seenSceneIds.has(entry.sceneId)) {
			throw new Error(`invalid or duplicate primary sceneId ${entry.sceneId}`)
		}
		seenSceneIds.add(entry.sceneId)
		const expectedPath =
			`assets/lobster/primary/${entry.AphiaID}/${expectedSceneId}.webp`
		if (entry.outputPath !== expectedPath || seenPaths.has(entry.outputPath)) {
			throw new Error(`invalid or duplicate primary output path ${entry.outputPath}`)
		}
		seenPaths.add(entry.outputPath)
		if (entry.source.kind !== "generated") {
			throw new Error("current primary artwork plan must contain zero reused bindings")
		}
		const selected = selectPrimaryAction(record)
		if (
			entry.action.id !== selected ||
			!record.permittedActions.some(({ id }) => id === entry.action.id)
		) {
			throw new Error(`AphiaID ${entry.AphiaID} has invalid primary action`)
		}
		const evidence = actionEvidence(record, entry.action.id)
		if (
			entry.action.evidenceScope !== evidence.evidenceScope ||
			JSON.stringify(entry.action.citationIds) !==
				JSON.stringify(evidence.citationIds)
		) {
			throw new Error(`AphiaID ${entry.AphiaID} has stale action evidence`)
		}
		if (
			entry.dimensions.width !== 768 ||
			entry.dimensions.height !== 512 ||
			entry.dimensions.format !== "webp"
		) {
			throw new Error(`AphiaID ${entry.AphiaID} has invalid output dimensions`)
		}
		if (
			entry.cast.target.adultStatus !== "adult" ||
			entry.cast.target.identity !== "generic-unidentified-person" ||
			entry.cast.target.prominence !== "prominent" ||
			entry.cast.diverPresent
		) {
			throw new Error(`AphiaID ${entry.AphiaID} lacks a valid generic adult target`)
		}
		if (
			!entry.targetRelationship.includes("generic adult target") ||
			entry.humorBeat.length < 20
		) {
			throw new Error(`AphiaID ${entry.AphiaID} lacks relationship or humor detail`)
		}
		if (
			JSON.stringify(entry.familyAnatomyConstraints) !==
			JSON.stringify(record.anatomyFacts.value ?? [])
		) {
			throw new Error(`AphiaID ${entry.AphiaID} has stale anatomy constraints`)
		}
		if (entry.promptSha256 !== sha256(entry.prompt)) {
			throw new Error(`AphiaID ${entry.AphiaID} has stale prompt SHA`)
		}
		if (
			!entry.prompt.includes(entry.targetRelationship) ||
			!entry.prompt.includes(entry.humorBeat) ||
			!entry.prompt.includes(`Anatomy constraints for ${entry.family}`)
		) {
			throw new Error(`AphiaID ${entry.AphiaID} has incomplete primary prompt`)
		}
		for (const review of Object.values(entry.reviews)) {
			if (
				review.status !== "not-reviewed" ||
				review.reviewedAt !== null ||
				review.notes !== null
			) {
				throw new Error(
					`AphiaID ${entry.AphiaID} falsely claims a completed review`
				)
			}
		}
	}
	if (seenIds.size !== metadataById.size) {
		throw new Error("primary artwork does not cover the taxonomy exactly")
	}
	const dimensions = [
		["medium", plan.entries.map(({ medium }) => medium), 0.08],
		["environment", plan.entries.map(({ environment }) => environment), 0.07],
		["era", plan.entries.map(({ era }) => era), 0.11],
		["tone", plan.entries.map(({ tone }) => tone), 0.08],
		["cast", plan.entries.map(({ cast }) => cast.patternId), 0.1],
		[
			"gender presentation",
			plan.entries.map(({ cast }) => cast.target.genderPresentation),
			0.35
		]
	] as const
	for (const [label, values, maximum] of dimensions) {
		if (maxShare(values) > maximum) {
			throw new Error(`primary ${label} variation exceeds maximum share`)
		}
	}
	const officeShare =
		plan.entries.filter((entry) =>
			environments.find(({ id }) => id === entry.environment)?.officeLike
		).length / plan.entries.length
	const diverShare =
		plan.entries.filter(
			(entry) =>
				entry.cast.diverPresent ||
				environments.find(({ id }) => id === entry.environment)?.diverLike
		).length / plan.entries.length
	if (officeShare > 0.03) throw new Error("primary corpus is office-dominant")
	if (diverShare > 0.03) throw new Error("primary corpus is diver-dominant")
}

export const validatePrimaryArtworkRuntimeManifest = (
	runtime: PrimaryArtworkRuntimeManifest,
	plan?: PrimaryArtworkPlan
) => {
	if (runtime.entries.length !== 264) {
		throw new Error("primary runtime requires exactly 264 entries")
	}
	const planById = new Map(plan?.entries.map((entry) => [entry.AphiaID, entry]))
	const seen = new Set<number>()
	for (const [index, entry] of runtime.entries.entries()) {
		if (seen.has(entry.AphiaID)) {
			throw new Error(`duplicate runtime AphiaID ${entry.AphiaID}`)
		}
		seen.add(entry.AphiaID)
		if (index > 0 && entry.AphiaID <= runtime.entries[index - 1]!.AphiaID) {
			throw new Error("runtime AphiaIDs must be sorted")
		}
		if (entry.sceneId !== `lob-v2-a${entry.AphiaID}-primary`) {
			throw new Error(`invalid runtime sceneId ${entry.sceneId}`)
		}
		if (
			entry.relativeOutputPath !==
			`lobster/primary/${entry.AphiaID}/${entry.sceneId}.webp`
		) {
			throw new Error(`invalid runtime output path for ${entry.AphiaID}`)
		}
		for (const [name, state] of Object.entries(entry.reviewStates)) {
			requireReviewState(state, `runtime ${entry.AphiaID} review ${name}`)
		}
		if (
			entry.source === "generated" &&
			entry.reusedSupportingSceneId !== undefined
		) {
			throw new Error(`generated runtime entry ${entry.AphiaID} claims reuse`)
		}
		if (
			entry.source === "reused-supporting" &&
			!entry.reusedSupportingSceneId
		) {
			throw new Error(`reused runtime entry ${entry.AphiaID} lacks source scene`)
		}
		const planned = planById.get(entry.AphiaID)
		if (
			planned &&
			(entry.action !== planned.action.id ||
				entry.altText !== planned.altText ||
				entry.source !== planned.source.kind)
		) {
			throw new Error(`runtime entry ${entry.AphiaID} disagrees with plan`)
		}
	}
}

export const validatePrimaryArtworkBatches = (
	batches: PrimaryArtworkBatches,
	plan: PrimaryArtworkPlan
) => {
	if (
		batches.planId !== plan.planId ||
		batches.batchSizeLimit !== PRIMARY_ARTWORK_BATCH_SIZE ||
		batches.batches.length !== 11
	) {
		throw new Error("primary batch graph header is invalid")
	}
	const expectedSceneIds = plan.entries.map(({ sceneId }) => sceneId)
	const actualSceneIds: string[] = []
	for (const [index, batch] of batches.batches.entries()) {
		if (
			batch.id !==
				`lob-primary-v2-b${(index + 1).toString().padStart(3, "0")}` ||
			batch.index !== index + 1 ||
			batch.sceneIds.length === 0 ||
			batch.sceneIds.length > PRIMARY_ARTWORK_BATCH_SIZE ||
			new Set(batch.sceneIds).size !== batch.sceneIds.length
		) {
			throw new Error(`primary batch ${index + 1} is invalid`)
		}
		actualSceneIds.push(...batch.sceneIds)
	}
	if (JSON.stringify(actualSceneIds) !== JSON.stringify(expectedSceneIds)) {
		throw new Error("primary batches do not exactly cover the manifest")
	}
}

export const parsePrimaryArtworkPlan = (
	value: unknown,
	metadata: LobsterMetadataDataset
): PrimaryArtworkPlan => {
	const plan = requireObject(value, "primary artwork plan")
	requireExactKeys(
		plan,
		[
			"schemaVersion",
			"planId",
			"promptVersion",
			"taxonomy",
			"metadata",
			"output",
			"selectionPolicy",
			"reviewPolicy",
			"entries"
		],
		"primary artwork plan"
	)
	if (
		plan.schemaVersion !== PRIMARY_ARTWORK_SCHEMA_VERSION ||
		plan.planId !== PRIMARY_ARTWORK_PLAN_ID ||
		plan.promptVersion !== PRIMARY_ARTWORK_PROMPT_VERSION ||
		!Array.isArray(plan.entries)
	) {
		throw new Error("primary artwork plan header is invalid")
	}
	for (const sectionName of [
		"taxonomy",
		"metadata",
		"output",
		"selectionPolicy",
		"reviewPolicy"
	] as const) {
		requireObject(plan[sectionName], `primary artwork plan.${sectionName}`)
	}
	requireExactKeys(
		plan.taxonomy as Record<string, unknown>,
		["snapshotId", "path", "sha256"],
		"primary artwork plan.taxonomy"
	)
	requireExactKeys(
		plan.metadata as Record<string, unknown>,
		["path", "sha256"],
		"primary artwork plan.metadata"
	)
	requireExactKeys(
		plan.output as Record<string, unknown>,
		["root", "pathTemplate", "format", "width", "height"],
		"primary artwork plan.output"
	)
	requireExactKeys(
		plan.selectionPolicy as Record<string, unknown>,
		[
			"permittedActionsOnly",
			"order",
			"physicalPriority",
			"morphologyPriority",
			"fallbackPriority"
		],
		"primary artwork plan.selectionPolicy"
	)
	requireExactKeys(
		plan.reviewPolicy as Record<string, unknown>,
		["releaseRequiresAllApproved", "scientificAnatomy", "finalArt"],
		"primary artwork plan.reviewPolicy"
	)
	for (const [index, rawEntry] of plan.entries.entries()) {
		const context = `primary artwork plan.entries[${index}]`
		const entry = requireObject(rawEntry, context)
		requireExactKeys(
			entry,
			[
				"sceneId",
				"AphiaID",
				"scientificName",
				"displayName",
				"family",
				"bodyPlan",
				"action",
				"source",
				"dimensions",
				"medium",
				"mediumKind",
				"environment",
				"environmentFamily",
				"era",
				"tone",
				"cast",
				"targetRelationship",
				"humorBeat",
				"familyAnatomyConstraints",
				"promptVersion",
				"prompt",
				"promptSha256",
				"altText",
				"outputPath",
				"reviews"
			],
			context
		)
		const action = requireObject(entry.action, `${context}.action`)
		requireExactKeys(
			action,
			["id", "kind", "direction", "evidenceScope", "citationIds"],
			`${context}.action`
		)
		const source = requireObject(entry.source, `${context}.source`)
		requireExactKeys(
			source,
			source.kind === "reused-supporting"
				? ["kind", "supportingSceneId", "supportingOutputPath"]
				: ["kind"],
			`${context}.source`
		)
		if (
			source.kind !== "generated" &&
			source.kind !== "reused-supporting"
		) {
			throw new Error(`${context}.source has invalid kind`)
		}
		const dimensions = requireObject(entry.dimensions, `${context}.dimensions`)
		requireExactKeys(
			dimensions,
			["width", "height", "format", "aspectRatio"],
			`${context}.dimensions`
		)
		const cast = requireObject(entry.cast, `${context}.cast`)
		requireExactKeys(
			cast,
			["patternId", "target", "supportingAdults", "diverPresent"],
			`${context}.cast`
		)
		const target = requireObject(cast.target, `${context}.cast.target`)
		requireExactKeys(
			target,
			[
				"adultStatus",
				"identity",
				"genderPresentation",
				"prominence"
			],
			`${context}.cast.target`
		)
		const reviews = requireObject(entry.reviews, `${context}.reviews`)
		requireExactKeys(
			reviews,
			[
				"targetRelation",
				"actionClarity",
				"humor",
				"anatomy",
				"finalArt"
			],
			`${context}.reviews`
		)
		for (const reviewName of [
			"targetRelation",
			"actionClarity",
			"humor",
			"anatomy",
			"finalArt"
		] as const) {
			const review = requireObject(
				reviews[reviewName],
				`${context}.reviews.${reviewName}`
			)
			requireExactKeys(
				review,
				reviewName === "anatomy" || reviewName === "finalArt"
					? ["designatedApprover", "status", "reviewedAt", "notes"]
					: ["status", "reviewedAt", "notes"],
				`${context}.reviews.${reviewName}`
			)
			requireReviewState(
				review.status,
				`${context}.reviews.${reviewName}.status`
			)
		}
	}
	const parsed = value as PrimaryArtworkPlan
	validatePrimaryArtworkPlan(parsed, metadata)
	return parsed
}

export const parsePrimaryArtworkRuntimeManifest = (
	value: unknown
): PrimaryArtworkRuntimeManifest => {
	const runtime = requireObject(value, "primary artwork runtime")
	requireExactKeys(
		runtime,
		["schemaVersion", "planId", "entries"],
		"primary artwork runtime"
	)
	if (
		runtime.schemaVersion !== PRIMARY_ARTWORK_SCHEMA_VERSION ||
		runtime.planId !== PRIMARY_ARTWORK_PLAN_ID ||
		!Array.isArray(runtime.entries)
	) {
		throw new Error("primary artwork runtime header is invalid")
	}
	for (const [index, rawEntry] of runtime.entries.entries()) {
		const entry = requireObject(rawEntry, `primary artwork runtime.entries[${index}]`)
		const source = entry.source
		requireExactKeys(
			entry,
			source === "reused-supporting"
				? [
						"AphiaID",
						"action",
						"sceneId",
						"relativeOutputPath",
						"altText",
						"source",
						"reviewStates",
						"reusedSupportingSceneId"
					]
				: [
						"AphiaID",
						"action",
						"sceneId",
						"relativeOutputPath",
						"altText",
						"source",
						"reviewStates"
					],
			`primary artwork runtime.entries[${index}]`
		)
		if (!Number.isInteger(entry.AphiaID)) {
			throw new Error(`runtime entry ${index} AphiaID must be an integer`)
		}
		requireString(entry.action, `runtime entry ${index} action`)
		if (!(entry.action as string in ACTION_REGISTRY)) {
			throw new Error(`runtime entry ${index} has unknown action`)
		}
		requireString(entry.sceneId, `runtime entry ${index} sceneId`)
		requireString(entry.relativeOutputPath, `runtime entry ${index} path`)
		requireString(entry.altText, `runtime entry ${index} alt text`)
		if (source !== "generated" && source !== "reused-supporting") {
			throw new Error(`runtime entry ${index} has invalid source`)
		}
		const reviews = requireObject(
			entry.reviewStates,
			`runtime entry ${index} reviewStates`
		)
		requireExactKeys(
			reviews,
			[
				"targetRelation",
				"actionClarity",
				"humor",
				"anatomy",
				"finalArt"
			],
			`runtime entry ${index} reviewStates`
		)
	}
	const parsed = value as PrimaryArtworkRuntimeManifest
	validatePrimaryArtworkRuntimeManifest(parsed)
	return parsed
}
