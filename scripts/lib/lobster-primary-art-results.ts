import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
	loadPrimaryPlan,
	primaryPrompt,
	serializeJson,
	sha256
} from "./lobster-primary-art-contract.js"
import {
	inspectPrimaryWebp,
	type PrimaryGenerationResult
} from "./lobster-primary-art-generation.js"

export type PrimaryFinalizedAssetRecord = {
	sceneId: string
	batchId: string
	outputPath: string
	source: "generated" | "reused-supporting"
	sha256: string
	bytes: number
	width: 768
	height: 512
	format: "webp"
	generatedAt: string | null
}

export type PrimaryFinalizedResultsLedger = {
	schemaVersion: 1
	planId: "LOB-PRIMARY-ART-v2"
	finalizedAt: string
	records: PrimaryFinalizedAssetRecord[]
}

const parseGenerationResults = (text: string, path: string) => {
	const latest = new Map<string, PrimaryGenerationResult>()
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (line.trim() === "") continue
		let result: PrimaryGenerationResult
		try {
			result = JSON.parse(line) as PrimaryGenerationResult
		} catch {
			throw new Error(`${path}:${index + 1} is not valid JSON`)
		}
		if (!result.sceneId || !result.status) {
			throw new Error(`${path}:${index + 1} is not a generation result`)
		}
		latest.set(result.sceneId, result)
	}
	return latest
}

export const loadPrimaryFinalizedResults = async (path: string) => {
	const parsed = JSON.parse(await readFile(path, "utf8")) as
		| PrimaryFinalizedResultsLedger
		| unknown
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("records" in parsed) ||
		!Array.isArray(parsed.records)
	) {
		throw new Error(`${path} is not a finalized primary results ledger`)
	}
	return parsed as PrimaryFinalizedResultsLedger
}

export const importPrimaryArtResults = async (options: {
	resultsPath: string
	outputPath?: string
	manifestPath?: string
	batchesPath?: string
	write?: boolean
	expectedCount?: number
}) => {
	const [plan, resultsText] = await Promise.all([
		loadPrimaryPlan({
			manifestPath: options.manifestPath,
			batchesPath: options.batchesPath,
			expectedCount: options.expectedCount
		}),
		readFile(options.resultsPath, "utf8")
	])
	const latest = parseGenerationResults(resultsText, options.resultsPath)
	const records: PrimaryFinalizedAssetRecord[] = []

	for (const entry of plan.manifest.entries) {
		const batchId = plan.batchBySceneId.get(entry.sceneId)!
		if (entry.source.kind === "reused-supporting") {
			const [primary, supporting] = await Promise.all([
				inspectPrimaryWebp(entry.outputPath),
				inspectPrimaryWebp(entry.source.supportingOutputPath)
			])
			if (
				primary.sha256 !== supporting.sha256 ||
				primary.bytes !== supporting.bytes
			) {
				throw new Error(
					`${entry.sceneId} does not match reused source ${entry.source.supportingSceneId}`
				)
			}
			records.push({
				sceneId: entry.sceneId,
				batchId,
				outputPath: entry.outputPath,
				source: "reused-supporting",
				sha256: primary.sha256,
				bytes: primary.bytes,
				width: 768,
				height: 512,
				format: "webp",
				generatedAt: null
			})
			continue
		}

		const result = latest.get(entry.sceneId)
		if (!result) throw new Error(`${entry.sceneId} generation result is missing`)
		if (result.status === "failed") {
			throw new Error(
				`${entry.sceneId} latest result is failed: ${result.error ?? "unknown"}`
			)
		}
		if (result.status !== "generated" && result.status !== "skipped") {
			throw new Error(`${entry.sceneId} latest result is ${result.status}`)
		}
		if (
			result.batchId !== batchId ||
			result.outputPath !== entry.outputPath ||
			result.promptSha256 !== sha256(primaryPrompt(entry))
		) {
			throw new Error(`${entry.sceneId} result does not match its primary binding`)
		}
		const inspection = await inspectPrimaryWebp(entry.outputPath)
		if (
			result.finalSha256 !== inspection.sha256 ||
			result.finalBytes !== inspection.bytes
		) {
			throw new Error(`${entry.sceneId} result does not match the generated asset`)
		}
		records.push({
			sceneId: entry.sceneId,
			batchId,
			outputPath: entry.outputPath,
			source: "generated",
			sha256: inspection.sha256,
			bytes: inspection.bytes,
			width: 768,
			height: 512,
			format: "webp",
			generatedAt: result.generatedAt
		})
	}

	const ledger: PrimaryFinalizedResultsLedger = {
		schemaVersion: 1,
		planId: "LOB-PRIMARY-ART-v2",
		finalizedAt: new Date().toISOString(),
		records
	}
	const outputPath = options.outputPath ?? `${options.resultsPath}.finalized.json`
	if (options.write !== false) {
		await mkdir(dirname(outputPath), { recursive: true })
		await writeFile(outputPath, serializeJson(ledger))
	}
	return { ledger, outputPath }
}
