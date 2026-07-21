import { access, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
	PRIMARY_HEIGHT,
	PRIMARY_IMAGE_GEN_CLI,
	PRIMARY_MAX_BYTES,
	PRIMARY_SOURCE_SIZE,
	PRIMARY_TARGET_BYTES,
	PRIMARY_WIDTH,
	primaryPrompt,
	sha256,
	type PrimaryManifestEntry
} from "./lobster-primary-art-contract.js"

export type PrimaryGenerationQuality = "low" | "medium"
export type PrimaryGenerationStatus =
	| "dry-run"
	| "generated"
	| "skipped"
	| "failed"

export type PrimaryGenerationResult = {
	schemaVersion: 1
	batchId: string
	sceneId: string
	outputPath: string
	status: PrimaryGenerationStatus
	model: "gpt-image-2"
	generatorPath: typeof PRIMARY_IMAGE_GEN_CLI
	requestedSize: typeof PRIMARY_SOURCE_SIZE
	quality: PrimaryGenerationQuality
	promptSha256: string
	generatedAt: string | null
	finalSha256: string | null
	finalBytes: number | null
	dimensions: {
		width: typeof PRIMARY_WIDTH
		height: typeof PRIMARY_HEIGHT
		format: "webp"
	}
	attempts: number
	error?: string
}

export type PrimaryImageInspection = {
	width: number
	height: number
	format: "WEBP"
	colorSpace: string
	bytes: number
	sha256: string
}

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : String(error)

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
	description: string,
	env?: Record<string, string | undefined>
) => {
	const child = Bun.spawn(command, {
		env,
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
			`${description} failed (${exitCode}): ${
				stderr.trim() || stdout.trim() || "no diagnostic output"
			}`
		)
	}
	return stdout.trim()
}

const assertRiffWebp = (bytes: Uint8Array, path: string) => {
	if (
		bytes.length < 12 ||
		new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" ||
		new TextDecoder().decode(bytes.subarray(8, 12)) !== "WEBP"
	) {
		throw new Error(`${path} is missing the RIFF/WEBP signature`)
	}
}

export const inspectPrimaryWebp = async (
	path: string
): Promise<PrimaryImageInspection> => {
	const [identity, bytes, fileStat] = await Promise.all([
		run(
			[
				"magick",
				"identify",
				"-format",
				"%m|%w|%h|%[colorspace]",
				path
			],
			`inspect ${path}`
		),
		readFile(path),
		stat(path)
	])
	assertRiffWebp(bytes, path)
	const [format, widthText, heightText, colorSpace] = identity.split("|")
	const width = Number(widthText)
	const height = Number(heightText)
	if (
		format !== "WEBP" ||
		width !== PRIMARY_WIDTH ||
		height !== PRIMARY_HEIGHT ||
		colorSpace.toLowerCase() !== "srgb" ||
		fileStat.size > PRIMARY_MAX_BYTES
	) {
		throw new Error(
			`${path} must be ${PRIMARY_WIDTH}x${PRIMARY_HEIGHT} sRGB WebP <= ${PRIMARY_MAX_BYTES} bytes; found ${identity}, ${fileStat.size} bytes`
		)
	}
	await run(["dwebp", path, "-quiet", "-o", "/dev/null"], `decode ${path}`)
	return {
		width,
		height,
		format: "WEBP",
		colorSpace,
		bytes: fileStat.size,
		sha256: sha256(bytes)
	}
}

const inspectGeneratedSource = async (path: string) => {
	const [identity, bytes] = await Promise.all([
		run(
			[
				"magick",
				"identify",
				"-format",
				"%m|%wx%h|%[colorspace]",
				path
			],
			`inspect generated source ${path}`
		),
		readFile(path)
	])
	assertRiffWebp(bytes, path)
	const [format, dimensions, colorSpace] = identity.split("|")
	if (
		format !== "WEBP" ||
		dimensions !== PRIMARY_SOURCE_SIZE ||
		colorSpace.toLowerCase() !== "srgb"
	) {
		throw new Error(
			`${path} must be ${PRIMARY_SOURCE_SIZE} sRGB WebP; found ${identity}`
		)
	}
}

const imageEnvironment = () => {
	const {
		OC_OPENAI_API_KEY,
		OPENAI_API_KEY: _ignoredOpenAiKey,
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

export const primaryImageCommand = (
	entry: PrimaryManifestEntry,
	sourcePath: string,
	quality: PrimaryGenerationQuality,
	dryRun: boolean
) => [
	"python",
	PRIMARY_IMAGE_GEN_CLI,
	"generate",
	"--model",
	"gpt-image-2",
	"--prompt",
	primaryPrompt(entry),
	"--size",
	PRIMARY_SOURCE_SIZE,
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

export const preflightPrimaryGeneration = async (dryRun = false) => {
	const requiredCommands = dryRun
		? (["python"] as const)
		: (["python", "magick", "cwebp", "dwebp"] as const)
	const missing = requiredCommands.filter((command) => !Bun.which(command))
	if (missing.length > 0) {
		throw new Error(`missing required commands: ${missing.join(", ")}`)
	}
	await access(PRIMARY_IMAGE_GEN_CLI)
}

const baseResult = (
	batchId: string,
	entry: PrimaryManifestEntry,
	quality: PrimaryGenerationQuality
) => ({
	schemaVersion: 1 as const,
	batchId,
	sceneId: entry.sceneId,
	outputPath: entry.outputPath,
	model: "gpt-image-2" as const,
	generatorPath: PRIMARY_IMAGE_GEN_CLI,
	requestedSize: PRIMARY_SOURCE_SIZE,
	quality,
	promptSha256: sha256(primaryPrompt(entry)),
	dimensions: {
		width: PRIMARY_WIDTH,
		height: PRIMARY_HEIGHT,
		format: "webp" as const
	}
})

export const dryRunPrimaryEntry = async (
	batchId: string,
	entry: PrimaryManifestEntry,
	quality: PrimaryGenerationQuality
): Promise<PrimaryGenerationResult> => {
	const sourcePath = `/tmp/hermit-lobster-primary-${entry.sceneId}.source.webp`
	await run(
		primaryImageCommand(entry, sourcePath, quality, true),
		`dry-run primary generation for ${entry.sceneId}`
	)
	return {
		...baseResult(batchId, entry, quality),
		status: "dry-run",
		generatedAt: null,
		finalSha256: null,
		finalBytes: null,
		attempts: 0
	}
}

const sleep = (milliseconds: number) =>
	new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

const generateSource = async (
	entry: PrimaryManifestEntry,
	sourcePath: string,
	quality: PrimaryGenerationQuality,
	maxAttempts: number
) => {
	const env = imageEnvironment()
	let lastError: unknown
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		await rm(sourcePath, { force: true })
		try {
			await run(
				primaryImageCommand(entry, sourcePath, quality, false),
				`generate ${entry.sceneId}, attempt ${attempt}`,
				env
			)
			await inspectGeneratedSource(sourcePath)
			return attempt
		} catch (error) {
			lastError = error
			if (attempt < maxAttempts) await sleep(2_000 * 2 ** (attempt - 1))
		}
	}
	throw lastError
}

const compressPrimaryAsset = async (
	sourcePath: string,
	normalizedPath: string,
	stagedPath: string
) => {
	await run(
		[
			"magick",
			sourcePath,
			"-resize",
			`${PRIMARY_WIDTH}x${PRIMARY_HEIGHT}!`,
			"-strip",
			"-colorspace",
			"sRGB",
			normalizedPath
		],
		`normalize ${sourcePath}`
	)
	await run(
		[
			"cwebp",
			"-quiet",
			"-mt",
			"-m",
			"6",
			"-size",
			String(PRIMARY_TARGET_BYTES),
			"-pass",
			"10",
			"-metadata",
			"icc",
			normalizedPath,
			"-o",
			stagedPath
		],
		`compress ${sourcePath}`
	)
	return inspectPrimaryWebp(stagedPath)
}

export const generatePrimaryEntry = async (
	batchId: string,
	entry: PrimaryManifestEntry,
	quality: PrimaryGenerationQuality,
	force = false,
	maxAttempts = 3
): Promise<PrimaryGenerationResult> => {
	if (!force && (await exists(entry.outputPath))) {
		try {
			const existing = await inspectPrimaryWebp(entry.outputPath)
			return {
				...baseResult(batchId, entry, quality),
				status: "skipped",
				generatedAt: null,
				finalSha256: existing.sha256,
				finalBytes: existing.bytes,
				attempts: 0
			}
		} catch {
			// Invalid existing files are replaced by a fresh generation.
		}
	}

	const scratchBase = resolve(
		"tmp/imagegen/lobster-primary",
		batchId,
		`${entry.sceneId}-${process.pid}`
	)
	const sourcePath = `${scratchBase}.source.webp`
	const normalizedPath = `${scratchBase}.normalized.png`
	const stagedPath = `${entry.outputPath}.tmp-${process.pid}`
	await Promise.all([
		mkdir(dirname(sourcePath), { recursive: true }),
		mkdir(dirname(entry.outputPath), { recursive: true })
	])
	await rm(stagedPath, { force: true })

	try {
		const attempts = await generateSource(
			entry,
			sourcePath,
			quality,
			maxAttempts
		)
		const final = await compressPrimaryAsset(
			sourcePath,
			normalizedPath,
			stagedPath
		)
		await rename(stagedPath, entry.outputPath)
		return {
			...baseResult(batchId, entry, quality),
			status: "generated",
			generatedAt: new Date().toISOString(),
			finalSha256: final.sha256,
			finalBytes: final.bytes,
			attempts
		}
	} finally {
		await Promise.all([
			rm(sourcePath, { force: true }),
			rm(normalizedPath, { force: true }),
			rm(stagedPath, { force: true })
		])
	}
}

export const failedPrimaryGenerationResult = (
	batchId: string,
	entry: PrimaryManifestEntry,
	quality: PrimaryGenerationQuality,
	error: unknown
): PrimaryGenerationResult => ({
	...baseResult(batchId, entry, quality),
	status: "failed",
	generatedAt: null,
	finalSha256: null,
	finalBytes: null,
	attempts: 0,
	error: describeError(error)
})
