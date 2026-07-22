import { readFile } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import {
	PRIMARY_ARTWORK_HEIGHT,
	PRIMARY_ARTWORK_PLAN_ID,
	PRIMARY_ARTWORK_PROMPT_VERSION,
	PRIMARY_ARTWORK_SCHEMA_VERSION,
	PRIMARY_ARTWORK_WIDTH,
	serializePrimaryArtworkJson,
	sha256,
	validatePrimaryArtworkBatches,
	type PrimaryArtworkBatches,
	type PrimaryArtworkEntry,
	type PrimaryArtworkPlan
} from "./lobster-primary-artwork.js"

export const PRIMARY_MANIFEST_PATH =
	"data/lobster/artwork/primary-manifest.json" as const
export const PRIMARY_BATCHES_PATH =
	"data/lobster/artwork/primary-batches.json" as const
export const PRIMARY_RUNTIME_PATH =
	"data/lobster/artwork/primary-runtime.json" as const
export const PRIMARY_ASSET_COUNT = 264 as const
export const PRIMARY_WIDTH = PRIMARY_ARTWORK_WIDTH
export const PRIMARY_HEIGHT = PRIMARY_ARTWORK_HEIGHT
export const PRIMARY_MAX_BYTES = 122_880 as const
export const PRIMARY_TARGET_BYTES = 75_000 as const
export const PRIMARY_SOURCE_SIZE = "1536x1024" as const
export const PRIMARY_IMAGE_GEN_CLI =
	"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py" as const

export const PRIMARY_REVIEW_KEYS = [
	"targetRelation",
	"actionClarity",
	"humor",
	"anatomy",
	"finalArt"
] as const satisfies readonly (keyof PrimaryArtworkEntry["reviews"])[]

export type PrimaryManifestEntry = PrimaryArtworkEntry
export type PrimaryManifest = PrimaryArtworkPlan
export type PrimaryBatches = PrimaryArtworkBatches
export type PrimaryBatch = PrimaryArtworkBatches["batches"][number]

export type PrimaryPlan = {
	manifest: PrimaryArtworkPlan
	batches: PrimaryArtworkBatches
	normalizedBatches: PrimaryArtworkBatches["batches"]
	entryBySceneId: Map<string, PrimaryArtworkEntry>
	batchBySceneId: Map<string, string>
}

export { serializePrimaryArtworkJson as serializeJson, sha256 }

export const primaryPrompt = (entry: PrimaryArtworkEntry) => entry.prompt
export const primaryActionId = (entry: PrimaryArtworkEntry) => entry.action.id

export const assertSafePrimaryOutputPath = (
	outputPath: string,
	outputRoot: string
) => {
	const absolutePath = resolve(outputPath)
	const repositoryRoot = resolve(".")
	const fromRepository = relative(repositoryRoot, absolutePath)
	const absoluteOutputRoot = resolve(outputRoot)
	const fromOutputRoot = relative(absoluteOutputRoot, absolutePath)
	if (
		fromRepository === "" ||
		fromRepository === ".." ||
		fromRepository.startsWith(`..${sep}`) ||
		fromOutputRoot === "" ||
		fromOutputRoot === ".." ||
		fromOutputRoot.startsWith(`..${sep}`) ||
		!outputPath.endsWith(".webp")
	) {
		throw new Error(`${outputPath} is not a safe primary WebP path`)
	}
}

const reviewStates = new Set(["not-reviewed", "approved", "rejected"])

export const validatePrimaryPlan = (
	manifest: PrimaryArtworkPlan,
	batches: PrimaryArtworkBatches,
	expectedCount: number = PRIMARY_ASSET_COUNT
): PrimaryPlan => {
	if (
		manifest.schemaVersion !== PRIMARY_ARTWORK_SCHEMA_VERSION ||
		manifest.planId !== PRIMARY_ARTWORK_PLAN_ID ||
		manifest.promptVersion !== PRIMARY_ARTWORK_PROMPT_VERSION ||
		manifest.output.root !== "assets/lobster/primary" ||
		manifest.output.format !== "webp" ||
		manifest.output.width !== PRIMARY_WIDTH ||
		manifest.output.height !== PRIMARY_HEIGHT
	) {
		throw new Error("primary artwork plan header is invalid")
	}
	if (manifest.entries.length !== expectedCount) {
		throw new Error(
			`expected ${expectedCount} primary entries, found ${manifest.entries.length}`
		)
	}

	const entryBySceneId = new Map<string, PrimaryArtworkEntry>()
	const outputPaths = new Set<string>()
	for (const entry of manifest.entries) {
		if (
			entry.sceneId !== `lob-v2-a${entry.AphiaID}-primary` ||
			entry.outputPath !==
				`assets/lobster/primary/${entry.AphiaID}/${entry.sceneId}.webp` ||
			entry.promptVersion !== PRIMARY_ARTWORK_PROMPT_VERSION ||
			entry.promptSha256 !== sha256(entry.prompt) ||
			entry.dimensions.width !== PRIMARY_WIDTH ||
			entry.dimensions.height !== PRIMARY_HEIGHT ||
			entry.dimensions.format !== "webp" ||
			entry.dimensions.aspectRatio !== "3:2"
		) {
			throw new Error(`${entry.sceneId} has an invalid primary binding`)
		}
		if (
			entry.source.kind !== "generated" &&
			entry.source.kind !== "reused-supporting"
		) {
			throw new Error(`${entry.sceneId} has an invalid source kind`)
		}
		assertSafePrimaryOutputPath(entry.outputPath, manifest.output.root)
		if (entryBySceneId.has(entry.sceneId)) {
			throw new Error(`duplicate primary scene ID: ${entry.sceneId}`)
		}
		if (outputPaths.has(entry.outputPath)) {
			throw new Error(`duplicate primary output path: ${entry.outputPath}`)
		}
		for (const reviewKey of PRIMARY_REVIEW_KEYS) {
			if (!reviewStates.has(entry.reviews[reviewKey].status)) {
				throw new Error(
					`${entry.sceneId}.reviews.${reviewKey} has an invalid state`
				)
			}
		}
		entryBySceneId.set(entry.sceneId, entry)
		outputPaths.add(entry.outputPath)
	}

	if (expectedCount === PRIMARY_ASSET_COUNT) {
		validatePrimaryArtworkBatches(batches, manifest)
	} else if (
		batches.planId !== manifest.planId ||
		batches.batches.length === 0
	) {
		throw new Error("primary batch graph header is invalid")
	}

	const batchBySceneId = new Map<string, string>()
	for (const batch of batches.batches) {
		if (
			batch.sceneIds.length === 0 ||
			new Set(batch.sceneIds).size !== batch.sceneIds.length
		) {
			throw new Error(`${batch.id} has an invalid scene inventory`)
		}
		for (const sceneId of batch.sceneIds) {
			if (!entryBySceneId.has(sceneId)) {
				throw new Error(`${batch.id} binds unknown primary scene ${sceneId}`)
			}
			if (batchBySceneId.has(sceneId)) {
				throw new Error(`${sceneId} belongs to more than one primary batch`)
			}
			batchBySceneId.set(sceneId, batch.id)
		}
	}
	for (const sceneId of entryBySceneId.keys()) {
		if (!batchBySceneId.has(sceneId)) {
			throw new Error(`${sceneId} is missing a primary batch binding`)
		}
	}

	return {
		manifest,
		batches,
		normalizedBatches: batches.batches,
		entryBySceneId,
		batchBySceneId
	}
}

export const loadPrimaryPlan = async (options: {
	manifestPath?: string
	batchesPath?: string
	expectedCount?: number
} = {}) => {
	const manifestPath = options.manifestPath ?? PRIMARY_MANIFEST_PATH
	const batchesPath = options.batchesPath ?? PRIMARY_BATCHES_PATH
	const [manifest, batches] = await Promise.all([
		readFile(manifestPath, "utf8").then(
			(value) => JSON.parse(value) as PrimaryArtworkPlan
		),
		readFile(batchesPath, "utf8").then(
			(value) => JSON.parse(value) as PrimaryArtworkBatches
		)
	])
	return validatePrimaryPlan(
		manifest,
		batches,
		options.expectedCount ?? Number(PRIMARY_ASSET_COUNT)
	)
}

export const selectPrimaryEntries = (
	plan: PrimaryPlan,
	batchId: string,
	sceneIds: string[],
	all: boolean
) => {
	const batch = plan.normalizedBatches.find(({ id }) => id === batchId)
	if (!batch) throw new Error(`unknown primary batch: ${batchId}`)
	if (all === (sceneIds.length > 0)) {
		throw new Error("choose exactly one of --all or one or more --scene values")
	}
	if (new Set(sceneIds).size !== sceneIds.length) {
		throw new Error("--scene values must be unique")
	}
	const batchSceneIds = new Set(batch.sceneIds)
	const selectedIds = all ? batch.sceneIds : sceneIds
	return selectedIds.map((sceneId) => {
		if (!batchSceneIds.has(sceneId)) {
			throw new Error(`${sceneId} does not belong to ${batchId}`)
		}
		return plan.entryBySceneId.get(sceneId)!
	})
}
