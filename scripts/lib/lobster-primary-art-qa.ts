import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
	PRIMARY_ASSET_COUNT,
	PRIMARY_HEIGHT,
	PRIMARY_MAX_BYTES,
	PRIMARY_REVIEW_KEYS,
	PRIMARY_WIDTH,
	loadPrimaryPlan,
	serializeJson,
	sha256
} from "./lobster-primary-art-contract.js"
import {
	inspectPrimaryWebp,
	type PrimaryImageInspection
} from "./lobster-primary-art-generation.js"
import {
	loadPrimaryFinalizedResults,
	type PrimaryFinalizedAssetRecord
} from "./lobster-primary-art-results.js"

export type PrimaryQaCriterion = {
	id: string
	status: "pass" | "fail"
	details: string[]
}

export type PrimaryQaReport = {
	schemaVersion: 1
	generatedAt: string
	passed: boolean
	summary: {
		expectedEntries: number
		manifestEntries: number
		presentAssets: number
		generatedAssets: number
		reusedAssets: number
		totalBytes: number
	}
	criteria: PrimaryQaCriterion[]
	assets: Array<{
		sceneId: string
		outputPath: string
		source: "generated" | "reused-supporting"
		bytes: number
		sha256: string
	}>
}

export type RunPrimaryQaOptions = {
	manifestPath?: string
	batchesPath?: string
	reportPath?: string
	resultsPath?: string
	expectedCount?: number
	inspect?: (path: string) => Promise<PrimaryImageInspection>
}

const exists = async (path: string) => {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

const criterion = (id: string, details: string[]): PrimaryQaCriterion => ({
	id,
	status: details.length === 0 ? "pass" : "fail",
	details
})

const approvedStatus = (status: string) => status === "approved"

const recordsByScene = (records: PrimaryFinalizedAssetRecord[]) => {
	const map = new Map<string, PrimaryFinalizedAssetRecord>()
	for (const record of records) {
		if (map.has(record.sceneId)) {
			throw new Error(`duplicate finalized result for ${record.sceneId}`)
		}
		map.set(record.sceneId, record)
	}
	return map
}

export const runPrimaryArtQa = async (
	options: RunPrimaryQaOptions = {}
): Promise<PrimaryQaReport> => {
	const expectedCount = options.expectedCount ?? Number(PRIMARY_ASSET_COUNT)
	const plan = await loadPrimaryPlan({
		manifestPath: options.manifestPath,
		batchesPath: options.batchesPath,
		expectedCount
	})
	const inspect = options.inspect ?? inspectPrimaryWebp
	const promptErrors: string[] = []
	const reviewErrors: string[] = []
	const assetErrors: string[] = []
	const resultErrors: string[] = []
	const assets: PrimaryQaReport["assets"] = []
	const ledger = options.resultsPath
		? await loadPrimaryFinalizedResults(options.resultsPath)
		: null
	const finalizedByScene = ledger ? recordsByScene(ledger.records) : new Map()

	if (ledger && ledger.planId !== plan.manifest.planId) {
		resultErrors.push("finalized results planId does not match primary plan")
	}

	for (const entry of plan.manifest.entries) {
		if (entry.promptSha256 !== sha256(entry.prompt)) {
			promptErrors.push(`${entry.sceneId}: promptSha256 does not match prompt`)
		}
		for (const reviewKey of PRIMARY_REVIEW_KEYS) {
			const status = entry.reviews[reviewKey].status
			if (!approvedStatus(status)) {
				reviewErrors.push(`${entry.sceneId}: ${reviewKey} review is ${status}`)
			}
		}

		if (!(await exists(entry.outputPath))) {
			assetErrors.push(`${entry.sceneId}: generated asset is missing`)
			continue
		}
		try {
			const [inspection, bytes] = await Promise.all([
				inspect(entry.outputPath),
				readFile(entry.outputPath)
			])
			const actualSha256 = sha256(bytes)
			if (
				inspection.width !== PRIMARY_WIDTH ||
				inspection.height !== PRIMARY_HEIGHT ||
				inspection.format !== "WEBP"
			) {
				assetErrors.push(
					`${entry.sceneId}: expected ${PRIMARY_WIDTH}x${PRIMARY_HEIGHT} WebP`
				)
			}
			if (
				inspection.bytes !== bytes.length ||
				inspection.sha256 !== actualSha256
			) {
				assetErrors.push(`${entry.sceneId}: image inspection is inconsistent`)
			}
			if (bytes.length > PRIMARY_MAX_BYTES) {
				assetErrors.push(
					`${entry.sceneId}: ${bytes.length} bytes exceeds ${PRIMARY_MAX_BYTES}`
				)
			}

			if (entry.source.kind === "reused-supporting") {
				if (!(await exists(entry.source.supportingOutputPath))) {
					assetErrors.push(
						`${entry.sceneId}: reused source asset is missing`
					)
				} else {
					const supportingBytes = await readFile(
						entry.source.supportingOutputPath
					)
					if (
						supportingBytes.length !== bytes.length ||
						sha256(supportingBytes) !== actualSha256
					) {
						assetErrors.push(
							`${entry.sceneId}: reused asset does not exactly match ${entry.source.supportingSceneId}`
						)
					}
				}
			}

			const finalized = finalizedByScene.get(entry.sceneId)
			if (!finalized) {
				resultErrors.push(`${entry.sceneId}: finalized result is missing`)
			} else if (
				finalized.batchId !== plan.batchBySceneId.get(entry.sceneId) ||
				finalized.outputPath !== entry.outputPath ||
				finalized.source !== entry.source.kind ||
				finalized.sha256 !== actualSha256 ||
				finalized.bytes !== bytes.length ||
				finalized.width !== PRIMARY_WIDTH ||
				finalized.height !== PRIMARY_HEIGHT ||
				finalized.format !== "webp"
			) {
				resultErrors.push(
					`${entry.sceneId}: finalized result does not bind the asset`
				)
			}

			assets.push({
				sceneId: entry.sceneId,
				outputPath: entry.outputPath,
				source: entry.source.kind,
				bytes: bytes.length,
				sha256: actualSha256
			})
		} catch (error) {
			assetErrors.push(
				`${entry.sceneId}: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}
	}

	if (ledger && ledger.records.length !== expectedCount) {
		resultErrors.push(
			`expected ${expectedCount} finalized results, found ${ledger.records.length}`
		)
	}

	const criteria = [
		criterion("bindings", []),
		criterion("prompts", promptErrors),
		criterion("assets", assetErrors),
		criterion("reviews", reviewErrors),
		criterion("finalized-results", resultErrors)
	]
	const report: PrimaryQaReport = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		passed: criteria.every(({ status }) => status === "pass"),
		summary: {
			expectedEntries: expectedCount,
			manifestEntries: plan.manifest.entries.length,
			presentAssets: assets.length,
			generatedAssets: assets.filter(({ source }) => source === "generated")
				.length,
			reusedAssets: assets.filter(
				({ source }) => source === "reused-supporting"
			).length,
			totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0)
		},
		criteria,
		assets
	}
	if (options.reportPath) {
		await mkdir(dirname(options.reportPath), { recursive: true })
		await writeFile(options.reportPath, serializeJson(report))
	}
	return report
}
