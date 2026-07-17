import {
	cp,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	utimes,
	writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import manifestData from "../data/lobster/artwork/manifest.json" with {
	type: "json"
}
import {
	hammingDistance64,
	runLobsterAssetQa
} from "../scripts/lib/lobster-asset-qa.js"
import {
	importGenerationResults,
	loadRemediationRegistry,
	serializeJson
} from "../scripts/lib/lobster-art-evidence.js"
import type { ArtworkManifest } from "../scripts/lib/lobster-artwork-plan.js"
import { parseQaArguments } from "../scripts/qa-lobster-assets.js"

const temporaryDirectories: string[] = []

const temporaryDirectory = async () => {
	const path = await mkdtemp(join(tmpdir(), "hermit-lobster-qa-"))
	temporaryDirectories.push(path)
	return path
}

const writeTrackedLedger = async (
	root: string,
	entries: (typeof manifestData.entries)[number][]
) => {
	const logsRoot = join(root, "logs")
	await mkdir(logsRoot, { recursive: true })
	const logLines = await Promise.all(
		entries.map(async (entry) => {
			const bytes = await readFile(join(root, entry.outputPath))
			const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
			return JSON.stringify({
				batchId: entry.batchId,
				sceneId: entry.sceneId,
				AphiaID: entry.AphiaID,
				outputPath: entry.outputPath,
				status: "generated",
				model: "gpt-image-2",
				generatorPath:
					"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py",
				requestedSize: "1536x1024",
				quality: "medium",
				sourceOutput: { format: "webp", compression: 100 },
				promptVersion: entry.promptVersion,
				promptSha256: entry.promptSha256,
				generatedAt: "2026-07-17T00:00:00.000Z",
				finalSha256: digest,
				finalBytes: bytes.length,
				dimensions: { width: 768, height: 512, format: "webp" }
			})
		})
	)
	await writeFile(join(logsRoot, "results.jsonl"), `${logLines.join("\n")}\n`)
	const ledger = await importGenerationResults(
		manifestData as ArtworkManifest,
		{
			logRoot: logsRoot,
			existing: null,
			remediation: await loadRemediationRegistry()
		}
	)
	const ledgerPath = join(root, "generation-results.json")
	await writeFile(ledgerPath, serializeJson(ledger))
	return ledgerPath
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) =>
			rm(path, { recursive: true, force: true })
		)
	)
})

describe("lobster asset QA", () => {
	it("parses explicit strict and partial CLI modes", () => {
		expect(
			parseQaArguments([
				"--mode",
				"strict",
				"--report",
				"tmp/report.json",
				"--near-duplicate-threshold",
				"4"
			])
		).toEqual({
			mode: "strict",
			reportPath: "tmp/report.json",
			generationResultsPath:
				"data/lobster/artwork/generation-results.json",
			nearDuplicateThreshold: 4
		})
		expect(() =>
			parseQaArguments(["--mode", "release", "--report", "report.json"])
		).toThrow("--mode must be partial or strict")
	})

	it("uses deterministic 64-bit Hamming distance", () => {
		expect(hammingDistance64("0000000000000000", "0000000000000000")).toBe(0)
		expect(hammingDistance64("0000000000000000", "ffffffffffffffff")).toBe(
			64
		)
		expect(hammingDistance64("0000000000000000", "000000000000001f")).toBe(5)
	})

	it("uses generatedAt precedence instead of filesystem mtime", async () => {
		const root = await temporaryDirectory()
		const logsRoot = join(root, "logs")
		await mkdir(logsRoot, { recursive: true })
		const entry = manifestData.entries[0]!
		const base = {
			batchId: entry.batchId,
			sceneId: entry.sceneId,
			AphiaID: entry.AphiaID,
			outputPath: entry.outputPath,
			status: "generated",
			model: "gpt-image-2",
			generatorPath:
				"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py",
			requestedSize: "1536x1024",
			quality: "medium",
			sourceOutput: { format: "webp", compression: 100 },
			promptVersion: entry.promptVersion,
			promptSha256: entry.promptSha256,
			finalBytes: 1,
			dimensions: { width: 768, height: 512, format: "webp" },
			compression: {
				codec: "cwebp",
				targetBytes: 75000,
				maximumBytes: 122880
			},
			attempts: 1
		}
		const olderPath = join(logsRoot, "z-newer-mtime.jsonl")
		const newerPath = join(logsRoot, "a-older-mtime.jsonl")
		await writeFile(
			olderPath,
			`${JSON.stringify({
				...base,
				generatedAt: "2026-07-17T10:00:00.000Z",
				finalSha256: "a".repeat(64)
			})}\n`
		)
		await writeFile(
			newerPath,
			`${JSON.stringify({
				...base,
				generatedAt: "2026-07-17T11:00:00.000Z",
				finalSha256: "b".repeat(64)
			})}\n`
		)
		await utimes(olderPath, new Date("2026-07-17T12:00:00Z"), new Date("2026-07-17T12:00:00Z"))
		await utimes(newerPath, new Date("2026-07-17T09:00:00Z"), new Date("2026-07-17T09:00:00Z"))
		const ledger = await importGenerationResults(
			manifestData as ArtworkManifest,
			{
				logRoot: logsRoot,
				existing: null,
				remediation: await loadRemediationRegistry()
			}
		)
		expect(ledger.records[0]?.generatedAt).toBe("2026-07-17T11:00:00.000Z")
		expect(ledger.records[0]?.finalSha256).toBe("b".repeat(64))
		expect(ledger.precedence.filesystemMtimeUsed).toBe(false)
	})

	it("reports missing coverage as pending in partial mode and fails exact duplicates", async () => {
		const root = await temporaryDirectory()
		const assetsRoot = join(root, "assets", "lobster", "scenes")
		const logsRoot = join(root, "logs")
		const reportPath = join(root, "qa-report.json")
		const entries = manifestData.entries.slice(0, 2)
		await mkdir(logsRoot, { recursive: true })
		for (const entry of entries) {
			const destination = join(root, entry.outputPath)
			await mkdir(join(destination, ".."), { recursive: true })
			await cp(
				"assets/lobster/scenes/107253/lob-v1-a107253-s01.webp",
				destination
			)
		}
		const generationResultsPath = await writeTrackedLedger(root, entries)
		const report = await runLobsterAssetQa({
			mode: "partial",
			reportPath,
			assetsRoot,
			generationResultsPath,
			concurrency: 2
		})
		expect(
			report.criteria.find((entry) => entry.id === "manifest-coverage")?.status
		).toBe("pending")
		expect(
			report.criteria.find((entry) => entry.id === "exact-duplicates")?.status
		).toBe("fail")
		expect(
			report.criteria.find(
				(entry) => entry.id === "riff-decode-dimensions-color"
			)?.status
		).toBe("pass")
		expect(report.exactDuplicates).toEqual([
			expect.objectContaining({
				leftSceneId: entries[0]!.sceneId,
				rightSceneId: entries[1]!.sceneId
			})
		])
		expect(JSON.parse(await readFile(reportPath, "utf8")).passed).toBe(false)
	})

	it("fails and identifies non-identical files within the perceptual threshold", async () => {
		const root = await temporaryDirectory()
		const entries = manifestData.entries.slice(0, 2)
		await mkdir(join(root, "logs"), { recursive: true })
		for (const [index, entry] of entries.entries()) {
			const destination = join(root, entry.outputPath)
			await mkdir(join(destination, ".."), { recursive: true })
			const child = Bun.spawn([
				"magick",
				"-size",
				"768x512",
				`xc:${index === 0 ? "red" : "blue"}`,
				"-colorspace",
				"sRGB",
				destination
			])
			expect(await child.exited).toBe(0)
		}
		const generationResultsPath = await writeTrackedLedger(root, entries)
		const report = await runLobsterAssetQa({
			mode: "partial",
			assetsRoot: join(root, "assets", "lobster", "scenes"),
			generationResultsPath,
			concurrency: 2
		})
		expect(report.exactDuplicates).toEqual([])
		expect(report.nearDuplicates).toEqual([
			{
				leftSceneId: entries[0]!.sceneId,
				rightSceneId: entries[1]!.sceneId,
				distance: 0
			}
		])
		expect(
			report.criteria.find(
				(entry) => entry.id === "perceptual-near-duplicates"
			)?.status
		).toBe("fail")
		expect(
			report.configuration.perceptualHash.nearDuplicateHammingThreshold
		).toBe(5)
	})

	it("strict mode fails an incomplete corpus without treating human review as automated proof", async () => {
		const root = await temporaryDirectory()
		const generationResultsPath = await writeTrackedLedger(root, [])
		const report = await runLobsterAssetQa({
			mode: "strict",
			assetsRoot: join(root, "empty-assets"),
			generationResultsPath,
			concurrency: 1
		})
		expect(
			report.criteria.find((entry) => entry.id === "manifest-coverage")?.status
		).toBe("fail")
		expect(
			report.criteria.find((entry) => entry.id === "human-review")?.status
		).toBe("pending")
		expect(report.humanReview.scientificAnatomy).toBe("pending")
		expect(report.humanReview.finalArt).toBe("pending")
	})
})
