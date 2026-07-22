import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { parsePrimaryGenerationArguments } from "../scripts/generate-lobster-primary-art.js"
import {
	PRIMARY_HEIGHT,
	PRIMARY_WIDTH,
	selectPrimaryEntries,
	serializeJson,
	sha256,
	validatePrimaryPlan
} from "../scripts/lib/lobster-primary-art-contract.js"
import { groupPrimaryContactSheets } from "../scripts/lib/lobster-primary-art-contact-sheets.js"
import { runPrimaryArtQa } from "../scripts/lib/lobster-primary-art-qa.js"
import { importPrimaryArtResults } from "../scripts/lib/lobster-primary-art-results.js"
import type {
	PrimaryArtworkBatches,
	PrimaryArtworkEntry,
	PrimaryArtworkPlan
} from "../scripts/lib/lobster-primary-artwork.js"

const fixtureRoots: string[] = []

afterEach(async () => {
	await Promise.all(
		fixtureRoots.splice(0).map((path) =>
			rm(path, { recursive: true, force: true })
		)
	)
})

const approvedReviews = (entry: PrimaryArtworkEntry) => {
	const reviewedAt = "2026-07-21T00:00:00.000Z"
	return {
		targetRelation: { status: "approved" as const, reviewedAt, notes: null },
		actionClarity: { status: "approved" as const, reviewedAt, notes: null },
		humor: { status: "approved" as const, reviewedAt, notes: null },
		anatomy: {
			...entry.reviews.anatomy,
			status: "approved" as const,
			reviewedAt,
			notes: null
		},
		finalArt: {
			...entry.reviews.finalArt,
			status: "approved" as const,
			reviewedAt,
			notes: null
		}
	}
}

const fixture = async (count = 1) => {
	const source = JSON.parse(
		await readFile("data/lobster/artwork/primary-manifest.json", "utf8")
	) as PrimaryArtworkPlan
	const ids = Array.from({ length: count }, (_, index) => 9_900_001 + index)
	const entries = ids.map((AphiaID, index): PrimaryArtworkEntry => {
		const original = structuredClone(source.entries[index]!)
		const sceneId = `lob-v2-a${AphiaID}-primary`
		const outputPath = `assets/lobster/primary/${AphiaID}/${sceneId}.webp`
		fixtureRoots.push(`assets/lobster/primary/${AphiaID}`)
		return {
			...original,
			AphiaID,
			sceneId,
			outputPath,
			source: { kind: "generated" },
			reviews: approvedReviews(original)
		}
	})
	const manifest: PrimaryArtworkPlan = {
		...structuredClone(source),
		entries
	}
	const batches: PrimaryArtworkBatches = {
		schemaVersion: 1,
		planId: "LOB-PRIMARY-ART-v2",
		batchSizeLimit: 24,
		batches: [
			{
				id: "lob-primary-v2-b001",
				index: 1,
				sceneIds: entries.map(({ sceneId }) => sceneId)
			}
		]
	}
	await mkdir("tmp/lobster-primary-tests", { recursive: true })
	const root = resolve(
		"tmp/lobster-primary-tests",
		`${process.pid}-${Date.now()}-${Math.random()}`
	)
	fixtureRoots.push(root)
	await mkdir(root, { recursive: true })
	const manifestPath = resolve(root, "primary-plan.json")
	const batchesPath = resolve(root, "primary-batches.json")
	await Promise.all([
		writeFile(manifestPath, serializeJson(manifest)),
		writeFile(batchesPath, serializeJson(batches))
	])
	return { root, entries, manifest, batches, manifestPath, batchesPath }
}

const writeFinalizedLedger = async (
	root: string,
	entry: PrimaryArtworkEntry,
	bytes: Uint8Array,
	source: "generated" | "reused-supporting" = "generated"
) => {
	const path = resolve(root, "finalized-results.json")
	await writeFile(
		path,
		serializeJson({
			schemaVersion: 1,
			planId: "LOB-PRIMARY-ART-v2",
			finalizedAt: "2026-07-21T00:00:00.000Z",
			records: [
				{
					sceneId: entry.sceneId,
					batchId: "lob-primary-v2-b001",
					outputPath: entry.outputPath,
					source,
					sha256: sha256(bytes),
					bytes: bytes.length,
					width: PRIMARY_WIDTH,
					height: PRIMARY_HEIGHT,
					format: "webp",
					generatedAt:
						source === "generated"
							? "2026-07-21T00:00:00.000Z"
							: null
				}
			]
		})
	)
	return path
}

const fakeInspection = (bytes: Uint8Array) => async () => ({
	width: PRIMARY_WIDTH,
	height: PRIMARY_HEIGHT,
	format: "WEBP" as const,
	colorSpace: "sRGB",
	bytes: bytes.length,
	sha256: sha256(bytes)
})

describe("lobster primary art contracts", () => {
	it("selects only scenes bound to the requested batch", async () => {
		const { manifest, batches } = await fixture(2)
		const plan = validatePrimaryPlan(manifest, batches, 2)
		expect(
			selectPrimaryEntries(
				plan,
				"lob-primary-v2-b001",
				[manifest.entries[1]!.sceneId],
				false
			).map(({ sceneId }) => sceneId)
		).toEqual([manifest.entries[1]!.sceneId])
		expect(() =>
			selectPrimaryEntries(
				plan,
				"lob-primary-v2-b001",
				["missing"],
				false
			)
		).toThrow("does not belong")
	})

	it("parses repeated scenes and required generation controls", () => {
		expect(
			parsePrimaryGenerationArguments([
				"--batch",
				"lob-primary-v2-b001",
				"--scene",
				"scene-1",
				"--scene",
				"scene-2",
				"--quality",
				"low",
				"--dry-run",
				"--force",
				"--results",
				"tmp/results.jsonl"
			])
		).toEqual(
			expect.objectContaining({
				sceneIds: ["scene-1", "scene-2"],
				quality: "low",
				dryRun: true,
				force: true
			})
		)
	})

	it("groups contact sheets by exact family and action", async () => {
		const { entries } = await fixture(2)
		entries[1]!.family = "Palinuridae"
		entries[1]!.action = {
			...entries[1]!.action,
			id: "antenna-strike"
		}
		expect(
			groupPrimaryContactSheets(entries).map(
				({ family, actionId, entries: grouped }) => ({
					family,
					actionId,
					sceneIds: grouped.map(({ sceneId }) => sceneId)
				})
			)
		).toEqual([
			{
				family: "Nephropidae",
				actionId: "pinch",
				sceneIds: [entries[0]!.sceneId]
			},
			{
				family: "Palinuridae",
				actionId: "antenna-strike",
				sceneIds: [entries[1]!.sceneId]
			}
		])
	})
})

describe("lobster primary art strict QA", () => {
	it("fails a planner not-reviewed state even when the asset is complete", async () => {
		const data = await fixture()
		data.manifest.entries[0]!.reviews.humor.status = "not-reviewed"
		await writeFile(data.manifestPath, serializeJson(data.manifest))
		const bytes = new TextEncoder().encode("primary asset")
		await mkdir(resolve(data.entries[0]!.outputPath, ".."), { recursive: true })
		await writeFile(data.entries[0]!.outputPath, bytes)
		const resultsPath = await writeFinalizedLedger(
			data.root,
			data.entries[0]!,
			bytes
		)

		const report = await runPrimaryArtQa({
			manifestPath: data.manifestPath,
			batchesPath: data.batchesPath,
			resultsPath,
			expectedCount: 1,
			inspect: fakeInspection(bytes)
		})
		expect(report.passed).toBe(false)
		expect(
			report.criteria.find(({ id }) => id === "reviews")?.details
		).toContain(`${data.entries[0]!.sceneId}: humor review is not-reviewed`)
	})

	it("allows an approved reused-supporting asset with exact source bytes", async () => {
		const data = await fixture()
		const entry = data.manifest.entries[0]!
		const supportingSceneId = "lob-v1-supporting"
		const supportingOutputPath = resolve(data.root, `${supportingSceneId}.webp`)
		entry.source = {
			kind: "reused-supporting",
			supportingSceneId,
			supportingOutputPath
		}
		await writeFile(data.manifestPath, serializeJson(data.manifest))
		const bytes = new TextEncoder().encode("audited reused asset")
		await mkdir(resolve(entry.outputPath, ".."), { recursive: true })
		await Promise.all([
			writeFile(entry.outputPath, bytes),
			writeFile(supportingOutputPath, bytes)
		])
		const resultsPath = await writeFinalizedLedger(
			data.root,
			entry,
			bytes,
			"reused-supporting"
		)

		const report = await runPrimaryArtQa({
			manifestPath: data.manifestPath,
			batchesPath: data.batchesPath,
			resultsPath,
			expectedCount: 1,
			inspect: fakeInspection(bytes)
		})
		expect(report.passed).toBe(true)
		expect(report.summary.reusedAssets).toBe(1)
	})
})

describe("lobster primary art result import", () => {
	it("writes file facts to a separate ledger without changing planner reviews", async () => {
		const data = await fixture()
		const entry = data.entries[0]!
		await mkdir(resolve(entry.outputPath, ".."), { recursive: true })
		const generated = Bun.spawnSync([
			"magick",
			"-size",
			`${PRIMARY_WIDTH}x${PRIMARY_HEIGHT}`,
			"xc:#c43b31",
			"-strip",
			"-colorspace",
			"sRGB",
			entry.outputPath
		])
		expect(generated.exitCode).toBe(0)
		const bytes = await readFile(entry.outputPath)
		const planBefore = await readFile(data.manifestPath, "utf8")
		const resultsPath = resolve(data.root, "results.jsonl")
		const outputPath = resolve(data.root, "finalized.json")
		await writeFile(
			resultsPath,
			`${JSON.stringify({
				schemaVersion: 1,
				batchId: "lob-primary-v2-b001",
				sceneId: entry.sceneId,
				outputPath: entry.outputPath,
				status: "generated",
				model: "gpt-image-2",
				generatorPath:
					"/Users/hrudolph/.codex/skills/.system/imagegen/scripts/image_gen.py",
				requestedSize: "1536x1024",
				quality: "medium",
				promptSha256: entry.promptSha256,
				generatedAt: "2026-07-21T00:00:00.000Z",
				finalSha256: sha256(bytes),
				finalBytes: bytes.length,
				dimensions: {
					width: PRIMARY_WIDTH,
					height: PRIMARY_HEIGHT,
					format: "webp"
				},
				attempts: 1
			})}\n`
		)

		const result = await importPrimaryArtResults({
			resultsPath,
			outputPath,
			manifestPath: data.manifestPath,
			batchesPath: data.batchesPath,
			expectedCount: 1
		})
		expect(result.ledger.records[0]).toEqual(
			expect.objectContaining({
				sceneId: entry.sceneId,
				sha256: sha256(bytes),
				bytes: bytes.length
			})
		)
		expect(await readFile(data.manifestPath, "utf8")).toBe(planBefore)
	})
})
