import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "bun:test"
import manifestData from "../data/lobster/artwork/manifest.json" with {
	type: "json"
}
import batchesData from "../data/lobster/artwork/batches.json" with {
	type: "json"
}
import provenanceData from "../data/lobster/artwork/provenance.json" with {
	type: "json"
}
import { finalizeLobsterArtwork } from "../scripts/lib/lobster-art-finalization.js"

const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

describe("lobster artwork finalization", () => {
	it(
		"is byte-identical when recomputed from stopped generation inputs",
		async () => {
			const finalized = await finalizeLobsterArtwork()
			expect(finalized.manifestContents).toBe(
				await readFile("data/lobster/artwork/manifest.json", "utf8")
			)
			expect(finalized.batchesContents).toBe(
				await readFile("data/lobster/artwork/batches.json", "utf8")
			)
			expect(finalized.provenanceContents).toBe(
				await readFile("data/lobster/artwork/provenance.json", "utf8")
			)
		},
		180_000
	)

	it("binds every exact batch inventory and corpus checksum", async () => {
		const entriesById = new Map(
			manifestData.entries.map((entry) => [entry.sceneId, entry])
		)
		const corpusAssets = createHash("sha256")
		const corpusInventory = createHash("sha256")
		let totalBytes = 0
		for (const entry of manifestData.entries) {
			const bytes = await readFile(entry.outputPath)
			expect(entry.outputSha256).toBe(sha256(bytes))
			expect(entry.outputBytes).toBe(bytes.length)
			expect(entry.production.final.sha256).toBe(entry.outputSha256)
			expect(entry.production.final.bytes).toBe(entry.outputBytes)
			totalBytes += bytes.length
			corpusAssets.update(bytes)
			corpusInventory.update(
				[
					entry.sceneId,
					entry.outputPath,
					entry.outputSha256,
					entry.outputBytes,
					768,
					512,
					"webp"
				].join("\t") + "\n"
			)
		}
		for (const batch of batchesData.batches) {
			const sceneIds = batch.species.flatMap((species) => species.sceneIds)
			expect(batch.production.status).toBe("complete")
			expect(batch.production.sceneCount).toBe(sceneIds.length)
			expect(
				sceneIds.every((sceneId) => entriesById.get(sceneId)?.batchId === batch.id)
			).toBe(true)
		}
		expect(provenanceData.production.corpus).toEqual(
			expect.objectContaining({
				assetCount: 1056,
				totalBytes,
				aggregateAssetSha256: corpusAssets.digest("hex"),
				inventorySha256: corpusInventory.digest("hex")
			})
		)
		expect(provenanceData.production.generationHistory).toEqual(
			expect.objectContaining({
				supersededFailureCount: 17,
				unresolvedFailureCount: 0,
				unresolvedFailures: []
			})
		)
		expect(provenanceData.production.humanReview).toEqual({
			scientificAnatomy: {
				approver: "Peter Steinberger",
				status: "not-reviewed"
			},
			finalArt: {
				approver: "Hannes Rudolph",
				status: "not-reviewed"
			}
		})
	})
})
