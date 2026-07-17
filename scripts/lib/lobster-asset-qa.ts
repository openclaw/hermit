import { createHash } from "node:crypto"
import {
	access,
	mkdir,
	readFile,
	readdir,
	stat,
	writeFile
} from "node:fs/promises"
import { basename, dirname, relative, resolve, sep } from "node:path"
import type {
	ArtworkBatchGraph,
	ArtworkManifest,
	ArtworkManifestEntry
} from "./lobster-artwork-plan.js"
import {
	GENERATION_RESULTS_PATH,
	REMEDIATION_PATH,
	type DurableGenerationRecord,
	type GenerationResultsLedger,
	loadRemediationRegistry,
	remediationByScene,
	validateTrackedLedger
} from "./lobster-art-evidence.js"
import type {
	LobsterActionId,
	LobsterMetadataDataset,
	LobsterMetadataRecord
} from "./lobster-metadata.js"

export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 5
export const MAX_ASSET_BYTES = 122_880
export const MAX_AVERAGE_BYTES = 75_000

type QaStatus = "pass" | "fail" | "pending"

export type QaCriterion = {
	id: string
	status: QaStatus
	summary: string
	details?: string[]
}

export type GenerationLogRecord = {
	batchId?: string
	sceneId: string
	AphiaID?: number
	outputPath?: string
	status: "dry-run" | "generated" | "skipped" | "failed"
	promptVersion?: string
	promptSha256?: string
	generatedAt?: string | null
	finalSha256?: string | null
	finalBytes?: number | null
	dimensions?: {
		width?: number
		height?: number
		format?: string
	}
	error?: string
}

type OrderedGenerationRecord = GenerationLogRecord & {
	logPath: string
	line: number
	order: number
}

export type AssetInventoryEntry = {
	sceneId: string
	AphiaID: number
	path: string
	bytes: number
	sha256: string
	dHash64: string
	width: number
	height: number
	format: string
	colorSpace: string
	provenance: {
		status: "generated"
		ledgerPath: string
		generatedAt: string
	} | null
}

export type DuplicatePair = {
	leftSceneId: string
	rightSceneId: string
	distance: number
}

export type LobsterAssetQaReport = {
	schemaVersion: 1
	generatedAt: string
	mode: "partial" | "strict"
	passed: boolean
	configuration: {
		manifestPath: string
		batchesPath: string
		metadataPath: string
		assetsRoot: string
		generationResultsPath: string
		remediationPath: string
		expectedWidth: number
		expectedHeight: number
		maximumBytes: number
		maximumAverageBytes: number
		perceptualHash: {
			algorithm: string
			bits: number
			nearDuplicateHammingThreshold: number
			failureRule: string
		}
	}
	summary: {
		manifestEntries: number
		presentAssets: number
		missingAssets: number
		extraFiles: number
		totalBytes: number
		averageBytes: number | null
		exactDuplicatePairs: number
		nearDuplicatePairs: number
	}
	criteria: QaCriterion[]
	missingSceneIds: string[]
	extraFiles: string[]
	inventory: AssetInventoryEntry[]
	exactDuplicates: DuplicatePair[]
	nearDuplicates: DuplicatePair[]
	generationResults: {
		path: string
		unresolvedFailures: Array<{
			sceneId: string
			error: string | null
		}>
	}
	humanReview: {
		scientificAnatomy: "pending"
		finalArt: "pending"
		note: string
	}
}

export type RunLobsterAssetQaOptions = {
	mode: "partial" | "strict"
	reportPath?: string
	manifestPath?: string
	batchesPath?: string
	metadataPath?: string
	assetsRoot?: string
	generationResultsPath?: string
	remediationPath?: string
	nearDuplicateThreshold?: number
	concurrency?: number
	magickCommand?: string
	dwebpCommand?: string
}

type ImageInspection = {
	width: number
	height: number
	format: string
	colorSpace: string
	dHash64: string
}

const actionCapability: Partial<
	Record<
		LobsterActionId,
		keyof LobsterMetadataRecord["capabilities"]
	>
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

const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

const exists = async (path: string) => {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

const normalizePath = (path: string) => path.split(sep).join("/")

const readJson = async <T>(path: string): Promise<T> =>
	JSON.parse(await readFile(path, "utf8")) as T

const listFiles = async (root: string): Promise<string[]> => {
	if (!(await exists(root))) return []
	const entries = await readdir(root, {
		recursive: true,
		withFileTypes: true
	})
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => resolve(entry.parentPath, entry.name))
		.sort()
}

const runCommand = async (
	command: string[],
	options: { binary?: boolean } = {}
) => {
	const child = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe"
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		options.binary
			? new Response(child.stdout).bytes()
			: new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	if (exitCode !== 0) {
		throw new Error(
			`${command[0]} failed (${exitCode}): ${
				stderr.trim() || "no diagnostic output"
			}`
		)
	}
	return stdout
}

const bytesToDHash = (pixels: Uint8Array) => {
	if (pixels.length !== 72) {
		throw new Error(`dHash expected 72 grayscale pixels, received ${pixels.length}`)
	}
	let hash = 0n
	let bit = 0n
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			if (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]!) {
				hash |= 1n << bit
			}
			bit += 1n
		}
	}
	return hash.toString(16).padStart(16, "0")
}

export const hammingDistance64 = (left: string, right: string) => {
	let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
	let count = 0
	while (value !== 0n) {
		value &= value - 1n
		count += 1
	}
	return count
}

const assertRiffWebp = (bytes: Uint8Array) => {
	if (
		bytes.length < 12 ||
		new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" ||
		new TextDecoder().decode(bytes.subarray(8, 12)) !== "WEBP"
	) {
		throw new Error("missing RIFF/WEBP signature")
	}
	const declaredSize = new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength
	).getUint32(4, true)
	if (declaredSize + 8 !== bytes.length) {
		throw new Error(
			`RIFF size mismatch: header declares ${declaredSize + 8}, file has ${bytes.length}`
		)
	}
}

export const inspectWebp = async (
	path: string,
	options: {
		magickCommand?: string
		dwebpCommand?: string
	} = {}
): Promise<ImageInspection> => {
	const bytes = await readFile(path)
	assertRiffWebp(bytes)
	await runCommand([
		options.dwebpCommand ?? "dwebp",
		path,
		"-o",
		"/dev/null"
	])
	const metadata = (await runCommand([
		options.magickCommand ?? "magick",
		"identify",
		"-format",
		"%w\t%h\t%m\t%[colorspace]",
		path
	])) as string
	const [widthText, heightText, format, colorSpace] = metadata.trim().split("\t")
	if (
		!widthText ||
		!heightText ||
		!format ||
		!colorSpace ||
		!Number.isFinite(Number(widthText)) ||
		!Number.isFinite(Number(heightText))
	) {
		throw new Error(`could not parse ImageMagick metadata: ${metadata.trim()}`)
	}
	const pixels = (await runCommand(
		[
			options.magickCommand ?? "magick",
			path,
			"-auto-orient",
			"-colorspace",
			"sRGB",
			"-resize",
			"9x8!",
			"-colorspace",
			"Gray",
			"-depth",
			"8",
			"gray:-"
		],
		{ binary: true }
	)) as Uint8Array
	return {
		width: Number(widthText),
		height: Number(heightText),
		format: format ?? "",
		colorSpace: colorSpace ?? "",
		dHash64: bytesToDHash(pixels)
	}
}

const mapLimit = async <T, R>(
	values: T[],
	limit: number,
	mapper: (value: T, index: number) => Promise<R>
) => {
	const results = new Array<R>(values.length)
	let nextIndex = 0
	const worker = async () => {
		while (nextIndex < values.length) {
			const index = nextIndex
			nextIndex += 1
			results[index] = await mapper(values[index]!, index)
		}
	}
	await Promise.all(
		Array.from(
			{ length: Math.min(Math.max(1, limit), values.length || 1) },
			worker
		)
	)
	return results
}

export const readGenerationLogs = async (root: string) => {
	const files = await Promise.all(
		(await listFiles(root))
			.filter((path) => path.endsWith(".jsonl"))
			.map(async (path) => ({
				path,
				mtimeMs: (await stat(path)).mtimeMs
			}))
	).then((entries) =>
		entries.sort(
			(left, right) =>
				left.mtimeMs - right.mtimeMs ||
				left.path.localeCompare(right.path)
		)
	)
	const records: OrderedGenerationRecord[] = []
	const malformedLines: string[] = []
	let order = 0
	for (const { path } of files) {
		const relativePath = normalizePath(relative(process.cwd(), path))
		const contents = await readFile(path, "utf8")
		for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
			const line = rawLine.trim()
			if (!line) continue
			order += 1
			try {
				const parsed = JSON.parse(line) as GenerationLogRecord
				if (
					typeof parsed.sceneId !== "string" ||
					!["dry-run", "generated", "skipped", "failed"].includes(
						parsed.status
					)
				) {
					throw new Error("invalid generation record shape")
				}
				records.push({
					...parsed,
					logPath: relativePath,
					line: index + 1,
					order
				})
			} catch (error) {
				malformedLines.push(
					`${relativePath}:${index + 1}: ${
						error instanceof Error ? error.message : String(error)
					}`
				)
			}
		}
	}
	return {
		filesRead: files.map(({ path }) =>
			normalizePath(relative(process.cwd(), path))
		),
		records,
		malformedLines
	}
}

export const resolveLatestSuccessfulProvenance = (
	records: OrderedGenerationRecord[]
) => {
	const byScene = Map.groupBy(records, (record) => record.sceneId)
	const successful = new Map<string, OrderedGenerationRecord>()
	const unresolvedFailures: OrderedGenerationRecord[] = []
	for (const [sceneId, sceneRecords] of byScene) {
		const ordered = [...sceneRecords].sort((left, right) => left.order - right.order)
		const latestSuccess = ordered
			.filter(
				(record) =>
					record.status === "generated" || record.status === "skipped"
			)
			.at(-1)
		if (latestSuccess) successful.set(sceneId, latestSuccess)
		const latestTerminal = ordered
			.filter((record) => record.status !== "dry-run")
			.at(-1)
		if (
			latestTerminal?.status === "failed" &&
			(!latestSuccess || latestSuccess.order < latestTerminal.order)
		) {
			unresolvedFailures.push(latestTerminal)
		}
	}
	return { successful, unresolvedFailures }
}

const quotaReport = (manifest: ArtworkManifest) => {
	const entries = manifest.entries
	const maxBucket = (values: string[]) => {
		const counts = new Map<string, number>()
		for (const value of values) {
			counts.set(value, (counts.get(value) ?? 0) + 1)
		}
		const [id, count] = [...counts.entries()].sort(
			(left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
		)[0] ?? ["", 0]
		return { id, count, share: entries.length === 0 ? 0 : count / entries.length }
	}
	const humanScenes = entries.filter((entry) => entry.cast.kind === "human")
	const prominentWomanScenes = humanScenes.filter((entry) =>
		entry.cast.adults.some(
			(adult) =>
				adult.adultStatus === "adult" &&
				adult.genderPresentation === "woman" &&
				adult.prominence === "prominent"
		)
	)
	return {
		medium: maxBucket(entries.map((entry) => entry.medium)),
		environment: maxBucket(
			entries.map((entry) => entry.environmentFamily)
		),
		officeShare:
			entries.filter((entry) =>
				/office|boardroom|hearing/.test(entry.environment)
			).length / entries.length,
		cast: maxBucket(entries.map((entry) => entry.cast.id)),
		prominentWomanHumanShare:
			prominentWomanScenes.length / humanScenes.length,
		nonPhotorealisticShare:
			entries.filter(
				(entry) => entry.mediumKind === "non-photorealistic"
			).length / entries.length
	}
}

const expectedEvidence = (
	entry: ArtworkManifestEntry,
	record: LobsterMetadataRecord
) => {
	const permitted = record.permittedActions.find(
		(action) => action.id === entry.action.id
	)
	if (!permitted) return null
	const capabilityName = actionCapability[entry.action.id]
	if (!capabilityName) {
		return {
			evidenceScope: permitted.reason,
			citationIds: record.broadBodyPlan.citationIds
		}
	}
	const capability = record.capabilities[capabilityName]
	if (capability.value !== true) return null
	return {
		evidenceScope: capability.evidenceScope,
		citationIds: capability.citationIds
	}
}

const validateManifestMetadata = (
	manifest: ArtworkManifest,
	metadata: LobsterMetadataDataset
) => {
	const problems: string[] = []
	const metadataByAphiaId = new Map(
		metadata.records.map((record) => [record.AphiaID, record])
	)
	for (const entry of manifest.entries) {
		const record = metadataByAphiaId.get(entry.AphiaID)
		if (!record) {
			problems.push(`${entry.sceneId}: metadata record is missing`)
			continue
		}
		const scene = record.scenePlans.find((candidate) => candidate.id === entry.sceneId)
		const evidence = expectedEvidence(entry, record)
		const citationRegistry = new Set(
			record.scientificCitations.map((citation) => citation.id)
		)
		if (!evidence) {
			problems.push(`${entry.sceneId}: action ${entry.action.id} is not permitted`)
		} else if (
			entry.action.evidenceScope !== evidence.evidenceScope ||
			JSON.stringify(entry.action.citationIds) !==
				JSON.stringify(evidence.citationIds) ||
			entry.action.citationIds.length === 0 ||
			entry.action.citationIds.some((id) => !citationRegistry.has(id))
		) {
			problems.push(`${entry.sceneId}: action evidence/citations do not match metadata`)
		}
		if (
			!entry.finalPrompt ||
			entry.promptSha256 !== sha256(entry.finalPrompt) ||
			entry.promptVersion !== manifest.promptVersion
		) {
			problems.push(`${entry.sceneId}: prompt hash/version is invalid`)
		}
		if (!scene || !entry.altText.trim() || entry.altText !== scene.altText) {
			problems.push(`${entry.sceneId}: alt text is missing or differs from metadata`)
		}
		if (
			entry.reviews.scientificAnatomy.approver !== "Peter Steinberger" ||
			entry.reviews.scientificAnatomy.status !== "not-reviewed" ||
			entry.reviews.scientificAnatomy.reviewedAt !== null ||
			entry.reviews.finalArt.approver !== "Hannes Rudolph" ||
			entry.reviews.finalArt.status !== "not-reviewed" ||
			entry.reviews.finalArt.reviewedAt !== null
		) {
			problems.push(`${entry.sceneId}: human review state is not pending`)
		}
	}
	return problems
}

const validateBatchGraph = (
	manifest: ArtworkManifest,
	batches: ArtworkBatchGraph
) => {
	const expected = manifest.entries
		.map((entry) => entry.sceneId)
		.sort()
	const actual = batches.batches
		.flatMap((batch) =>
			batch.species.flatMap((species) => species.sceneIds)
		)
		.sort()
	const problems: string[] = []
	if (
		manifest.output.root !== "assets/lobster/scenes" ||
		manifest.output.pathTemplate !==
			"assets/lobster/scenes/{aphiaId}/{sceneId}.webp"
	) {
		problems.push("manifest output root/template violates the repository contract")
	}
	if (
		manifest.deliveryContract.architecture !== "repository-assets" ||
		manifest.deliveryContract.git.repository !== "openclaw/hermit" ||
		manifest.deliveryContract.git.assetPathTemplate !==
			manifest.output.pathTemplate ||
		manifest.deliveryContract.rawGitHub.origin !==
			"https://raw.githubusercontent.com" ||
		manifest.deliveryContract.rawGitHub.urlTemplate !==
			"https://raw.githubusercontent.com/openclaw/hermit/{gitCommitSha}/assets/lobster/scenes/{aphiaId}/{sceneId}.webp"
	) {
		problems.push("manifest delivery contract is not exact repository delivery")
	}
	for (const entry of manifest.entries) {
		if (
			entry.outputPath !==
			`assets/lobster/scenes/${entry.AphiaID}/${entry.sceneId}.webp`
		) {
			problems.push(`${entry.sceneId}: output path violates the path contract`)
		}
	}
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		problems.push("batch scene inventory does not exactly match manifest")
	}
	for (const batch of batches.batches) {
		const sceneCount = batch.species.reduce(
			(total, species) => total + species.sceneIds.length,
			0
		)
		if (
			batch.speciesCount !== batch.species.length ||
			batch.sceneCount !== sceneCount
		) {
			problems.push(`${batch.id}: declared counts do not match members`)
		}
	}
	return problems
}

const criterion = (
	id: string,
	status: QaStatus,
	summary: string,
	details: string[] = []
): QaCriterion => ({
	id,
	status,
	summary,
	...(details.length > 0 ? { details } : {})
})

const validateProvenance = (
	entry: ArtworkManifestEntry,
	inventory: Omit<AssetInventoryEntry, "provenance">,
	record: DurableGenerationRecord | undefined
) => {
	if (!record) return "no tracked generated result"
	if (record.outputPath !== entry.outputPath) return "logged output path differs"
	if (record.promptSha256 !== entry.promptSha256) return "logged prompt hash differs"
	if (record.promptVersion !== entry.promptVersion) return "logged prompt version differs"
	if (record.finalSha256 !== inventory.sha256) return "logged final SHA-256 differs"
	if (record.finalBytes !== inventory.bytes) return "logged final byte count differs"
	if (
		record.dimensions?.width !== entry.dimensions.width ||
		record.dimensions.height !== entry.dimensions.height ||
		record.dimensions.format?.toLowerCase() !== "webp"
	) {
		return "logged dimensions/format differ"
	}
	return null
}

export const runLobsterAssetQa = async (
	options: RunLobsterAssetQaOptions
): Promise<LobsterAssetQaReport> => {
	const manifestPath =
		options.manifestPath ?? "data/lobster/artwork/manifest.json"
	const batchesPath =
		options.batchesPath ?? "data/lobster/artwork/batches.json"
	const metadataPath =
		options.metadataPath ?? "data/lobster/metadata/lobster-metadata.json"
	const generationResultsPath =
		options.generationResultsPath ?? GENERATION_RESULTS_PATH
	const remediationPath = options.remediationPath ?? REMEDIATION_PATH
	const [manifest, batches, metadata, ledger, remediation] = await Promise.all([
		readJson<ArtworkManifest>(manifestPath),
		readJson<ArtworkBatchGraph>(batchesPath),
		readJson<LobsterMetadataDataset>(metadataPath),
		readJson<GenerationResultsLedger>(generationResultsPath),
		loadRemediationRegistry(remediationPath)
	])
	const successful = validateTrackedLedger(manifest, ledger, {
		requireComplete: false
	})
	const ledgerCoverageErrors =
		options.mode === "strict" && ledger.records.length !== manifest.entries.length
			? [
					`tracked ledger has ${ledger.records.length} generated records for ${manifest.entries.length} manifest scenes`
				]
			: []
	const manifestByScene = new Map(
		manifest.entries.map((entry) => [entry.sceneId, entry])
	)
	const remediationErrors = [...remediationByScene(remediation).values()].flatMap(
		(entry) => {
			const manifestEntry = manifestByScene.get(entry.sceneId)
			if (!manifestEntry) return [`${entry.sceneId}: remediation scene is absent`]
			if (
				entry.id === "pinch-action-clarity" &&
				manifestEntry.action.id !== "pinch"
			) {
				return [`${entry.sceneId}: pinch remediation is not bound to pinch`]
			}
			if (
				entry.id === "polychelidae-morphology" &&
				manifestEntry.family !== "Polychelidae"
			) {
				return [
					`${entry.sceneId}: Polychelidae remediation is bound to ${manifestEntry.family}`
				]
			}
			return []
		}
	)
	const assetsRoot = options.assetsRoot ?? manifest.output.root
	const absoluteAssetsRoot = resolve(assetsRoot)
	const expectedByPath = new Map(
		manifest.entries.map((entry) => [
			normalizePath(entry.outputPath),
			entry
		])
	)
	const expectedByScene = new Map(
		manifest.entries.map((entry) => [entry.sceneId, entry])
	)
	const assetFiles = await listFiles(assetsRoot)
	const corpusFiles = assetFiles.map((absolutePath) => {
		const relativePath = normalizePath(relative(absoluteAssetsRoot, absolutePath))
		return {
			absolutePath,
			path: `${manifest.output.root}/${relativePath}`
		}
	})
	const repositoryPaths = corpusFiles.map(({ path }) => path)
	const extraFiles = corpusFiles
		.filter(({ path }) => !expectedByPath.has(path))
		.map(({ path }) => path)
	const present = corpusFiles
		.filter(({ path }) => expectedByPath.has(path))
		.map(({ path, absolutePath }) => ({
			path,
			absolutePath,
			entry: expectedByPath.get(path)!
		}))
	const presentSceneIds = new Set(present.map(({ entry }) => entry.sceneId))
	const missingSceneIds = manifest.entries
		.filter((entry) => !presentSceneIds.has(entry.sceneId))
		.map((entry) => entry.sceneId)
	const inspectionErrors: string[] = []
	const provenanceErrors: string[] = []
	const inventory = (
		await mapLimit(
			present,
			options.concurrency ?? 8,
			async ({ path, absolutePath, entry }) => {
				try {
					const [bytes, inspection] = await Promise.all([
						readFile(absolutePath),
						inspectWebp(absolutePath, options)
					])
					const base = {
						sceneId: entry.sceneId,
						AphiaID: entry.AphiaID,
						path,
						bytes: bytes.length,
						sha256: sha256(bytes),
						dHash64: inspection.dHash64,
						width: inspection.width,
						height: inspection.height,
						format: inspection.format,
						colorSpace: inspection.colorSpace
					}
					const provenanceRecord = successful.get(entry.sceneId)
					const provenanceProblem = validateProvenance(
						entry,
						base,
						provenanceRecord
					)
					if (provenanceProblem) {
						provenanceErrors.push(
							`${entry.sceneId}: ${provenanceProblem}`
						)
					}
					return {
						...base,
						provenance:
							provenanceRecord
								? {
										status: "generated",
										ledgerPath: generationResultsPath,
										generatedAt: provenanceRecord.generatedAt
									}
								: null
					} satisfies AssetInventoryEntry
				} catch (error) {
					inspectionErrors.push(
						`${entry.sceneId}: ${
							error instanceof Error ? error.message : String(error)
						}`
					)
					return null
				}
			}
		)
	).filter((entry): entry is AssetInventoryEntry => entry !== null)
	inventory.sort((left, right) => left.sceneId.localeCompare(right.sceneId))

	const contractErrors = inventory.flatMap((entry) => {
		const expected = expectedByScene.get(entry.sceneId)!
		const problems: string[] = []
		if (
			entry.width !== expected.dimensions.width ||
			entry.height !== expected.dimensions.height
		) {
			problems.push(
				`${entry.sceneId}: expected 768x512, found ${entry.width}x${entry.height}`
			)
		}
		if (entry.format.toUpperCase() !== "WEBP") {
			problems.push(`${entry.sceneId}: decoded format is ${entry.format}`)
		}
		if (entry.colorSpace.toLowerCase() !== "srgb") {
			problems.push(
				`${entry.sceneId}: colorspace ${entry.colorSpace} is not sRGB`
			)
		}
		if (entry.bytes > MAX_ASSET_BYTES) {
			problems.push(
				`${entry.sceneId}: ${entry.bytes} bytes exceeds ${MAX_ASSET_BYTES}`
			)
		}
		return problems
	})
	const bySha = Map.groupBy(inventory, (entry) => entry.sha256)
	const exactDuplicates: DuplicatePair[] = []
	for (const entries of bySha.values()) {
		for (let left = 0; left < entries.length; left += 1) {
			for (let right = left + 1; right < entries.length; right += 1) {
				exactDuplicates.push({
					leftSceneId: entries[left]!.sceneId,
					rightSceneId: entries[right]!.sceneId,
					distance: 0
				})
			}
		}
	}
	const threshold =
		options.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD
	const nearDuplicates: DuplicatePair[] = []
	for (let left = 0; left < inventory.length; left += 1) {
		for (let right = left + 1; right < inventory.length; right += 1) {
			if (inventory[left]!.sha256 === inventory[right]!.sha256) continue
			const distance = hammingDistance64(
				inventory[left]!.dHash64,
				inventory[right]!.dHash64
			)
			if (distance <= threshold) {
				nearDuplicates.push({
					leftSceneId: inventory[left]!.sceneId,
					rightSceneId: inventory[right]!.sceneId,
					distance
				})
			}
		}
	}
	nearDuplicates.sort(
		(left, right) =>
			left.distance - right.distance ||
			left.leftSceneId.localeCompare(right.leftSceneId) ||
			left.rightSceneId.localeCompare(right.rightSceneId)
	)
	const totalBytes = inventory.reduce((total, entry) => total + entry.bytes, 0)
	const averageBytes =
		inventory.length === 0 ? null : totalBytes / inventory.length
	const metadataErrors = validateManifestMetadata(manifest, metadata)
	const batchErrors = validateBatchGraph(manifest, batches)
	const quotas = quotaReport(manifest)
	const quotaErrors = [
		quotas.officeShare >= 0.03
			? `office/boardroom/hearing share ${quotas.officeShare}`
			: null,
		quotas.medium.share > 0.15
			? `medium ${quotas.medium.id} share ${quotas.medium.share}`
			: null,
		quotas.environment.share >= 0.1
			? `environment family ${quotas.environment.id} share ${quotas.environment.share}`
			: null,
		quotas.cast.share > 0.05
			? `cast ${quotas.cast.id} share ${quotas.cast.share}`
			: null,
		quotas.prominentWomanHumanShare < 0.5
			? `prominent adult woman human-scene share ${quotas.prominentWomanHumanShare}`
			: null,
		quotas.nonPhotorealisticShare < 0.2
			? `non-photorealistic share ${quotas.nonPhotorealisticShare}`
			: null
	].filter((value): value is string => value !== null)
	const corpusMasterNames = repositoryPaths.filter((path) =>
		/(?:^|[-_.])(master|normalized|source|staged)(?:[-_.]|$)/i.test(
			basename(path)
		)
	)
	const masterArtifacts = [...new Set(corpusMasterNames)]
	const criteria: QaCriterion[] = [
		criterion(
			"manifest-coverage",
			missingSceneIds.length === 0
				? "pass"
				: options.mode === "partial"
					? "pending"
					: "fail",
			missingSceneIds.length === 0
				? `all ${manifest.entries.length} manifest assets are present`
				: `${missingSceneIds.length} manifest assets are not present`,
			missingSceneIds.slice(0, 50)
		),
		criterion(
			"no-extra-assets",
			extraFiles.length === 0 ? "pass" : "fail",
			extraFiles.length === 0
				? "asset corpus contains no files outside the manifest"
				: `${extraFiles.length} extra corpus files found`,
			extraFiles
		),
		criterion(
			"path-and-batch-agreement",
			batchErrors.length === 0 ? "pass" : "fail",
			batchErrors.length === 0
				? "manifest paths and batch graph agree"
				: "manifest path or batch graph mismatch",
			batchErrors
		),
		criterion(
			"riff-decode-dimensions-color",
			inspectionErrors.length === 0 && contractErrors.length === 0
				? "pass"
				: "fail",
			inspectionErrors.length === 0 && contractErrors.length === 0
				? `${inventory.length} present assets decode as 768x512 sRGB WebP`
				: "one or more present assets violate the image contract",
			[...inspectionErrors, ...contractErrors]
		),
		criterion(
			"individual-byte-limit",
			inventory.every((entry) => entry.bytes <= MAX_ASSET_BYTES)
				? "pass"
				: "fail",
			`maximum present asset size is ${Math.max(0, ...inventory.map((entry) => entry.bytes))} bytes`
		),
		criterion(
			"average-byte-limit",
			averageBytes === null
				? options.mode === "partial"
					? "pending"
					: "fail"
				: averageBytes <= MAX_AVERAGE_BYTES
					? "pass"
					: "fail",
			averageBytes === null
				? "no present assets to average"
				: `present asset average is ${averageBytes.toFixed(2)} bytes`
		),
		criterion(
			"prompt-alt-action-evidence",
			metadataErrors.length === 0 ? "pass" : "fail",
			metadataErrors.length === 0
				? "prompt hashes, alt text, permitted actions, evidence, and citations agree with metadata"
				: "manifest metadata binding errors found",
			metadataErrors
		),
		criterion(
			"manifest-quotas",
			quotaErrors.length === 0 ? "pass" : "fail",
			quotaErrors.length === 0
				? "manifest portfolio quotas comply"
				: "manifest portfolio quotas do not comply",
			quotaErrors
		),
		criterion(
			"tracked-remediation",
			remediationErrors.length === 0 ? "pass" : "fail",
			remediationErrors.length === 0
				? "all 85 audited concern scenes have valid tracked remediation"
				: "tracked remediation bindings are invalid",
			remediationErrors
		),
		criterion(
			"generation-provenance",
			provenanceErrors.length === 0 &&
				ledgerCoverageErrors.length === 0 &&
				ledger.sourceImport.malformedLines.length === 0 &&
				ledger.unresolvedFailures.length === 0
				? "pass"
				: "fail",
			provenanceErrors.length === 0 &&
				ledgerCoverageErrors.length === 0 &&
				ledger.sourceImport.malformedLines.length === 0 &&
				ledger.unresolvedFailures.length === 0
				? "tracked generated results match present final assets"
				: "generation provenance problems found",
			[
				...provenanceErrors,
				...ledgerCoverageErrors,
				...ledger.sourceImport.malformedLines,
				...ledger.unresolvedFailures.map(
					(record) =>
						`${record.sceneId}: unresolved tracked generation failure`
				)
			]
		),
		criterion(
			"exact-duplicates",
			exactDuplicates.length === 0 ? "pass" : "fail",
			exactDuplicates.length === 0
				? "no exact SHA-256 duplicates found"
				: `${exactDuplicates.length} exact duplicate pairs found`,
			exactDuplicates.map(
				(pair) => `${pair.leftSceneId} <> ${pair.rightSceneId}`
			)
		),
		criterion(
			"perceptual-near-duplicates",
			nearDuplicates.length === 0 ? "pass" : "fail",
			nearDuplicates.length === 0
				? `no dHash pairs at Hamming distance <= ${threshold}`
				: `${nearDuplicates.length} dHash pairs at Hamming distance <= ${threshold}`,
			nearDuplicates.map(
				(pair) =>
					`${pair.leftSceneId} <> ${pair.rightSceneId}: distance ${pair.distance}`
			)
		),
		criterion(
			"no-retained-masters",
			masterArtifacts.length === 0 ? "pass" : "fail",
			masterArtifacts.length === 0
				? "no source, normalized, staged, or master images found in corpus or generation scratch"
				: `${masterArtifacts.length} retained image artifacts found`,
			masterArtifacts
		),
		criterion(
			"human-review",
			"pending",
			"scientific anatomy and final art review remain pending and are not inferred from automated QA"
		)
	]
	const report: LobsterAssetQaReport = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		mode: options.mode,
		passed: criteria.every((entry) => entry.status !== "fail"),
		configuration: {
			manifestPath,
			batchesPath,
			metadataPath,
			assetsRoot,
			generationResultsPath,
			remediationPath,
			expectedWidth: manifest.output.width,
			expectedHeight: manifest.output.height,
			maximumBytes: MAX_ASSET_BYTES,
			maximumAverageBytes: MAX_AVERAGE_BYTES,
			perceptualHash: {
				algorithm:
					"64-bit horizontal difference hash over ImageMagick-normalized 9x8 sRGB grayscale pixels",
				bits: 64,
				nearDuplicateHammingThreshold: threshold,
				failureRule:
					"distinct files with Hamming distance less than or equal to the threshold fail QA and are reported as scene pairs"
			}
		},
		summary: {
			manifestEntries: manifest.entries.length,
			presentAssets: present.length,
			missingAssets: missingSceneIds.length,
			extraFiles: extraFiles.length,
			totalBytes,
			averageBytes,
			exactDuplicatePairs: exactDuplicates.length,
			nearDuplicatePairs: nearDuplicates.length
		},
		criteria,
		missingSceneIds,
		extraFiles,
		inventory,
		exactDuplicates,
		nearDuplicates,
		generationResults: {
			path: generationResultsPath,
			unresolvedFailures: ledger.unresolvedFailures.map((record) => ({
				sceneId: record.sceneId,
				error: record.error ?? null
			}))
		},
		humanReview: {
			scientificAnatomy: "pending",
			finalArt: "pending",
			note:
				"Automated checks do not prove rendered anatomy, action accuracy, or visual quality."
		}
	}
	if (options.reportPath) {
		await mkdir(dirname(options.reportPath), { recursive: true })
		await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
	}
	return report
}
