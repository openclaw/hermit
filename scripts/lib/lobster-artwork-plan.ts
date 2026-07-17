import { createHash } from "node:crypto"
import type {
	LobsterActionId,
	LobsterMetadataDataset,
	LobsterMetadataRecord,
	LobsterScenePlan
} from "./lobster-metadata.js"

export const ARTWORK_PLAN_SCHEMA_VERSION = 1 as const
export const ARTWORK_PLAN_ID = "LOB-ART-PLAN-v1" as const
export const ARTWORK_PROMPT_VERSION = "lob-art-v1" as const
export const ARTWORK_BATCH_SIZE = 25 as const
export const ARTWORK_WIDTH = 768 as const
export const ARTWORK_HEIGHT = 512 as const

const actionDirections: Record<LobsterActionId, string> = {
	refusal: "a clear non-contact refusal pose",
	"ceremonial-display": "a calm ceremonial display without contact",
	"editorial-observe": "a neutral observational pose without invented behavior",
	"editorial-pose": "a neutral editorial pose without invented behavior",
	"large-chela-stand-off":
		"a non-contact stand-off displaying the documented enlarged first-leg chelae",
	"antenna-stand-off":
		"a non-contact stand-off displaying the documented prominent antennae",
	"antenna-plate-refusal":
		"a refusal pose displaying the documented flattened plate-like antennae",
	"multi-chela-stand-off":
		"a non-contact stand-off displaying the documented multiple chelate walking legs",
	"subchelate-stand-off":
		"a non-contact stand-off displaying the documented subchelate first walking legs",
	pinch: "a visible pinch using the documented enlarged first-leg chelae",
	"antenna-strike":
		"a visible defensive strike using the documented prominent antennae",
	"tail-escape":
		"a visible backward tail-flip escape using the documented tail response",
	"body-check": "a forceful body contact action",
	ambush: "an ambush action"
}

type ReviewStatus = "not-reviewed" | "approved" | "rejected"

export type ArtworkProductionRecord = {
	batchId: string
	model: "gpt-image-2"
	generatorPath: string
	requestedSize: "1536x1024"
	quality: "low" | "medium"
	sourceOutput: {
		format: "webp"
		compression: 100
	}
	generatedAt: string
	generatedAtSource: "tracked-generation-results"
	authoritativeResult: {
		status: "generated"
		path: "data/lobster/artwork/generation-results.json"
	}
	promptVersion: typeof ARTWORK_PROMPT_VERSION
	promptSha256: string
	executionPromptSha256: string
	remediation: {
		id: string
		version: string
		sha256: string
	} | null
	final: {
		sha256: string
		bytes: number
		width: typeof ARTWORK_WIDTH
		height: typeof ARTWORK_HEIGHT
		format: "webp"
		colorSpace: "sRGB"
		compression: {
			codec: "cwebp"
			targetBytes: 75000
			maximumBytes: 122880
		}
	}
	automatedReviewStatus: "passed"
	status: "complete"
}

export type ArtworkManifestEntry = {
	sceneId: string
	taxonomySnapshot: {
		id: string
		sha256: string
	}
	AphiaID: number
	scientificName: string
	displayName: string
	family: string
	bodyPlan: string
	anatomyFacts: string[]
	action: {
		id: LobsterActionId
		direction: string
		evidenceScope: string
		citationIds: string[]
	}
	dimensions: {
		width: 768
		height: 512
		format: "webp"
		aspectRatio: "3:2"
	}
	medium: string
	mediumKind: "photorealistic" | "non-photorealistic"
	environment: string
	environmentFamily: string
	era: string
	tone: string
	cast: LobsterScenePlan["cast"]
	camera: LobsterScenePlan["camera"]
	composition: string
	lighting: string
	palette: string
	sceneFamilyId: string
	humanReviewStatus: LobsterScenePlan["humanReviewStatus"]
	automatedReviewStatus: LobsterScenePlan["automatedReviewStatus"]
	colorProfile: "sRGB"
	largerMasterRetained: false
	promptVersion: typeof ARTWORK_PROMPT_VERSION
	finalPrompt: string
	promptSha256: string
	altText: string
	outputPath: string
	outputSha256: string | null
	outputBytes: number | null
	status: "planned" | "complete"
	batchId?: string
	production?: ArtworkProductionRecord
	reviews: {
		scientificAnatomy: {
			approver: "Peter Steinberger"
			status: ReviewStatus
			reviewedAt: null
			notes: null
		}
		finalArt: {
			approver: "Hannes Rudolph"
			status: ReviewStatus
			reviewedAt: null
			notes: null
		}
	}
}

export type ArtworkManifest = {
	schemaVersion: typeof ARTWORK_PLAN_SCHEMA_VERSION
	planId: typeof ARTWORK_PLAN_ID
	promptVersion: typeof ARTWORK_PROMPT_VERSION
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
		root: "assets/lobster/scenes"
		pathTemplate: "assets/lobster/scenes/{aphiaId}/{sceneId}.webp"
		format: "webp"
		width: 768
		height: 512
	}
	approvals: {
		scientificAnatomy: "Peter Steinberger"
		finalArt: "Hannes Rudolph"
	}
	deliveryContract: {
		architecture: "repository-assets"
		git: {
			repository: "openclaw/hermit"
			assetPathTemplate: "assets/lobster/scenes/{aphiaId}/{sceneId}.webp"
			revisionRequirement: "full-40-character-lowercase-commit-sha"
		}
		rawGitHub: {
			origin: "https://raw.githubusercontent.com"
			urlTemplate: "https://raw.githubusercontent.com/openclaw/hermit/{gitCommitSha}/assets/lobster/scenes/{aphiaId}/{sceneId}.webp"
			immutability: "gitCommitSha must be a full immutable commit SHA"
		}
		trustedFetch: {
			allowedOrigin: "https://raw.githubusercontent.com"
			requiredPathPrefix: "/openclaw/hermit/"
			accept: "image/webp"
			requiredContentType: "image/webp"
			maximumBytes: 122880
			validation: ["http-ok", "bounded-bytes", "riff-webp", "exact-768x512"]
		}
		discordAttachment: {
			filenameTemplate: "lobster-{aphiaId}-{sceneId}.webp"
			attachmentUrlTemplate: "attachment://lobster-{aphiaId}-{sceneId}.webp"
			descriptionSource: "manifest-alt-text"
			externalMediaInMessage: false
		}
	}
	entries: ArtworkManifestEntry[]
}

export type ArtworkBatchGraph = {
	schemaVersion: typeof ARTWORK_PLAN_SCHEMA_VERSION
	planId: typeof ARTWORK_PLAN_ID
	batchSizeLimit: typeof ARTWORK_BATCH_SIZE
	manifestSha256: string
	batches: Array<{
		id: string
		index: number
		speciesCount: number
		sceneCount: number
		species: Array<{
			AphiaID: number
			scientificName: string
			family: string
			sceneIds: string[]
		}>
		production?: {
			status: "complete"
			automatedReviewStatus: "passed"
			sceneCount: number
			totalBytes: number
			aggregateAssetSha256: string
			inventorySha256: string
		}
	}>
}

export type ArtworkPlanInputBindings = {
	metadataSha256: string
	taxonomySha256: string
	taxonomySnapshotId: string
}

export const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

export const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`

const actionEvidence = (
	record: LobsterMetadataRecord,
	action: LobsterActionId
) => {
	const permitted = record.permittedActions.find((entry) => entry.id === action)
	if (!permitted) {
		throw new Error(`${record.AphiaID} scene uses prohibited action ${action}`)
	}
	const capabilityByAction: Partial<
		Record<LobsterActionId, keyof LobsterMetadataRecord["capabilities"]>
	> = {
		"large-chela-stand-off": "largeGraspingClaws",
		"antenna-stand-off": "prominentAntennae",
		"antenna-plate-refusal": "flattenedPlateAntennae",
		"multi-chela-stand-off": "multipleChelatePereopods",
		"subchelate-stand-off": "subchelateFirstLegs",
		pinch: "largeGraspingClaws",
		"antenna-strike": "antennaStrikingBehavior",
		"tail-escape": "tailEscapeBehavior",
		"body-check": "forcefulBodyContact",
		ambush: "ambushBehavior"
	}
	const capabilityName = capabilityByAction[action]
	if (!capabilityName) {
		return {
			evidenceScope: permitted.reason,
			citationIds: record.broadBodyPlan.citationIds
		}
	}
	const capability = record.capabilities[capabilityName]
	if (capability.value !== true || capability.citationIds.length === 0) {
		throw new Error(
			`${record.AphiaID} action ${action} lacks exact true capability evidence`
		)
	}
	return {
		evidenceScope: capability.evidenceScope,
		citationIds: capability.citationIds
	}
}

const castDescription = (cast: LobsterScenePlan["cast"]) => {
	if (cast.kind !== "human") {
		return `${cast.id} (${cast.kind}); do not add humans`
	}
	return `${cast.id}; ${cast.adults
		.map(
			(adult) =>
				`${adult.prominence} ${adult.ageBand} adult ${adult.genderPresentation}, ` +
				`${adult.role}, ${adult.wardrobe}, ${adult.skinToneGroup} skin tone, ${adult.bodyType} build`
		)
		.join("; ")}`
}

const buildPrompt = (
	record: LobsterMetadataRecord,
	scene: LobsterScenePlan,
	evidence: ReturnType<typeof actionEvidence>
) => {
	const prohibited = record.prohibitedActions.map(({ id }) => id).join(", ")
	return [
		`Create one exact ${ARTWORK_WIDTH}x${ARTWORK_HEIGHT} WebP-ready scene for ${scene.id}.`,
		`Subject: ${record.scientificName} (AphiaID ${record.AphiaID}), family ${record.family}, shown as a ${record.broadBodyPlan.value}.`,
		`Action: ${actionDirections[scene.action]}. This action is supported by: ${evidence.evidenceScope}`,
		`Anatomy constraints: ${record.anatomyFacts.value?.join(" ")}`,
		`Do not depict unsupported actions (${prohibited}); do not invent limbs, claws, antenna shapes, behavior, habitat, depth, geography, or species-specific markings not present in the cited evidence.`,
		`Art direction: ${scene.medium} (${scene.mediumKind}); ${scene.environment} in environment family ${scene.environmentFamily}; ${scene.era} era; ${scene.tone} tone.`,
		`Cast: ${castDescription(scene.cast)}.`,
		`Camera: ${scene.camera.position}, ${scene.camera.lensLanguage}; composition: ${scene.composition}; lighting: ${scene.lighting}; palette: ${scene.palette}.`,
		"The lobster and anatomy-supported action must be immediately legible. Preserve the planned medium, environment family, and cast pattern exactly so portfolio quotas remain valid.",
		"No text, lettering, captions, logos, brands, watermarks, signatures, interface elements, or third-party characters. No gore."
	].join(" ")
}

const buildEntry = (
	dataset: LobsterMetadataDataset,
	record: LobsterMetadataRecord,
	scene: LobsterScenePlan
): ArtworkManifestEntry => {
	const evidence = actionEvidence(record, scene.action)
	const finalPrompt = buildPrompt(record, scene, evidence)
	return {
		sceneId: scene.id,
		taxonomySnapshot: {
			id: dataset.taxonomySnapshotId,
			sha256: dataset.taxonomySha256
		},
		AphiaID: record.AphiaID,
		scientificName: record.scientificName,
		displayName: record.displayName,
		family: record.family,
		bodyPlan: record.broadBodyPlan.value ?? "unknown",
		anatomyFacts: record.anatomyFacts.value ?? [],
		action: {
			id: scene.action,
			direction: actionDirections[scene.action],
			...evidence
		},
		dimensions: {
			width: ARTWORK_WIDTH,
			height: ARTWORK_HEIGHT,
			format: "webp",
			aspectRatio: "3:2"
		},
		medium: scene.medium,
		mediumKind: scene.mediumKind,
		environment: scene.environment,
		environmentFamily: scene.environmentFamily,
		era: scene.era,
		tone: scene.tone,
		cast: scene.cast,
		camera: scene.camera,
		composition: scene.composition,
		lighting: scene.lighting,
		palette: scene.palette,
		sceneFamilyId: scene.sceneFamilyId,
		humanReviewStatus: scene.humanReviewStatus,
		automatedReviewStatus: scene.automatedReviewStatus,
		colorProfile: "sRGB",
		largerMasterRetained: false,
		promptVersion: ARTWORK_PROMPT_VERSION,
		finalPrompt,
		promptSha256: sha256(finalPrompt),
		altText: scene.altText,
		outputPath: `assets/lobster/scenes/${record.AphiaID}/${scene.id}.webp`,
		outputSha256: null,
		outputBytes: null,
		status: "planned",
		reviews: {
			scientificAnatomy: {
				approver: "Peter Steinberger",
				status: "not-reviewed",
				reviewedAt: null,
				notes: null
			},
			finalArt: {
				approver: "Hannes Rudolph",
				status: "not-reviewed",
				reviewedAt: null,
				notes: null
			}
		}
	}
}

export const buildArtworkManifest = (
	dataset: LobsterMetadataDataset,
	metadataSha256: string
): ArtworkManifest => {
	const records = [...dataset.records].sort(
		(left, right) => left.AphiaID - right.AphiaID
	)
	return {
		schemaVersion: ARTWORK_PLAN_SCHEMA_VERSION,
		planId: ARTWORK_PLAN_ID,
		promptVersion: ARTWORK_PROMPT_VERSION,
		taxonomy: {
			snapshotId: dataset.taxonomySnapshotId,
			path: "data/lobster/taxonomy/lobster-species.json",
			sha256: dataset.taxonomySha256
		},
		metadata: {
			path: "data/lobster/metadata/lobster-metadata.json",
			sha256: metadataSha256
		},
		output: {
			root: "assets/lobster/scenes",
			pathTemplate: "assets/lobster/scenes/{aphiaId}/{sceneId}.webp",
			format: "webp",
			width: ARTWORK_WIDTH,
			height: ARTWORK_HEIGHT
		},
		approvals: {
			scientificAnatomy: "Peter Steinberger",
			finalArt: "Hannes Rudolph"
		},
		deliveryContract: {
			architecture: "repository-assets",
			git: {
				repository: "openclaw/hermit",
				assetPathTemplate:
					"assets/lobster/scenes/{aphiaId}/{sceneId}.webp",
				revisionRequirement: "full-40-character-lowercase-commit-sha"
			},
			rawGitHub: {
				origin: "https://raw.githubusercontent.com",
				urlTemplate:
					"https://raw.githubusercontent.com/openclaw/hermit/{gitCommitSha}/assets/lobster/scenes/{aphiaId}/{sceneId}.webp",
				immutability: "gitCommitSha must be a full immutable commit SHA"
			},
			trustedFetch: {
				allowedOrigin: "https://raw.githubusercontent.com",
				requiredPathPrefix: "/openclaw/hermit/",
				accept: "image/webp",
				requiredContentType: "image/webp",
				maximumBytes: 120 * 1024,
				validation: [
					"http-ok",
					"bounded-bytes",
					"riff-webp",
					"exact-768x512"
				]
			},
			discordAttachment: {
				filenameTemplate: "lobster-{aphiaId}-{sceneId}.webp",
				attachmentUrlTemplate:
					"attachment://lobster-{aphiaId}-{sceneId}.webp",
				descriptionSource: "manifest-alt-text",
				externalMediaInMessage: false
			}
		},
		entries: records.flatMap((record) =>
			record.scenePlans.map((scene) => buildEntry(dataset, record, scene))
		)
	}
}

export const buildArtworkBatchGraph = (
	manifest: ArtworkManifest,
	manifestSha256: string
): ArtworkBatchGraph => {
	const bySpecies = Map.groupBy(manifest.entries, (entry) => entry.AphiaID)
	const species = [...bySpecies.entries()]
		.sort(([left], [right]) => left - right)
		.map(([AphiaID, entries]) => {
			const first = entries[0]!
			return {
				AphiaID,
				scientificName: first.scientificName,
				family: first.family,
				sceneIds: entries.map((entry) => entry.sceneId).sort()
			}
		})
	const batches: ArtworkBatchGraph["batches"] = []
	for (let offset = 0; offset < species.length; offset += ARTWORK_BATCH_SIZE) {
		const members = species.slice(offset, offset + ARTWORK_BATCH_SIZE)
		const index = batches.length + 1
		batches.push({
			id: `lob-art-v1-b${index.toString().padStart(3, "0")}`,
			index,
			speciesCount: members.length,
			sceneCount: members.reduce(
				(total, member) => total + member.sceneIds.length,
				0
			),
			species: members
		})
	}
	return {
		schemaVersion: ARTWORK_PLAN_SCHEMA_VERSION,
		planId: ARTWORK_PLAN_ID,
		batchSizeLimit: ARTWORK_BATCH_SIZE,
		manifestSha256,
		batches
	}
}

const maxShare = (values: string[], total: number) => {
	const counts = new Map<string, number>()
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	return Math.max(...counts.values()) / total
}

export const computeArtworkQuotaReport = (manifest: ArtworkManifest) => {
	const entries = manifest.entries
	const human = entries.filter((entry) => entry.cast.kind === "human")
	return {
		totalScenes: entries.length,
		mediumMaxShare: maxShare(
			entries.map((entry) => entry.medium),
			entries.length
		),
		environmentFamilyMaxShare: maxShare(
			entries.map((entry) => entry.environmentFamily),
			entries.length
		),
		officeHearingShare:
			entries.filter((entry) =>
				/office|boardroom|hearing/.test(entry.environment)
			).length / entries.length,
		castPatternMaxShare: maxShare(
			entries.map((entry) => entry.cast.id),
			entries.length
		),
		humanScenes: human.length,
		prominentAdultWomanHumanShare:
			human.filter((entry) =>
				entry.cast.adults.some(
					(adult) =>
						adult.genderPresentation === "woman" &&
						adult.prominence === "prominent"
				)
			).length / human.length,
		nonPhotorealisticShare:
			entries.filter(
				(entry) => entry.mediumKind === "non-photorealistic"
			).length / entries.length
	}
}

export const validateArtworkPlan = (
	manifest: ArtworkManifest,
	metadata: LobsterMetadataDataset,
	trustedInputs: ArtworkPlanInputBindings,
	batchGraph?: ArtworkBatchGraph
) => {
	if (
		metadata.taxonomySha256 !== trustedInputs.taxonomySha256 ||
		manifest.taxonomy.sha256 !== trustedInputs.taxonomySha256 ||
		metadata.taxonomySnapshotId !== trustedInputs.taxonomySnapshotId ||
		manifest.taxonomy.snapshotId !== trustedInputs.taxonomySnapshotId
	) {
		throw new Error("taxonomy identity does not match trusted input")
	}
	const canonicalMetadataSha256 = sha256(serializeJson(metadata))
	if (canonicalMetadataSha256 !== trustedInputs.metadataSha256) {
		throw new Error("supplied metadata checksum does not match trusted input")
	}
	if (manifest.metadata.sha256 !== trustedInputs.metadataSha256) {
		throw new Error("manifest metadata checksum does not match trusted input")
	}
	if (manifest.entries.length !== 1056) {
		throw new Error("artwork manifest must contain exactly 1,056 scenes")
	}
	const sceneIds = new Set<string>()
	const outputPaths = new Set<string>()
	const prompts = new Set<string>()
	const promptsWithoutSceneLead = new Set<string>()
	for (const entry of manifest.entries) {
		if (sceneIds.has(entry.sceneId)) {
			throw new Error(`duplicate scene ID ${entry.sceneId}`)
		}
		if (outputPaths.has(entry.outputPath)) {
			throw new Error(`duplicate output path ${entry.outputPath}`)
		}
		sceneIds.add(entry.sceneId)
		outputPaths.add(entry.outputPath)
		if (
			entry.outputPath !==
			`assets/lobster/scenes/${entry.AphiaID}/${entry.sceneId}.webp`
		) {
			throw new Error(`invalid output path ${entry.outputPath}`)
		}
		if (
			entry.dimensions.width !== ARTWORK_WIDTH ||
			entry.dimensions.height !== ARTWORK_HEIGHT ||
			entry.dimensions.format !== "webp" ||
			entry.colorProfile !== "sRGB" ||
			entry.largerMasterRetained !== false
		) {
			throw new Error(`invalid output dimensions for ${entry.sceneId}`)
		}
		if (
			entry.action.citationIds.length === 0 ||
			entry.anatomyFacts.length === 0 ||
			entry.bodyPlan.length === 0
		) {
			throw new Error(`missing anatomy evidence for ${entry.sceneId}`)
		}
		if (sha256(entry.finalPrompt) !== entry.promptSha256) {
			throw new Error(`prompt checksum mismatch for ${entry.sceneId}`)
		}
		if (
			!entry.finalPrompt.includes(entry.scientificName) ||
			!entry.finalPrompt.includes(entry.action.direction) ||
			!entry.finalPrompt.includes("No text, lettering, captions, logos") ||
			!entry.finalPrompt.includes("third-party characters") ||
			!entry.finalPrompt.includes("do not invent limbs")
		) {
			throw new Error(`unsafe or nonspecific prompt for ${entry.sceneId}`)
		}
		if (prompts.has(entry.finalPrompt)) {
			throw new Error(`duplicate final prompt for ${entry.sceneId}`)
		}
		prompts.add(entry.finalPrompt)
		const promptWithoutSceneLead = entry.finalPrompt.replace(
			/^Create one exact 768x512 WebP-ready scene for [^.]+\.\s*/,
			""
		)
		if (promptsWithoutSceneLead.has(promptWithoutSceneLead)) {
			throw new Error(`renamed duplicate prompt for ${entry.sceneId}`)
		}
		promptsWithoutSceneLead.add(promptWithoutSceneLead)
		if (
			entry.reviews.scientificAnatomy.status !== "not-reviewed" ||
			entry.reviews.finalArt.status !== "not-reviewed"
		) {
			throw new Error(`invented human review completion for ${entry.sceneId}`)
		}
		if (entry.status === "planned") {
			if (
				entry.outputSha256 !== null ||
				entry.outputBytes !== null ||
				entry.batchId !== undefined ||
				entry.production !== undefined
			) {
				throw new Error(`invented production completion for ${entry.sceneId}`)
			}
		} else {
			const production = entry.production
			if (
				!production ||
				entry.batchId !== production.batchId ||
				entry.outputSha256 !== production.final.sha256 ||
				entry.outputBytes !== production.final.bytes ||
				production.status !== "complete" ||
				production.automatedReviewStatus !== "passed" ||
				production.promptVersion !== entry.promptVersion ||
				production.promptSha256 !== entry.promptSha256 ||
				production.final.width !== entry.dimensions.width ||
				production.final.height !== entry.dimensions.height ||
				production.final.format !== entry.dimensions.format ||
				production.final.colorSpace !== entry.colorProfile ||
				!/^[a-f0-9]{64}$/.test(production.final.sha256) ||
				production.final.bytes <= 0 ||
				Number.isNaN(Date.parse(production.generatedAt))
			) {
				throw new Error(`invalid production completion for ${entry.sceneId}`)
			}
		}
	}
	const speciesCounts = Map.groupBy(
		manifest.entries,
		(entry) => entry.AphiaID
	)
	if (
		speciesCounts.size !== 264 ||
		[...speciesCounts.values()].some((entries) => entries.length !== 4)
	) {
		throw new Error("each of 264 species must have exactly four scenes")
	}
	const quota = computeArtworkQuotaReport(manifest)
	if (quota.mediumMaxShare > 0.15) throw new Error("medium quota exceeds 15%")
	if (quota.environmentFamilyMaxShare >= 0.1) {
		throw new Error("environment-family quota must remain below 10%")
	}
	if (quota.officeHearingShare >= 0.03) {
		throw new Error("office/hearing quota must remain below 3%")
	}
	if (quota.castPatternMaxShare > 0.05) {
		throw new Error("cast-pattern quota exceeds 5%")
	}
	if (quota.prominentAdultWomanHumanShare < 0.5) {
		throw new Error("adult-woman human-scene quota is below 50%")
	}
	if (quota.nonPhotorealisticShare < 0.2) {
		throw new Error("non-photorealistic quota is below 20%")
	}
	const canonicalManifest = buildArtworkManifest(
		metadata,
		trustedInputs.metadataSha256
	)
	const planningManifest = structuredClone(manifest)
	for (const entry of planningManifest.entries) {
		entry.outputSha256 = null
		entry.outputBytes = null
		entry.status = "planned"
		delete entry.batchId
		delete entry.production
	}
	if (JSON.stringify(planningManifest) !== JSON.stringify(canonicalManifest)) {
		throw new Error(
			"artwork manifest is not exactly bound to the source metadata"
		)
	}
	if (!batchGraph) return
	const canonicalBatches = buildArtworkBatchGraph(
		manifest,
		sha256(serializeJson(manifest))
	)
	const planningBatches = structuredClone(batchGraph)
	for (const batch of planningBatches.batches) delete batch.production
	if (JSON.stringify(planningBatches) !== JSON.stringify(canonicalBatches)) {
		throw new Error(
			"batch graph does not exactly match manifest species and scenes"
		)
	}
}
