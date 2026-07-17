import { createHash } from "node:crypto"
import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	stat
} from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import {
	buildExecutionPrompt,
	loadRemediationRegistry,
	remediationByScene,
	sha256 as evidenceSha256,
	type RemediationBinding,
	type RemediationEntry
} from "./lobster-art-evidence.js"

export const LOBSTER_ART_MANIFEST_PATH =
	"data/lobster/artwork/manifest.json" as const
export const LOBSTER_ART_BATCHES_PATH =
	"data/lobster/artwork/batches.json" as const
export const IMAGE_GEN_CLI =
	"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py" as const
export const SOURCE_SIZE = "1536x1024" as const
export const FINAL_WIDTH = 768 as const
export const FINAL_HEIGHT = 512 as const
export const MAX_FINAL_BYTES = 122_880 as const
export const TARGET_FINAL_BYTES = 75_000 as const

type ManifestEntry = {
	sceneId: string
	AphiaID: number
	finalPrompt: string
	promptVersion: string
	promptSha256: string
	outputPath: string
	outputSha256: string | null
	outputBytes: number | null
	status: string
	dimensions: {
		width: number
		height: number
		format: string
	}
}

type ArtworkManifest = {
	schemaVersion: number
	planId: string
	promptVersion: string
	output: {
		root: string
		format: string
		width: number
		height: number
	}
	entries: ManifestEntry[]
}

type ArtworkBatches = {
	schemaVersion: number
	planId: string
	batches: Array<{
		id: string
		sceneCount: number
		species: Array<{
			AphiaID: number
			sceneIds: string[]
		}>
	}>
}

export type GenerationQuality = "low" | "medium"

export type GenerationSelection = {
	batchId: string
	sceneIds: string[]
}

export type GenerationResult = {
	batchId: string
	sceneId: string
	AphiaID: number
	outputPath: string
	status: "dry-run" | "generated" | "skipped" | "failed"
	model: "gpt-image-2"
	generatorPath: typeof IMAGE_GEN_CLI
	requestedSize: typeof SOURCE_SIZE
	quality: GenerationQuality
	sourceOutput: {
		format: "webp"
		compression: 100
	}
	promptVersion: string
	promptSha256: string
	executionPromptSha256: string
	remediation: RemediationBinding | null
	generatedAt: string | null
	finalSha256: string | null
	finalBytes: number | null
	dimensions: {
		width: typeof FINAL_WIDTH
		height: typeof FINAL_HEIGHT
		format: "webp"
	}
	compression: {
		codec: "cwebp"
		targetBytes: typeof TARGET_FINAL_BYTES
		maximumBytes: typeof MAX_FINAL_BYTES
	}
	skipValidation?: {
		expectedChecksumAvailable: boolean
	}
	attempts: number
	error?: string
}

export type GenerationPlan = {
	manifest: ArtworkManifest
	batches: ArtworkBatches
	batchId: string
	entries: ManifestEntry[]
	remediations: Map<string, RemediationEntry>
}

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : String(error)

const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex")

const exists = async (path: string) => {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

const run = async (
	command: string[],
	options: {
		description: string
		env?: Record<string, string | undefined>
	}
) => {
	const child = Bun.spawn(command, {
		env: options.env,
		stdout: "pipe",
		stderr: "pipe"
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	if (exitCode !== 0) {
		throw new Error(
			`${options.description} failed (${exitCode}): ${
				stderr.trim() || stdout.trim() || "no diagnostic output"
			}`
		)
	}
	return stdout.trim()
}

const assertSafeRepositoryPath = (path: string, expectedRoot: string) => {
	const absolutePath = resolve(path)
	const absoluteRoot = resolve(expectedRoot)
	const fromRoot = relative(absoluteRoot, absolutePath)
	if (
		fromRoot === "" ||
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`)
	) {
		throw new Error(`${path} is outside ${expectedRoot}`)
	}
}

const validatePlanIdentity = (
	manifest: ArtworkManifest,
	batches: ArtworkBatches
) => {
	if (
		manifest.schemaVersion !== 1 ||
		batches.schemaVersion !== 1 ||
		manifest.planId !== "LOB-ART-PLAN-v1" ||
		batches.planId !== manifest.planId ||
		manifest.output.root !== "assets/lobster/scenes" ||
		manifest.output.format !== "webp" ||
		manifest.output.width !== FINAL_WIDTH ||
		manifest.output.height !== FINAL_HEIGHT
	) {
		throw new Error("Unexpected lobster artwork plan identity")
	}
	if (manifest.entries.length !== 1_056) {
		throw new Error(
			`Expected 1056 manifest entries, found ${manifest.entries.length}`
		)
	}
}

export const loadGenerationPlan = async (
	selection: GenerationSelection
): Promise<GenerationPlan> => {
	const [manifest, batches] = await Promise.all([
		readFile(LOBSTER_ART_MANIFEST_PATH, "utf8").then(
			(value) => JSON.parse(value) as ArtworkManifest
		),
		readFile(LOBSTER_ART_BATCHES_PATH, "utf8").then(
			(value) => JSON.parse(value) as ArtworkBatches
		)
	])
	const remediation = await loadRemediationRegistry()
	validatePlanIdentity(manifest, batches)

	const batch = batches.batches.find(({ id }) => id === selection.batchId)
	if (!batch) {
		throw new Error(`Unknown artwork batch: ${selection.batchId}`)
	}
	const batchSceneIds = new Set(
		batch.species.flatMap(({ sceneIds }) => sceneIds)
	)
	if (
		batchSceneIds.size !== batch.sceneCount ||
		batchSceneIds.size === 0
	) {
		throw new Error(`${batch.id} has an invalid scene inventory`)
	}

	const requestedSceneIds =
		selection.sceneIds.length > 0
			? new Set(selection.sceneIds)
			: batchSceneIds
	for (const sceneId of requestedSceneIds) {
		if (!batchSceneIds.has(sceneId)) {
			throw new Error(`${sceneId} does not belong to ${batch.id}`)
		}
	}

	const entriesById = new Map(
		manifest.entries.map((entry) => [entry.sceneId, entry])
	)
	const entries = [...requestedSceneIds].map((sceneId) => {
		const entry = entriesById.get(sceneId)
		if (!entry) {
			throw new Error(`Manifest entry is missing for ${sceneId}`)
		}
		if (
			entry.dimensions.width !== FINAL_WIDTH ||
			entry.dimensions.height !== FINAL_HEIGHT ||
			entry.dimensions.format !== "webp" ||
			entry.outputPath !==
				`${manifest.output.root}/${entry.AphiaID}/${entry.sceneId}.webp`
		) {
			throw new Error(`${sceneId} has an invalid output contract`)
		}
		assertSafeRepositoryPath(entry.outputPath, manifest.output.root)
		return entry
	})

	return {
		manifest,
		batches,
		batchId: batch.id,
		entries,
		remediations: remediationByScene(remediation)
	}
}

const inspectWebp = async (path: string) => {
	const [dimensions, bytes, contents] = await Promise.all([
		run(
			[
				"magick",
				"identify",
				"-format",
				"%m|%wx%h|%[colorspace]",
				path
			],
			{ description: `inspect ${path}` }
		),
		stat(path).then(({ size }) => size),
		readFile(path)
	])
	const [format, size, colorSpace] = dimensions.split("|")
	const riffWebp =
		contents.length >= 12 &&
		contents.subarray(0, 4).toString("ascii") === "RIFF" &&
		contents.subarray(8, 12).toString("ascii") === "WEBP"
	if (
		format !== "WEBP" ||
		size !== `${FINAL_WIDTH}x${FINAL_HEIGHT}` ||
		colorSpace.toLowerCase() !== "srgb" ||
		!riffWebp ||
		bytes > MAX_FINAL_BYTES
	) {
		throw new Error(
			`Invalid final WebP ${path}: ${dimensions}, ${bytes} bytes, RIFF=${riffWebp}`
		)
	}
	await run(["dwebp", path, "-quiet", "-o", "/dev/null"], {
		description: `decode ${path}`
	})
	return {
		bytes,
		sha256: sha256(contents)
	}
}

const inspectSourceWebp = async (path: string) => {
	const [identity, contents] = await Promise.all([
		run(
			[
				"magick",
				"identify",
				"-format",
				"%m|%wx%h|%[colorspace]",
				path
			],
			{ description: `inspect generated source ${path}` }
		),
		readFile(path)
	])
	const [format, dimensions, colorSpace] = identity.split("|")
	const riffWebp =
		contents.length >= 12 &&
		contents.subarray(0, 4).toString("ascii") === "RIFF" &&
		contents.subarray(8, 12).toString("ascii") === "WEBP"
	if (
		format !== "WEBP" ||
		dimensions !== SOURCE_SIZE ||
		colorSpace.toLowerCase() !== "srgb" ||
		!riffWebp
	) {
		throw new Error(
			`Invalid generated source ${path}: ${identity}, RIFF=${riffWebp}`
		)
	}
}

const validExistingOutput = async (entry: ManifestEntry) => {
	if (!(await exists(entry.outputPath))) {
		return null
	}
	try {
		const inspected = await inspectWebp(entry.outputPath)
		if (
			entry.outputSha256 !== null &&
			inspected.sha256 !== entry.outputSha256
		) {
			return null
		}
		if (
			entry.outputBytes !== null &&
			inspected.bytes !== entry.outputBytes
		) {
			return null
		}
		return inspected
	} catch {
		return null
	}
}

const imageCliEnvironment = () => {
	const {
		OC_OPENAI_API_KEY,
		OPENAI_API_KEY: _openAiApiKey,
		...environment
	} = Bun.env
	if (!OC_OPENAI_API_KEY) {
		throw new Error("OC_OPENAI_API_KEY is not set")
	}
	return {
		...environment,
		OPENAI_API_KEY: OC_OPENAI_API_KEY
	}
}

const imageCliCommand = (
	entry: ManifestEntry,
	remediation: RemediationEntry | null,
	sourcePath: string,
	quality: GenerationQuality,
	dryRun: boolean
) => [
	"python",
	IMAGE_GEN_CLI,
	"generate",
	"--model",
	"gpt-image-2",
	"--prompt",
	buildExecutionPrompt(entry, remediation),
	"--size",
	SOURCE_SIZE,
	"--quality",
	quality,
	"--output-format",
	"webp",
	"--output-compression",
	"100",
	"--out",
	sourcePath,
	"--no-augment",
	...(dryRun ? ["--dry-run"] : [])
]

export const preflightGenerationTools = async () => {
	const requiredCommands = ["python", "magick", "cwebp", "dwebp"] as const
	const missing = requiredCommands.filter((command) => !Bun.which(command))
	if (missing.length > 0) {
		throw new Error(`Missing required commands: ${missing.join(", ")}`)
	}
	await access(IMAGE_GEN_CLI)
}

export const dryRunEntry = async (
	batchId: string,
	entry: ManifestEntry,
	remediation: RemediationEntry | null,
	quality: GenerationQuality
): Promise<GenerationResult> => {
	const sourcePath = `/tmp/hermit-lobster-${entry.sceneId}.source.webp`
	await run(imageCliCommand(entry, remediation, sourcePath, quality, true), {
		description: `dry-run image generation for ${entry.sceneId}`
	})
	return {
		batchId,
		sceneId: entry.sceneId,
		AphiaID: entry.AphiaID,
		outputPath: entry.outputPath,
		status: "dry-run",
		model: "gpt-image-2",
		generatorPath: IMAGE_GEN_CLI,
		requestedSize: SOURCE_SIZE,
		quality,
		sourceOutput: {
			format: "webp",
			compression: 100
		},
		promptVersion: entry.promptVersion,
		promptSha256: entry.promptSha256,
		executionPromptSha256: evidenceSha256(
			buildExecutionPrompt(entry, remediation)
		),
		remediation: remediation
			? {
					id: remediation.id,
					version: remediation.version,
					sha256: remediation.sha256
				}
			: null,
		generatedAt: null,
		finalSha256: null,
		finalBytes: null,
		dimensions: {
			width: FINAL_WIDTH,
			height: FINAL_HEIGHT,
			format: "webp"
		},
		compression: {
			codec: "cwebp",
			targetBytes: TARGET_FINAL_BYTES,
			maximumBytes: MAX_FINAL_BYTES
		},
		attempts: 0
	}
}

const sleep = (milliseconds: number) =>
	new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

const generateSourceWithRetry = async (
	entry: ManifestEntry,
	remediation: RemediationEntry | null,
	sourcePath: string,
	quality: GenerationQuality,
	maxAttempts: number
) => {
	const environment = imageCliEnvironment()
	let lastError: unknown
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		await rm(sourcePath, { force: true })
		try {
			await run(imageCliCommand(entry, remediation, sourcePath, quality, false), {
				description: `generate ${entry.sceneId}, attempt ${attempt}`,
				env: environment
			})
			await inspectSourceWebp(sourcePath)
			return attempt
		} catch (error) {
			lastError = error
			if (attempt < maxAttempts) {
				await sleep(2_000 * 2 ** (attempt - 1))
			}
		}
	}
	throw lastError
}

const compressFinal = async (
	sourcePath: string,
	normalizedPath: string,
	stagedPath: string
) => {
	await run(
		[
			"magick",
			sourcePath,
			"-resize",
			`${FINAL_WIDTH}x${FINAL_HEIGHT}!`,
			"-strip",
			"-colorspace",
			"sRGB",
			normalizedPath
		],
		{ description: `normalize ${sourcePath}` }
	)
	await run(
		[
			"cwebp",
			"-quiet",
			"-mt",
			"-m",
			"6",
			"-size",
			TARGET_FINAL_BYTES.toString(),
			"-pass",
			"10",
			"-metadata",
			"icc",
			normalizedPath,
			"-o",
			stagedPath
		],
		{ description: `compress ${sourcePath}` }
	)
	return inspectWebp(stagedPath)
}

export const generateEntry = async (
	batchId: string,
	entry: ManifestEntry,
	remediation: RemediationEntry | null,
	quality: GenerationQuality,
	maxAttempts: number,
	force = false
): Promise<GenerationResult> => {
	const existing = force ? null : await validExistingOutput(entry)
	if (existing) {
		return {
			batchId,
			sceneId: entry.sceneId,
			AphiaID: entry.AphiaID,
			outputPath: entry.outputPath,
			status: "skipped",
			model: "gpt-image-2",
			generatorPath: IMAGE_GEN_CLI,
			requestedSize: SOURCE_SIZE,
			quality,
			sourceOutput: {
				format: "webp",
				compression: 100
			},
			promptVersion: entry.promptVersion,
			promptSha256: entry.promptSha256,
			executionPromptSha256: evidenceSha256(
				buildExecutionPrompt(entry, remediation)
			),
			remediation: remediation
				? {
						id: remediation.id,
						version: remediation.version,
						sha256: remediation.sha256
					}
				: null,
			generatedAt: null,
			finalSha256: existing.sha256,
			finalBytes: existing.bytes,
			dimensions: {
				width: FINAL_WIDTH,
				height: FINAL_HEIGHT,
				format: "webp"
			},
			compression: {
				codec: "cwebp",
				targetBytes: TARGET_FINAL_BYTES,
				maximumBytes: MAX_FINAL_BYTES
			},
			skipValidation: {
				expectedChecksumAvailable: entry.outputSha256 !== null
			},
			attempts: 0
		}
	}

	const scratchRoot = resolve(
		"tmp/imagegen/lobster",
		batchId,
		`${entry.sceneId}-${process.pid}`
	)
	const sourcePath = `${scratchRoot}.source.webp`
	const normalizedPath = `${scratchRoot}.normalized.png`
	const stagedPath = `${entry.outputPath}.tmp-${process.pid}`
	await mkdir(dirname(sourcePath), { recursive: true })
	await mkdir(dirname(entry.outputPath), { recursive: true })
	await rm(stagedPath, { force: true })

	try {
		const attempts = await generateSourceWithRetry(
			entry,
			remediation,
			sourcePath,
			quality,
			maxAttempts
		)
		const inspected = await compressFinal(
			sourcePath,
			normalizedPath,
			stagedPath
		)
		await rename(stagedPath, entry.outputPath)
		return {
			batchId,
			sceneId: entry.sceneId,
			AphiaID: entry.AphiaID,
			outputPath: entry.outputPath,
			status: "generated",
			model: "gpt-image-2",
			generatorPath: IMAGE_GEN_CLI,
			requestedSize: SOURCE_SIZE,
			quality,
			sourceOutput: {
				format: "webp",
				compression: 100
			},
			promptVersion: entry.promptVersion,
			promptSha256: entry.promptSha256,
			executionPromptSha256: evidenceSha256(
				buildExecutionPrompt(entry, remediation)
			),
			remediation: remediation
				? {
						id: remediation.id,
						version: remediation.version,
						sha256: remediation.sha256
					}
				: null,
			generatedAt: new Date().toISOString(),
			finalSha256: inspected.sha256,
			finalBytes: inspected.bytes,
			dimensions: {
				width: FINAL_WIDTH,
				height: FINAL_HEIGHT,
				format: "webp"
			},
			compression: {
				codec: "cwebp",
				targetBytes: TARGET_FINAL_BYTES,
				maximumBytes: MAX_FINAL_BYTES
			},
			attempts
		}
	} catch (error) {
		await rm(stagedPath, { force: true })
		throw new Error(`${entry.sceneId}: ${describeError(error)}`)
	} finally {
		await Promise.all([
			rm(sourcePath, { force: true }),
			rm(normalizedPath, { force: true })
		])
	}
}

export const failedGenerationResult = (
	batchId: string,
	entry: ManifestEntry,
	remediation: RemediationEntry | null,
	quality: GenerationQuality,
	maxAttempts: number,
	error: unknown
): GenerationResult => ({
	batchId,
	sceneId: entry.sceneId,
	AphiaID: entry.AphiaID,
	outputPath: entry.outputPath,
	status: "failed",
	model: "gpt-image-2",
	generatorPath: IMAGE_GEN_CLI,
	requestedSize: SOURCE_SIZE,
	quality,
	sourceOutput: {
		format: "webp",
		compression: 100
	},
	promptVersion: entry.promptVersion,
	promptSha256: entry.promptSha256,
	executionPromptSha256: evidenceSha256(
		buildExecutionPrompt(entry, remediation)
	),
	remediation: remediation
		? {
				id: remediation.id,
				version: remediation.version,
				sha256: remediation.sha256
			}
		: null,
	generatedAt: null,
	finalSha256: null,
	finalBytes: null,
	dimensions: {
		width: FINAL_WIDTH,
		height: FINAL_HEIGHT,
		format: "webp"
	},
	compression: {
		codec: "cwebp",
		targetBytes: TARGET_FINAL_BYTES,
		maximumBytes: MAX_FINAL_BYTES
	},
	attempts: maxAttempts,
	error: describeError(error)
})
