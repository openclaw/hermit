import { describe, expect, it } from "bun:test"
import metadataData from "../data/lobster/metadata/lobster-metadata.json" with {
	type: "json"
}
import batchesData from "../data/lobster/artwork/primary-batches.json" with {
	type: "json"
}
import planData from "../data/lobster/artwork/primary-manifest.json" with {
	type: "json"
}
import runtimeData from "../data/lobster/artwork/primary-runtime.json" with {
	type: "json"
}
import { generateLobsterPrimaryArtworkArtifacts } from "../scripts/build-lobster-primary-art-plan.js"
import type { LobsterMetadataDataset } from "../scripts/lib/lobster-metadata.js"
import {
	parsePrimaryArtworkPlan,
	parsePrimaryArtworkRuntimeManifest,
	selectPrimaryAction,
	serializePrimaryArtworkJson,
	sha256,
	validatePrimaryArtworkBatches,
	validatePrimaryArtworkRuntimeManifest,
	type PrimaryArtworkBatches,
	type PrimaryArtworkPlan,
	type PrimaryArtworkRuntimeManifest
} from "../scripts/lib/lobster-primary-artwork.js"
import {
	getLobsterPrimaryArtwork,
	lobsterPrimaryArtwork
} from "../src/config/lobsterPrimaryArtwork.js"

const metadata = metadataData as LobsterMetadataDataset
const plan = parsePrimaryArtworkPlan(planData, metadata)
const batches = batchesData as PrimaryArtworkBatches
const runtime = parsePrimaryArtworkRuntimeManifest(runtimeData)

const maxShare = (values: readonly string[]) => {
	const counts = new Map<string, number>()
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
	return Math.max(...counts.values()) / values.length
}

describe("lobster v2 primary artwork", () => {
	it("binds every AphiaID exactly once with stable IDs and new generated paths", () => {
		expect(plan.entries).toHaveLength(264)
		expect(runtime.entries).toHaveLength(264)
		expect(new Set(plan.entries.map(({ AphiaID }) => AphiaID)).size).toBe(264)
		expect(plan.entries.every((entry) => entry.source.kind === "generated")).toBe(
			true
		)
		expect(
			runtime.entries.every((entry) => entry.source === "generated")
		).toBe(true)
		for (const entry of plan.entries) {
			expect(entry.sceneId).toBe(`lob-v2-a${entry.AphiaID}-primary`)
			expect(entry.outputPath).toBe(
				`assets/lobster/primary/${entry.AphiaID}/${entry.sceneId}.webp`
			)
			expect(entry.dimensions).toEqual({
				width: 768,
				height: 512,
				format: "webp",
				aspectRatio: "3:2"
			})
		}
	})

	it("selects only committed actions with physical consequence before strongest morphology", () => {
		const expectedByFamily = {
			Nephropidae: "pinch",
			Enoplometopidae: "pinch",
			Palinuridae: "antenna-strike",
			Scyllaridae: "antenna-plate-refusal",
			Polychelidae: "multi-chela-stand-off",
			Glypheidae: "subchelate-stand-off"
		}
		const metadataById = new Map(
			metadata.records.map((record) => [record.AphiaID, record])
		)
		for (const entry of plan.entries) {
			const record = metadataById.get(entry.AphiaID)!
			expect(entry.action.id).toBe(selectPrimaryAction(record))
			expect(entry.action.id).toBe(
				expectedByFamily[record.family as keyof typeof expectedByFamily]
			)
			expect(
				record.permittedActions.some(({ id }) => id === entry.action.id)
			).toBe(true)
		}
	})

	it("requires a visible generic adult target, explicit humor, anatomy, and prompt SHA", () => {
		for (const entry of plan.entries) {
			expect(entry.cast.target).toEqual(
				expect.objectContaining({
					adultStatus: "adult",
					identity: "generic-unidentified-person",
					prominence: "prominent"
				})
			)
			expect(entry.cast.diverPresent).toBe(false)
			expect(entry.targetRelationship).toContain("generic adult target")
			expect(entry.humorBeat.length).toBeGreaterThan(20)
			expect(entry.familyAnatomyConstraints.length).toBeGreaterThan(0)
			expect(entry.prompt).toContain(entry.targetRelationship)
			expect(entry.prompt).toContain(entry.humorBeat)
			expect(entry.prompt).toContain("not based on any real Discord user")
			expect(entry.promptSha256).toBe(sha256(entry.prompt))
		}
	})

	it("enforces strong corpus variation without office or diver dominance", () => {
		expect(maxShare(plan.entries.map(({ medium }) => medium))).toBeLessThanOrEqual(
			0.08
		)
		expect(
			maxShare(plan.entries.map(({ environment }) => environment))
		).toBeLessThanOrEqual(0.07)
		expect(maxShare(plan.entries.map(({ era }) => era))).toBeLessThanOrEqual(0.11)
		expect(maxShare(plan.entries.map(({ tone }) => tone))).toBeLessThanOrEqual(
			0.08
		)
		expect(
			maxShare(plan.entries.map(({ cast }) => cast.patternId))
		).toBeLessThanOrEqual(0.1)
		expect(
			maxShare(
				plan.entries.map(({ cast }) => cast.target.genderPresentation)
			)
		).toBeLessThanOrEqual(0.35)
		expect(
			plan.entries.filter(({ environment }) => environment.includes("office"))
		).toHaveLength(0)
		expect(
			plan.entries.filter(
				({ cast, environment }) =>
					cast.diverPresent || environment.includes("dive")
			)
		).toHaveLength(0)
	})

	it("keeps all review gates pending without claiming Peter Steinberger approval", () => {
		expect(plan.reviewPolicy.scientificAnatomy.status).toBe(
			"designated-not-reviewed"
		)
		expect(plan.reviewPolicy.scientificAnatomy.statement).toContain(
			"does not claim"
		)
		for (const entry of plan.entries) {
			expect(entry.reviews.anatomy).toEqual(
				expect.objectContaining({
					designatedApprover: "Peter Steinberger",
					status: "not-reviewed",
					reviewedAt: null,
					notes: null
				})
			)
			expect(
				Object.values(entry.reviews).every(
					(review) => review.status === "not-reviewed"
				)
			).toBe(true)
		}
	})

	it("ships a lightweight runtime projection with optional reuse support", () => {
		validatePrimaryArtworkBatches(batches, plan)
		expect(batches.planId).toBe("LOB-PRIMARY-ART-v2")
		expect(batches.batchSizeLimit).toBe(24)
		expect(batches.batches).toHaveLength(11)
		expect(
			batches.batches.every((batch) => batch.sceneIds.length <= 24)
		).toBe(true)
		expect(
			new Set(batches.batches.flatMap(({ sceneIds }) => sceneIds)).size
		).toBe(264)
		validatePrimaryArtworkRuntimeManifest(runtime, plan)
		expect(lobsterPrimaryArtwork).toEqual(runtime)
		for (const entry of runtime.entries) {
			expect(Object.keys(entry).sort()).toEqual(
				[
					"AphiaID",
					"action",
					"altText",
					"relativeOutputPath",
					"reviewStates",
					"sceneId",
					"source"
				].sort()
			)
			expect(getLobsterPrimaryArtwork(entry.AphiaID)).toEqual(entry)
			expect(entry.relativeOutputPath).toBe(
				`lobster/primary/${entry.AphiaID}/${entry.sceneId}.webp`
			)
		}
	})

	it("serializes deterministically and rejects parser/runtime corruption", async () => {
		const first = await generateLobsterPrimaryArtworkArtifacts()
		const second = await generateLobsterPrimaryArtworkArtifacts()
		expect(second.planContents).toBe(first.planContents)
		expect(second.batchesContents).toBe(first.batchesContents)
		expect(second.runtimeContents).toBe(first.runtimeContents)
		expect(first.planContents).toBe(serializePrimaryArtworkJson(plan))
		expect(first.batchesContents).toBe(serializePrimaryArtworkJson(batches))
		expect(first.runtimeContents).toBe(serializePrimaryArtworkJson(runtime))

		const duplicate = structuredClone(runtime) as PrimaryArtworkRuntimeManifest
		duplicate.entries[1]!.AphiaID = duplicate.entries[0]!.AphiaID
		expect(() => validatePrimaryArtworkRuntimeManifest(duplicate)).toThrow(
			"duplicate runtime AphiaID"
		)

		const falseApproval = structuredClone(plan) as PrimaryArtworkPlan
		falseApproval.entries[0]!.reviews.anatomy.status = "approved"
		expect(() => parsePrimaryArtworkPlan(falseApproval, metadata)).toThrow(
			"falsely claims a completed review"
		)

		const unknownRuntimeKey = structuredClone(runtimeData) as Record<
			string,
			unknown
		>
		unknownRuntimeKey.extra = true
		expect(() => parsePrimaryArtworkRuntimeManifest(unknownRuntimeKey)).toThrow(
			"unknown key extra"
		)
	})
})
