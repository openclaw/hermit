import { readFile, readdir } from "node:fs/promises"
import { describe, expect, it } from "bun:test"
import { generateLobsterArtworkPlanArtifacts } from "../scripts/build-lobster-art-plan.js"
import {
	buildArtworkBatchGraph,
	buildArtworkManifest,
	computeArtworkQuotaReport,
	serializeJson,
	sha256,
	validateArtworkPlan,
	type ArtworkBatchGraph,
	type ArtworkManifest
} from "../scripts/lib/lobster-artwork-plan.js"
import batchesData from "../data/lobster/artwork/batches.json" with {
	type: "json"
}
import manifestData from "../data/lobster/artwork/manifest.json" with {
	type: "json"
}
import provenanceData from "../data/lobster/artwork/provenance.json" with {
	type: "json"
}
import metadataData from "../data/lobster/metadata/lobster-metadata.json" with {
	type: "json"
}
import type { LobsterMetadataDataset } from "../scripts/lib/lobster-metadata.js"

const manifest = manifestData as ArtworkManifest
const batches = batchesData as ArtworkBatchGraph
const metadata = metadataData as LobsterMetadataDataset
const trustedInputs = {
	metadataSha256: sha256(serializeJson(metadata)),
	taxonomySha256: metadata.taxonomySha256,
	taxonomySnapshotId: metadata.taxonomySnapshotId
}
const cloneManifest = () => structuredClone(manifest) as ArtworkManifest
const cloneBatches = () => structuredClone(batches) as ArtworkBatchGraph

describe("lobster artwork production plan", () => {
	it("maps all 264 species and 1,056 scenes exactly once", () => {
		expect(manifest.entries).toHaveLength(1056)
		expect(new Set(manifest.entries.map((entry) => entry.sceneId)).size).toBe(
			1056
		)
		expect(
			new Set(manifest.entries.map((entry) => entry.outputPath)).size
		).toBe(1056)
		const bySpecies = Map.groupBy(
			manifest.entries,
			(entry) => entry.AphiaID
		)
		expect(bySpecies.size).toBe(264)
		expect([...bySpecies.values()].every((entries) => entries.length === 4)).toBe(
			true
		)
		const metadataSceneIds = metadataData.records.flatMap((record) =>
			record.scenePlans.map((scene) => scene.id)
		)
		expect(manifest.entries.map((entry) => entry.sceneId).sort()).toEqual(
			metadataSceneIds.sort()
		)
	})

	it("uses exact dimensions, paths, and complete production records", () => {
		for (const entry of manifest.entries) {
			expect(entry.dimensions).toEqual({
				width: 768,
				height: 512,
				format: "webp",
				aspectRatio: "3:2"
			})
			expect(entry.colorProfile).toBe("sRGB")
			expect(entry.largerMasterRetained).toBe(false)
			expect(entry.outputPath).toBe(
				`assets/lobster/scenes/${entry.AphiaID}/${entry.sceneId}.webp`
			)
			expect(entry.outputSha256).toMatch(/^[a-f0-9]{64}$/)
			expect(entry.outputBytes).toBeGreaterThan(0)
			expect(entry.status).toBe("complete")
			expect(entry.production).toEqual(
				expect.objectContaining({
					batchId: entry.batchId,
					model: "gpt-image-2",
					requestedSize: "1536x1024",
					quality: "medium",
					promptVersion: entry.promptVersion,
					promptSha256: entry.promptSha256,
					automatedReviewStatus: "passed",
					status: "complete"
				})
			)
			expect(entry.production?.final).toEqual(
				expect.objectContaining({
					sha256: entry.outputSha256,
					bytes: entry.outputBytes,
					width: 768,
					height: 512,
					format: "webp",
					colorSpace: "sRGB"
				})
			)
			expect(entry.reviews.scientificAnatomy).toEqual(
				expect.objectContaining({
					approver: "Peter Steinberger",
					status: "not-reviewed"
				})
			)
			expect(entry.reviews.finalArt).toEqual(
				expect.objectContaining({
					approver: "Hannes Rudolph",
					status: "not-reviewed"
				})
			)
		}
	})

	it("carries exact source identity, scene-family, and review fields", () => {
		const sourceByScene = new Map(
			metadata.records.flatMap((record) =>
				record.scenePlans.map((scene) => [
					scene.id,
					{ record, scene }
				] as const)
			)
		)
		for (const entry of manifest.entries) {
			const source = sourceByScene.get(entry.sceneId)!
			expect(entry.AphiaID).toBe(source.record.AphiaID)
			expect(entry.scientificName).toBe(source.record.scientificName)
			expect(entry.displayName).toBe(source.record.displayName)
			expect(entry.family).toBe(source.record.family)
			expect(entry.sceneFamilyId).toBe(source.scene.sceneFamilyId)
			expect(entry.humanReviewStatus).toBe(source.scene.humanReviewStatus)
			expect(entry.automatedReviewStatus).toBe(
				source.scene.automatedReviewStatus
			)
		}
	})

	it("builds stable disjoint batches of at most 25 exact species", () => {
		expect(batches.batches).toHaveLength(11)
		const species = batches.batches.flatMap((batch, index) => {
			expect(batch.id).toBe(
				`lob-art-v1-b${(index + 1).toString().padStart(3, "0")}`
			)
			expect(batch.speciesCount).toBe(batch.species.length)
			expect(batch.speciesCount).toBeLessThanOrEqual(25)
			expect(batch.sceneCount).toBe(batch.speciesCount * 4)
			return batch.species
		})
		expect(species).toHaveLength(264)
		expect(new Set(species.map((entry) => entry.AphiaID)).size).toBe(264)
		expect(species.map((entry) => entry.AphiaID)).toEqual(
			metadataData.records.map((record) => record.AphiaID)
		)
	})

	it("uses anatomy-supported species/action-specific safe prompts", () => {
		const metadataBySpecies = new Map(
			metadataData.records.map((record) => [record.AphiaID, record])
		)
		for (const entry of manifest.entries) {
			const metadata = metadataBySpecies.get(entry.AphiaID)!
			expect(
				metadata.permittedActions.some(
					(action) => action.id === entry.action.id
				)
			).toBe(true)
			expect(entry.finalPrompt).toContain(entry.scientificName)
			expect(entry.finalPrompt).toContain(entry.action.direction)
			expect(entry.finalPrompt).toContain("do not invent limbs")
			expect(entry.finalPrompt).toContain(
				"No text, lettering, captions, logos, brands, watermarks"
			)
			expect(entry.finalPrompt).toContain("third-party characters")
			expect(entry.promptSha256).toBe(sha256(entry.finalPrompt))
		}
		expect(new Set(manifest.entries.map((entry) => entry.finalPrompt)).size).toBe(
			1056
		)
	})

	it("preserves portfolio quotas", () => {
		const quota = computeArtworkQuotaReport(manifest)
		expect(quota.mediumMaxShare).toBeLessThanOrEqual(0.15)
		expect(quota.environmentFamilyMaxShare).toBeLessThan(0.1)
		expect(quota.officeHearingShare).toBeLessThan(0.03)
		expect(quota.castPatternMaxShare).toBeLessThanOrEqual(0.05)
		expect(quota.prominentAdultWomanHumanShare).toBeGreaterThanOrEqual(0.5)
		expect(quota.nonPhotorealisticShare).toBeGreaterThanOrEqual(0.2)
	})

	it("records the repository, immutable raw GitHub, trusted fetch, and Discord attachment contracts", () => {
		expect(manifest.deliveryContract.architecture).toBe("repository-assets")
		expect(manifest.deliveryContract.rawGitHub.urlTemplate).toContain(
			"raw.githubusercontent.com/openclaw/hermit/{gitCommitSha}/assets/lobster/scenes/"
		)
		expect(manifest.deliveryContract.rawGitHub.immutability).toContain(
			"full immutable commit SHA"
		)
		expect(manifest.deliveryContract.trustedFetch).toEqual(
			expect.objectContaining({
				allowedOrigin: "https://raw.githubusercontent.com",
				requiredPathPrefix: "/openclaw/hermit/",
				accept: "image/webp",
				requiredContentType: "image/webp",
				maximumBytes: 122880
			})
		)
		expect(manifest.deliveryContract.trustedFetch.validation).toContain(
			"exact-768x512"
		)
		expect(
			manifest.deliveryContract.discordAttachment.attachmentUrlTemplate
		).toStartWith("attachment://")
		expect(
			manifest.deliveryContract.discordAttachment.externalMediaInMessage
		).toBe(false)
	})

	it("rebuilds the planning projection offline and preserves production checksums", async () => {
		const first = await generateLobsterArtworkPlanArtifacts()
		const second = await generateLobsterArtworkPlanArtifacts()
		expect(second.manifestContents).toBe(first.manifestContents)
		expect(second.batchesContents).toBe(first.batchesContents)
		expect(second.provenanceContents).toBe(first.provenanceContents)
		const planningManifest = cloneManifest()
		for (const entry of planningManifest.entries) {
			entry.outputSha256 = null
			entry.outputBytes = null
			entry.status = "planned"
			delete entry.batchId
			delete entry.production
		}
		const planningBatches = cloneBatches()
		for (const batch of planningBatches.batches) delete batch.production
		planningBatches.manifestSha256 = sha256(serializeJson(planningManifest))
		expect(first.manifestContents).toBe(serializeJson(planningManifest))
		expect(first.batchesContents).toBe(serializeJson(planningBatches))
		expect(provenanceData.inputs.combinedSha256).toBe(first.inputSha256)
		expect(provenanceData.prompts.aggregateSha256).toBe(first.promptSha256)
		expect(provenanceData.outputs.manifest.sha256).toBe(
			sha256(await readFile("data/lobster/artwork/manifest.json"))
		)
		expect(provenanceData.outputs.batches.sha256).toBe(
			sha256(await readFile("data/lobster/artwork/batches.json"))
		)
		validateArtworkPlan(manifest, metadata, trustedInputs, batches)
	})

	it("rejects batch identity and scene-membership corruption", () => {
		for (const mutate of [
			(graph: ArtworkBatchGraph) => {
				graph.batches[0]!.species[0]!.scientificName = "Fabricated species"
			},
			(graph: ArtworkBatchGraph) => {
				graph.batches[0]!.species[0]!.family = "Fabricated family"
			},
			(graph: ArtworkBatchGraph) => {
				graph.batches[0]!.species[0]!.sceneIds[0] = "fabricated-scene"
			}
		]) {
			const corrupted = cloneBatches()
			mutate(corrupted)
				expect(() =>
					validateArtworkPlan(
						manifest,
						metadata,
						trustedInputs,
						corrupted
					)
				).toThrow("does not exactly match manifest")
		}
	})

	it("rejects fabricated anatomy, body plans, prompts, and evidence", () => {
		for (const mutate of [
			(plan: ArtworkManifest) => {
				plan.entries[0]!.anatomyFacts[0] = "Fabricated anatomy."
			},
			(plan: ArtworkManifest) => {
				plan.entries[0]!.bodyPlan = "fabricated body plan"
			},
			(plan: ArtworkManifest) => {
				plan.entries[0]!.action.evidenceScope = "Fabricated evidence."
			},
			(plan: ArtworkManifest) => {
				plan.entries[0]!.action.citationIds = []
			},
			(plan: ArtworkManifest) => {
				const entry = plan.entries[0]!
				entry.finalPrompt = entry.finalPrompt.replace(
					entry.anatomyFacts[0]!,
					"Fabricated prompt anatomy."
				)
				entry.promptSha256 = sha256(entry.finalPrompt)
			}
		]) {
			const corrupted = cloneManifest()
			mutate(corrupted)
			expect(() =>
				validateArtworkPlan(corrupted, metadata, trustedInputs)
			).toThrow()
		}
	})

	it("rejects mutated metadata outside projected artwork fields", () => {
		const corruptedMetadata = structuredClone(
			metadata
		) as LobsterMetadataDataset
		corruptedMetadata.records[0]!.depthBand.evidenceScope =
			"Fabricated unprojected metadata."
		expect(() =>
			validateArtworkPlan(
				manifest,
				corruptedMetadata,
				trustedInputs,
				batches
			)
		).toThrow("supplied metadata checksum")
	})

	it("rejects a forged declared metadata checksum", () => {
		const corrupted = cloneManifest()
		corrupted.metadata.sha256 = "0".repeat(64)
		expect(() =>
			validateArtworkPlan(corrupted, metadata, trustedInputs)
		).toThrow("manifest metadata checksum")
	})

	it("rejects consistently rebuilt plans with forged taxonomy identity", () => {
		const forgedMetadata = structuredClone(metadata) as LobsterMetadataDataset
		forgedMetadata.taxonomySnapshotId = "forged-taxonomy-snapshot" as
			typeof forgedMetadata.taxonomySnapshotId
		forgedMetadata.taxonomySha256 = "f".repeat(64) as
			typeof forgedMetadata.taxonomySha256
		const forgedMetadataSha256 = sha256(serializeJson(forgedMetadata))
		const forgedManifest = buildArtworkManifest(
			forgedMetadata,
			forgedMetadataSha256
		)
		const forgedBatches = buildArtworkBatchGraph(
			forgedManifest,
			sha256(serializeJson(forgedManifest))
		)
		expect(() =>
			validateArtworkPlan(
				forgedManifest,
				forgedMetadata,
				trustedInputs,
				forgedBatches
			)
		).toThrow("taxonomy identity")
	})

	it("contains no prohibited storage endpoints and explicitly disables R2", async () => {
		const generatedNames = await readdir("data/lobster/artwork", {
			recursive: true
		})
		const ownedPaths = [
			"scripts/build-lobster-art-plan.ts",
			"scripts/lib/lobster-artwork-plan.ts",
			"tests/lobsterArtworkPlan.test.ts",
			...generatedNames.map((name) => `data/lobster/artwork/${name}`)
		]
		const ownedText = (
			await Promise.all(ownedPaths.map((path) => readFile(path, "utf8")))
		)
			.join("\n")
			.toLowerCase()
		expect(ownedText).not.toContain(["cloud", "flare"].join(""))
		expect(ownedText).not.toContain(["r", "2", "."].join(""))
		expect(provenanceData.production.deliveryContract.r2).toEqual({
			used: false,
			role: "none"
		})
	})
})
