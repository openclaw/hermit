import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type {
	ArtworkBatchGraph,
	ArtworkManifest,
	ArtworkManifestEntry,
	ArtworkProductionRecord
} from "./lobster-artwork-plan.js"
import { inspectWebp } from "./lobster-asset-qa.js"
import {
	GENERATION_RESULTS_PATH,
	QA_REPORT_PATH,
	REMEDIATION_PATH,
	type DurableGenerationRecord,
	type GenerationResultsLedger,
	validateTrackedLedger
} from "./lobster-art-evidence.js"
import {
	FINAL_HEIGHT,
	FINAL_WIDTH,
	MAX_FINAL_BYTES,
	TARGET_FINAL_BYTES
} from "./lobster-art-generation.js"

export const FINALIZER_VERSION = "LOB-ASSET-1" as const
export const MANIFEST_PATH = "data/lobster/artwork/manifest.json" as const
export const BATCHES_PATH = "data/lobster/artwork/batches.json" as const
export const PROVENANCE_PATH = "data/lobster/artwork/provenance.json" as const
export const STRICT_QA_REPORT_PATH = QA_REPORT_PATH

type QaReport = {
	schemaVersion: number
	generatedAt: string
	mode: string
	passed: boolean
	summary: {
		manifestEntries: number
		presentAssets: number
		missingAssets: number
		extraFiles: number
		totalBytes: number
		averageBytes: number
		exactDuplicatePairs: number
		nearDuplicatePairs: number
	}
	generationResults: {
		path: string
		unresolvedFailures: unknown[]
	}
	humanReview: {
		scientificAnatomy: string
		finalArt: string
	}
}

const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`

const assertExact = (
	actual: unknown,
	expected: unknown,
	description: string
) => {
	if (actual !== expected) {
		throw new Error(`${description}: expected ${expected}, found ${actual}`)
	}
}

const assertGenerationContract = (
	entry: ArtworkManifestEntry,
	record: DurableGenerationRecord,
	bytes: Uint8Array,
	inspection: Awaited<ReturnType<typeof inspectWebp>>
) => {
	assertExact(record.batchId, entry.batchId, `${entry.sceneId} batch`)
	assertExact(record.AphiaID, entry.AphiaID, `${entry.sceneId} AphiaID`)
	assertExact(record.outputPath, entry.outputPath, `${entry.sceneId} path`)
	assertExact(record.model, "gpt-image-2", `${entry.sceneId} model`)
	assertExact(
		record.generatorPath,
		"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py",
		`${entry.sceneId} generator`
	)
	assertExact(record.requestedSize, "1536x1024", `${entry.sceneId} source size`)
	if (record.quality !== "low" && record.quality !== "medium") {
		throw new Error(`${entry.sceneId} has invalid generation quality`)
	}
	assertExact(record.sourceOutput?.format, "webp", `${entry.sceneId} source format`)
	assertExact(
		record.sourceOutput?.compression,
		100,
		`${entry.sceneId} source compression`
	)
	assertExact(
		record.promptVersion,
		entry.promptVersion,
		`${entry.sceneId} prompt version`
	)
	assertExact(
		record.promptSha256,
		entry.promptSha256,
		`${entry.sceneId} prompt checksum`
	)
	if (!/^[a-f0-9]{64}$/.test(record.executionPromptSha256)) {
		throw new Error(`${entry.sceneId} has invalid execution prompt checksum`)
	}
	assertExact(record.finalSha256, sha256(bytes), `${entry.sceneId} final checksum`)
	assertExact(record.finalBytes, bytes.length, `${entry.sceneId} final bytes`)
	assertExact(record.dimensions?.width, FINAL_WIDTH, `${entry.sceneId} width`)
	assertExact(record.dimensions?.height, FINAL_HEIGHT, `${entry.sceneId} height`)
	assertExact(record.dimensions?.format, "webp", `${entry.sceneId} format`)
	assertExact(record.compression?.codec, "cwebp", `${entry.sceneId} codec`)
	assertExact(
		record.compression?.targetBytes,
		TARGET_FINAL_BYTES,
		`${entry.sceneId} target bytes`
	)
	assertExact(
		record.compression?.maximumBytes,
		MAX_FINAL_BYTES,
		`${entry.sceneId} maximum bytes`
	)
	assertExact(inspection.width, FINAL_WIDTH, `${entry.sceneId} inspected width`)
	assertExact(inspection.height, FINAL_HEIGHT, `${entry.sceneId} inspected height`)
	assertExact(inspection.format, "WEBP", `${entry.sceneId} inspected format`)
	assertExact(
		inspection.colorSpace.toLowerCase(),
		"srgb",
		`${entry.sceneId} color space`
	)
}

const inventoryLine = (
	entry: ArtworkManifestEntry,
	final: ArtworkProductionRecord["final"]
) =>
	[
		entry.sceneId,
		entry.outputPath,
		final.sha256,
		final.bytes,
		final.width,
		final.height,
		final.format
	].join("\t") + "\n"

export const finalizeLobsterArtwork = async () => {
	const [
		manifestText,
		batchesText,
		provenanceText,
		qaBytes,
		ledgerText,
		remediationBytes
	] =
		await Promise.all([
			readFile(MANIFEST_PATH, "utf8"),
			readFile(BATCHES_PATH, "utf8"),
			readFile(PROVENANCE_PATH, "utf8"),
			readFile(STRICT_QA_REPORT_PATH),
			readFile(GENERATION_RESULTS_PATH, "utf8"),
			readFile(REMEDIATION_PATH)
		])
	const manifest = JSON.parse(manifestText) as ArtworkManifest
	const batches = JSON.parse(batchesText) as ArtworkBatchGraph
	const existingProvenance = JSON.parse(provenanceText) as Record<string, unknown>
	const qa = JSON.parse(qaBytes.toString("utf8")) as QaReport
	const ledger = JSON.parse(ledgerText) as GenerationResultsLedger

	if (
		manifest.entries.length !== 1056 ||
		qa.mode !== "strict" ||
		!qa.passed ||
		qa.summary.manifestEntries !== 1056 ||
		qa.summary.presentAssets !== 1056 ||
		qa.summary.missingAssets !== 0 ||
		qa.summary.extraFiles !== 0 ||
		qa.summary.exactDuplicatePairs !== 0 ||
		qa.summary.nearDuplicatePairs !== 0 ||
		qa.generationResults.path !== GENERATION_RESULTS_PATH ||
		qa.generationResults.unresolvedFailures.length !== 0 ||
		qa.humanReview.scientificAnatomy !== "pending" ||
		qa.humanReview.finalArt !== "pending"
	) {
		throw new Error("strict QA report is not a complete passing corpus report")
	}

	const sceneToBatch = new Map<string, string>()
	for (const batch of batches.batches) {
		for (const sceneId of batch.species.flatMap(({ sceneIds }) => sceneIds)) {
			if (sceneToBatch.has(sceneId)) {
				throw new Error(`duplicate batch membership for ${sceneId}`)
			}
			sceneToBatch.set(sceneId, batch.id)
		}
	}
	const successful = validateTrackedLedger(manifest, ledger)
	const aggregateHasher = createHash("sha256")
	const inventoryHasher = createHash("sha256")
	const finals = new Map<
		string,
		{ bytes: Uint8Array; production: ArtworkProductionRecord }
	>()

	for (const entry of manifest.entries) {
		const batchId = sceneToBatch.get(entry.sceneId)
		const authoritative = successful.get(entry.sceneId)
		if (!batchId || !authoritative) {
			throw new Error(`${entry.sceneId} lacks batch or successful provenance`)
		}
		entry.batchId = batchId
		const [bytes, inspection] = await Promise.all([
			readFile(entry.outputPath),
			inspectWebp(entry.outputPath)
		])
		assertGenerationContract(entry, authoritative, bytes, inspection)
		const final: ArtworkProductionRecord["final"] = {
			sha256: sha256(bytes),
			bytes: bytes.length,
			width: FINAL_WIDTH,
			height: FINAL_HEIGHT,
			format: "webp",
			colorSpace: "sRGB",
			compression: {
				codec: "cwebp",
				targetBytes: TARGET_FINAL_BYTES,
				maximumBytes: MAX_FINAL_BYTES
			}
		}
		const production: ArtworkProductionRecord = {
			batchId,
			model: "gpt-image-2",
			generatorPath: authoritative.generatorPath!,
			requestedSize: "1536x1024",
			quality: authoritative.quality as "low" | "medium",
			sourceOutput: {
				format: "webp",
				compression: 100
			},
			generatedAt: authoritative.generatedAt,
			generatedAtSource: "tracked-generation-results",
			authoritativeResult: {
				status: "generated",
				path: GENERATION_RESULTS_PATH
			},
			promptVersion: entry.promptVersion,
			promptSha256: entry.promptSha256,
			executionPromptSha256: authoritative.executionPromptSha256,
			remediation: authoritative.remediation,
			final,
			automatedReviewStatus: "passed",
			status: "complete"
		}
		entry.outputSha256 = final.sha256
		entry.outputBytes = final.bytes
		entry.status = "complete"
		entry.production = production
		finals.set(entry.sceneId, { bytes, production })
		aggregateHasher.update(bytes)
		inventoryHasher.update(inventoryLine(entry, final))
	}

	const totalBytes = [...finals.values()].reduce(
		(total, entry) => total + entry.production.final.bytes,
		0
	)
	const maximumBytes = Math.max(
		...[...finals.values()].map((entry) => entry.production.final.bytes)
	)
	assertExact(totalBytes, qa.summary.totalBytes, "strict QA total bytes")
	assertExact(
		totalBytes / manifest.entries.length,
		qa.summary.averageBytes,
		"strict QA average bytes"
	)

	const manifestContents = serializeJson(manifest)
	const manifestSha256 = sha256(manifestContents)
	batches.manifestSha256 = manifestSha256
	for (const batch of batches.batches) {
		const sceneIds = batch.species.flatMap(({ sceneIds }) => sceneIds)
		const batchAssetHasher = createHash("sha256")
		const batchInventoryHasher = createHash("sha256")
		let batchBytes = 0
		for (const sceneId of sceneIds) {
			const entry = manifest.entries.find((candidate) => candidate.sceneId === sceneId)!
			const finalized = finals.get(sceneId)!
			batchBytes += finalized.production.final.bytes
			batchAssetHasher.update(finalized.bytes)
			batchInventoryHasher.update(
				inventoryLine(entry, finalized.production.final)
			)
		}
		batch.production = {
			status: "complete",
			automatedReviewStatus: "passed",
			sceneCount: sceneIds.length,
			totalBytes: batchBytes,
			aggregateAssetSha256: batchAssetHasher.digest("hex"),
			inventorySha256: batchInventoryHasher.digest("hex")
		}
	}
	const batchesContents = serializeJson(batches)
	const batchesSha256 = sha256(batchesContents)
	const generationTimestamps = manifest.entries.map(
		(entry) => entry.production!.generatedAt
	)
	const provenance = {
		...existingProvenance,
		outputs: {
			manifest: {
				path: MANIFEST_PATH,
				sha256: manifestSha256,
				speciesCount: 264,
				sceneCount: manifest.entries.length
			},
			batches: {
				path: BATCHES_PATH,
				sha256: batchesSha256,
				batchCount: batches.batches.length,
				maximumSpeciesPerBatch: batches.batchSizeLimit
			},
			remediation: {
				path: REMEDIATION_PATH,
				sha256: sha256(remediationBytes),
				sceneCount: 85
			},
			generationResults: {
				path: GENERATION_RESULTS_PATH,
				sha256: sha256(ledgerText),
				sceneCount: ledger.records.length
			}
		},
		production: {
			id: FINALIZER_VERSION,
			finalizer: {
				path: "scripts/finalize-lobster-art.ts",
				helperPath: "scripts/lib/lobster-art-finalization.ts"
			},
			generation: {
				model: "gpt-image-2",
				generatorPath:
					"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py",
				requestedSize: "1536x1024",
				quality: "medium",
				sourceOutput: {
					format: "webp",
					compression: 100
				},
				earliestGeneratedAt: generationTimestamps.toSorted()[0],
				latestGeneratedAt: generationTimestamps.toSorted().at(-1)
			},
			finalConstraints: {
				format: "webp",
				width: FINAL_WIDTH,
				height: FINAL_HEIGHT,
				colorSpace: "sRGB",
				compression: {
					codec: "cwebp",
					targetBytes: TARGET_FINAL_BYTES,
					maximumBytes: MAX_FINAL_BYTES
				},
				largerMasterRetained: false
			},
			corpus: {
				status: "complete",
				automatedReviewStatus: "passed",
				assetCount: manifest.entries.length,
				totalBytes,
				averageBytes: totalBytes / manifest.entries.length,
				maximumBytes,
				aggregateAssetSha256: aggregateHasher.digest("hex"),
				inventorySha256: inventoryHasher.digest("hex")
			},
			strictQa: {
				path: STRICT_QA_REPORT_PATH,
				sha256: sha256(qaBytes),
				generatedAt: qa.generatedAt,
				status: "passed",
				missingAssets: 0,
				extraFiles: 0,
				exactDuplicatePairs: 0,
				nearDuplicatePairs: 0
			},
			generationHistory: {
				resultsPath: GENERATION_RESULTS_PATH,
				resultsSha256: sha256(ledgerText),
				generatedRecordCount: ledger.records.length,
				skippedObservationCount: ledger.skippedObservations.length,
				supersededGeneratedCount: ledger.supersededGenerated.length,
				supersededGenerated: ledger.supersededGenerated.map((record) => ({
					sceneId: record.sceneId,
					classification: "superseded",
					error: record.error ?? null
				})),
				supersededFailureCount: ledger.supersededFailures.length,
				supersededFailures: ledger.supersededFailures.map((record) => ({
					sceneId: record.sceneId,
					classification: "superseded",
					error: record.error ?? null
				})),
				unresolvedFailureCount: ledger.unresolvedFailures.length,
				unresolvedFailures: ledger.unresolvedFailures
			},
			remediation: {
				path: REMEDIATION_PATH,
				sha256: sha256(remediationBytes),
				status: "pending-regeneration",
				pinchSceneCount: 68,
				polychelidaeSceneCount: 17,
				totalSceneCount: 85
			},
			humanReview: {
				scientificAnatomy: {
					approver: "Peter Steinberger",
					status: "not-reviewed"
				},
				finalArt: {
					approver: "Hannes Rudolph",
					status: "not-reviewed"
				}
			},
			deliveryContract: {
				sequence: [
					"repository assets",
					"immutable raw GitHub",
					"validated Discord attachments"
				],
				repositoryAssetRoot: "assets/lobster/scenes",
				rawGitHubRevision: "full immutable commit SHA",
				discordAttachmentValidation: [
					"http-ok",
					"bounded-bytes",
					"riff-webp",
					"exact-768x512"
				],
				externalMediaInMessage: false,
				r2: {
					used: false,
					role: "none"
				}
			}
		}
	}
	return {
		manifestContents,
		batchesContents,
		provenanceContents: serializeJson(provenance)
	}
}
