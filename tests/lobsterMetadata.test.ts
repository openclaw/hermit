import { readFile } from "node:fs/promises"
import { describe, expect, it } from "bun:test"
import { generateLobsterMetadataArtifacts } from "../scripts/build-lobster-metadata.js"
import {
	ACTION_REGISTRY,
	computeSceneQuotaReport,
	LOBSTER_METADATA_SOURCE_POLICY_SHA256,
	LOBSTER_METADATA_SNAPSHOT_ID,
	LOBSTER_TAXONOMY_SHA256,
	type LobsterActionId,
	type LobsterMetadataDataset,
	type LobsterMetadataRecord,
	type LobsterMetadataSourceConfig,
	parseLobsterMetadataDataset,
	parseLobsterMetadataSourceConfig,
	serializeJson,
	sha256,
	validateActionPermission,
	validateLobsterMetadataDataset,
	validateLobsterMetadataRecord
} from "../scripts/lib/lobster-metadata.js"
import metadataData from "../data/lobster/metadata/lobster-metadata.json" with {
	type: "json"
}
import metadataProvenance from "../data/lobster/metadata/provenance.json" with {
	type: "json"
}
import sourceConfigData from "../data/lobster/metadata/source/metadata-config.json" with {
	type: "json"
}
import taxonomyData from "../data/lobster/taxonomy/lobster-species.json" with {
	type: "json"
}

const taxonomyRecords = taxonomyData.records
const expectedAphiaIds = taxonomyRecords.map((record) => record.AphiaID)
const sourceConfig = parseLobsterMetadataSourceConfig(sourceConfigData)
const dataset = parseLobsterMetadataDataset(
	metadataData,
	taxonomyRecords,
	sourceConfig
)

const cloneDataset = () => structuredClone(dataset) as LobsterMetadataDataset
const cloneConfig = () =>
	structuredClone(sourceConfig) as LobsterMetadataSourceConfig

const substantiveTuple = (scene: LobsterMetadataRecord["scenePlans"][number]) =>
	JSON.stringify([
		scene.action,
		scene.environment,
		scene.era,
		scene.medium,
		scene.tone,
		scene.cast,
		scene.camera,
		scene.composition,
		scene.lighting,
		scene.palette,
		scene.promptVersion,
		scene.humanReviewStatus,
		scene.automatedReviewStatus,
		scene.output
	])

describe("lobster metadata coverage and scientific evidence", () => {
	it("covers every frozen AphiaID exactly once in sorted order", () => {
		const metadataAphiaIds = dataset.records.map((record) => record.AphiaID)

		expect(dataset.records).toHaveLength(264)
		expect(metadataAphiaIds).toEqual(expectedAphiaIds)
		expect(metadataAphiaIds).toEqual(
			metadataAphiaIds.toSorted((left, right) => left - right)
		)
		expect(new Set(metadataAphiaIds).size).toBe(264)
		validateLobsterMetadataDataset(dataset, taxonomyRecords, sourceConfig)
	})

	it("binds metadata and provenance to the exact taxonomy snapshot and bytes", async () => {
		const taxonomyBytes = await readFile(
			"data/lobster/taxonomy/lobster-species.json"
		)

		expect(dataset.taxonomySnapshotId).toBe(LOBSTER_METADATA_SNAPSHOT_ID)
		expect(dataset.taxonomySha256).toBe(LOBSTER_TAXONOMY_SHA256)
		expect(taxonomyData.snapshotId).toBe(LOBSTER_METADATA_SNAPSHOT_ID)
		expect(sha256(taxonomyBytes)).toBe(LOBSTER_TAXONOMY_SHA256)
		expect(metadataProvenance.taxonomy).toEqual(
			expect.objectContaining({
				snapshotId: LOBSTER_METADATA_SNAPSHOT_ID,
				sha256: LOBSTER_TAXONOMY_SHA256,
				recordCount: 264
			})
		)
	})

	it("uses cited family defaults for all six frozen families", () => {
		const knownProfiles = new Map([
			["Nephropidae", "clawed-lobster body plan"],
			["Enoplometopidae", "reef-lobster body plan"],
			["Palinuridae", "spiny-lobster body plan"],
			["Scyllaridae", "slipper-lobster body plan"],
			["Polychelidae", "deep-sea polychelid lobster body plan"],
			["Glypheidae", "glypheoid-lobster body plan"]
		])

		for (const record of dataset.records) {
			expect(record.displayName).toBe(record.scientificName)
			expect(record.habitat).toEqual(
				expect.objectContaining({
					value: "marine",
					status: "known",
					citationIds: ["worms-record"]
				})
			)
			expect(record.depthBand.status).toBe("unknown")
			expect(record.geographicRegion.status).toBe("unknown")
			expect(record.broadBodyPlan).toEqual(
				expect.objectContaining({
					value: knownProfiles.get(record.family),
					status: "known"
				})
			)
			expect(record.broadBodyPlan.evidenceScope).toContain(
				"Family-level default"
			)
			expect(record.anatomyFacts.status).toBe("known")
			expect(record.anatomyFacts.value?.length).toBeGreaterThan(0)
			expect(record.broadBodyPlan.citationIds.length).toBeGreaterThan(0)
			expect(
				record.scientificCitations.some(
					(citation) => citation.scope === "family-anatomy"
				)
			).toBe(true)
			expect(record.scientificCitations[0]?.url).toBe(
				`https://www.marinespecies.org/aphia.php?p=taxdetails&id=${record.AphiaID}`
			)
			for (const citation of record.scientificCitations) {
				expect(citation.title.length).toBeGreaterThan(0)
				expect(citation.authors.length).toBeGreaterThan(0)
				expect(citation.provider.length).toBeGreaterThan(0)
				expect(citation.publicationYear).toBeGreaterThan(1800)
				expect(citation.supportedClaims.length).toBeGreaterThan(0)
				expect(new URL(citation.url).protocol).toMatch(/^https?:$/)
			}
			validateLobsterMetadataRecord(record, sourceConfig)
		}
		expect(new Set(dataset.records.map((record) => record.family)).size).toBe(6)
		expect(
			new Set(dataset.records.map((record) => record.broadBodyPlan.value)).size
		).toBe(6)
	})

	it("matches the exact family capability and physical-action matrix", () => {
		const familyCounts = Object.fromEntries(
			[
				"Nephropidae",
				"Enoplometopidae",
				"Palinuridae",
				"Scyllaridae",
				"Polychelidae",
				"Glypheidae"
			].map((family) => [
				family,
				dataset.records.filter((record) => record.family === family).length
			])
		)
		expect(familyCounts).toEqual({
			Nephropidae: 60,
			Enoplometopidae: 11,
			Palinuridae: 61,
			Scyllaridae: 92,
			Polychelidae: 38,
			Glypheidae: 2
		})

		const capabilityCount = (
			capability: keyof LobsterMetadataRecord["capabilities"],
			value: true | false | "unknown"
		) =>
			dataset.records.filter(
				(record) => record.capabilities[capability].value === value
			).length
		expect(capabilityCount("largeGraspingClaws", true)).toBe(71)
		expect(capabilityCount("largeGraspingClaws", false)).toBe(155)
		expect(capabilityCount("largeGraspingClaws", "unknown")).toBe(38)
		expect(capabilityCount("antennaStrikingBehavior", true)).toBe(61)
		expect(capabilityCount("antennaStrikingBehavior", false)).toBe(0)
		expect(capabilityCount("antennaStrikingBehavior", "unknown")).toBe(203)
		expect(capabilityCount("tailEscapeBehavior", true)).toBe(121)
		expect(capabilityCount("tailEscapeBehavior", false)).toBe(0)
		expect(capabilityCount("tailEscapeBehavior", "unknown")).toBe(143)
		expect(capabilityCount("forcefulBodyContact", "unknown")).toBe(264)
		expect(capabilityCount("ambushBehavior", "unknown")).toBe(264)

		const permittedCount = (action: LobsterActionId) =>
			dataset.records.filter((record) =>
				record.permittedActions.some(({ id }) => id === action)
			).length
		expect(permittedCount("pinch")).toBe(71)
		expect(permittedCount("antenna-strike")).toBe(61)
		expect(permittedCount("tail-escape")).toBe(121)
		expect(permittedCount("body-check")).toBe(0)
		expect(permittedCount("ambush")).toBe(0)

		for (const record of dataset.records) {
			const permitted = new Set(record.permittedActions.map(({ id }) => id))
			expect(permitted.has("pinch")).toBe(
				record.family === "Nephropidae" ||
					record.family === "Enoplometopidae"
			)
			expect(permitted.has("antenna-strike")).toBe(
				record.family === "Palinuridae"
			)
			expect(permitted.has("tail-escape")).toBe(
				record.family === "Nephropidae" ||
					record.family === "Palinuridae"
			)
			expect(permitted.has("body-check")).toBe(false)
			expect(permitted.has("ambush")).toBe(false)
		}
		expect(sourceConfig.scientificAnatomyApproval.status).toBe(
			"designated-not-reviewed"
		)
		expect(sourceConfig.scientificAnatomyApproval.statement).toContain(
			"does not claim"
		)
	})

	it("binds Palinuridae physical behavior to family evidence and direct observations", () => {
		const palinurids = dataset.records.filter(
			(record) => record.family === "Palinuridae"
		)
		expect(palinurids).toHaveLength(61)

		for (const record of palinurids) {
			expect(record.capabilities.antennaStrikingBehavior).toEqual(
				expect.objectContaining({
					value: true,
					citationIds: [
						"patek-oakley-2003-palinurid-defense",
						"buscaino-2011-spiny-defense"
					]
				})
			)
			expect(record.capabilities.tailEscapeBehavior).toEqual(
				expect.objectContaining({
					value: true,
					citationIds: [
						"briones-fourzan-2006-spiny-escape",
						"buscaino-2011-spiny-defense"
					]
				})
			)
			expect(
				record.scientificCitations.find(
					(citation) =>
						citation.id === "patek-oakley-2003-palinurid-defense"
				)?.scope
			).toBe("family-behavior")
			expect(
				record.scientificCitations.find(
					(citation) => citation.id === "buscaino-2011-spiny-defense"
				)?.scope
			).toBe("species-behavior")
		}
	})

	it("uses the corrected Polychelidae DOI in all 38 canonical records", () => {
		const polychelids = dataset.records.filter(
			(record) => record.family === "Polychelidae"
		)
		expect(polychelids).toHaveLength(38)
		for (const record of polychelids) {
			const citation = record.scientificCitations.find(
				(entry) => entry.id === "ahyong-2009-polychelidae"
			)
			expect(citation?.url).toBe(
				"https://doi.org/10.1201/9781420092592-c19"
			)
			expect(citation?.url).not.toContain("-c14")
		}
	})

	it("rejects taxonomy and family semantics that differ from canonical input", () => {
		const wrongName = cloneDataset()
		const nameRecord = wrongName.records[0]!
		const originalName = nameRecord.scientificName
		const fabricatedName = "Fabricatus canonicalis"
		nameRecord.scientificName = fabricatedName
		nameRecord.displayName = fabricatedName
		nameRecord.narrativeVocabulary.subjectTerms[0] = fabricatedName
		nameRecord.accessibility.subjectFragment =
			`${fabricatedName}, displayed under its scientific name`
		for (const scene of nameRecord.scenePlans) {
			scene.headline = scene.headline.replace(originalName, fabricatedName)
			scene.altText = scene.altText.replace(originalName, fabricatedName)
		}
		expect(() =>
			validateLobsterMetadataDataset(wrongName, taxonomyRecords, sourceConfig)
		).toThrow("canonical taxonomy/config semantics")

		const wrongFamily = cloneDataset()
		const familyRecord = wrongFamily.records[0]!
		familyRecord.family = "Palinuridae"
		familyRecord.narrativeVocabulary.subjectTerms[1] =
			"Palinuridae family taxon"
		familyRecord.accessibility.taxonomyFragment =
			"an accepted marine species in family Palinuridae"
		expect(() =>
			validateLobsterMetadataDataset(
				wrongFamily,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("unsupported exact claim binding")
	})

	it("rejects fabricated or unapproved family evidence profiles", () => {
		const unsupportedFamily = cloneDataset()
		const unsupported = unsupportedFamily.records.find(
			(record) => record.family === "Enoplometopidae"
		)!
		const borrowedCitation = structuredClone(
			dataset.records.find((record) => record.family === "Nephropidae")!
				.scientificCitations.find(
					(citation) => citation.id === "fao-holthuis-1991"
				)!
		)
		unsupported.scientificCitations.push(borrowedCitation)
		unsupported.broadBodyPlan = {
			value: "invented reef-lobster body plan",
			status: "known",
			evidenceScope: "Fabricated family-level default.",
			citationIds: ["fao-holthuis-1991"]
		}
		unsupported.anatomyFacts = {
			value: ["Invented family anatomy."],
			status: "known",
			evidenceScope: "Fabricated family-level default.",
			citationIds: ["fao-holthuis-1991"]
		}
		expect(() =>
			validateLobsterMetadataDataset(
				unsupportedFamily,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("canonical taxonomy/config semantics")

		const unapprovedProfile = cloneDataset()
		const nephropid = unapprovedProfile.records.find(
			(record) => record.family === "Nephropidae"
		)!
		nephropid.broadBodyPlan.value = "unapproved alternate body plan"
		expect(() =>
			validateLobsterMetadataDataset(
				unapprovedProfile,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("canonical taxonomy/config semantics")
	})

	it("rejects altered canonical citation objects and supported claims", () => {
		const alteredCitation = cloneDataset()
		const citation = alteredCitation.records
			.find((record) => record.family === "Polychelidae")!
			.scientificCitations.find(
				(entry) => entry.id === "ahyong-2009-polychelidae"
			)!
		citation.title = "Altered title"
		citation.supportedClaims[0] = "Fabricated supported claim"
		expect(() =>
			validateLobsterMetadataDataset(
				alteredCitation,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("canonical taxonomy/config semantics")
	})

	it("rejects unknown extra keys throughout parsed dataset objects", () => {
		const extraTopLevel = cloneDataset() as LobsterMetadataDataset & {
			fabricated?: boolean
		}
		extraTopLevel.fabricated = true
		expect(() =>
			parseLobsterMetadataDataset(
				extraTopLevel,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("unknown key fabricated")

		const extraRecord = cloneDataset()
		;(extraRecord.records[0] as LobsterMetadataRecord & {
			fabricated?: boolean
		}).fabricated = true
		expect(() =>
			parseLobsterMetadataDataset(extraRecord, taxonomyRecords, sourceConfig)
		).toThrow("unknown key fabricated")

		const extraScene = cloneDataset()
		;(extraScene.records[0]!.scenePlans[0] as typeof extraScene.records[0]["scenePlans"][0] & {
			fabricated?: boolean
		}).fabricated = true
		expect(() =>
			parseLobsterMetadataDataset(extraScene, taxonomyRecords, sourceConfig)
		).toThrow("unknown key fabricated")

		const extraCastAdult = cloneDataset()
		;(extraCastAdult.records[0]!.scenePlans[0]!.cast.adults[0] as {
			fabricated?: boolean
		}).fabricated = true
		expect(() =>
			parseLobsterMetadataDataset(
				extraCastAdult,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("unknown key fabricated")
	})

	it("rejects malformed evidence, capabilities, actions, citations, and accessibility", () => {
		const invalidStatus = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		;(invalidStatus.broadBodyPlan as { status: string }).status = "verified"
		expect(() =>
			validateLobsterMetadataRecord(invalidStatus, sourceConfig)
		).toThrow("invalid value")

		const invalidCapability = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		;(invalidCapability.capabilities.largeGraspingClaws as {
			value: string
		}).value = "likely"
		expect(() =>
			validateLobsterMetadataRecord(invalidCapability, sourceConfig)
		).toThrow("invalid capability value")

		const mismatchedCapabilityClaim = structuredClone(
			dataset.records.find((record) => record.family === "Nephropidae")!
		) as LobsterMetadataRecord
		mismatchedCapabilityClaim.capabilities.largeGraspingClaws.citationIds = [
			"barshaw-2003-tail-escape"
		]
		mismatchedCapabilityClaim.capabilities.largeGraspingClaws.supportedClaims = [
			"Clawed-lobster morphological type uses rapid tail-flip escape responses under predator threat"
		]
		expect(() =>
			validateLobsterMetadataRecord(mismatchedCapabilityClaim, sourceConfig)
		).toThrow("unsupported exact claim binding")

		const duplicateAction = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		duplicateAction.permittedActions.push({
			...duplicateAction.permittedActions[0]!
		})
		expect(() =>
			validateLobsterMetadataRecord(duplicateAction, sourceConfig)
		).toThrow("duplicate IDs")

		const unknownAction = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		;(unknownAction.permittedActions[0] as { id: string }).id = "wave"
		expect(() =>
			validateLobsterMetadataRecord(unknownAction, sourceConfig)
		).toThrow("unknown action wave")

		const missingAction = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		missingAction.permittedActions = missingAction.permittedActions.filter(
			({ id }) => id !== "pinch"
		)
		expect(() =>
			validateLobsterMetadataRecord(missingAction, sourceConfig)
		).toThrow("pinch must be covered exactly once")

		const invalidCitation = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		invalidCitation.scientificCitations[0]!.url = "not-a-url"
		expect(() =>
			validateLobsterMetadataRecord(invalidCitation, sourceConfig)
		).toThrow("valid URL")

		const invalidAccessibility = structuredClone(
			dataset.records[0]!
		) as LobsterMetadataRecord
		invalidAccessibility.accessibility.taxonomyFragment = "marine species"
		expect(() =>
			validateLobsterMetadataRecord(invalidAccessibility, sourceConfig)
		).toThrow("must name the family")
	})
})

describe("lobster scene dimensions, uniqueness, and semantic quotas", () => {
	it("includes every PRD dimension and four-way per-species variation", () => {
		for (const record of dataset.records) {
			expect(record.scenePlans).toHaveLength(4)
			for (const field of [
				"medium",
				"environmentFamily",
				"composition",
				"tone"
			] as const) {
				expect(
					new Set(record.scenePlans.map((scene) => scene[field])).size
				).toBe(4)
			}
			for (const scene of record.scenePlans) {
				expect(scene.action.length).toBeGreaterThan(0)
				expect(scene.environment.length).toBeGreaterThan(0)
				expect(scene.era.length).toBeGreaterThan(0)
				expect(scene.medium.length).toBeGreaterThan(0)
				expect(scene.tone.length).toBeGreaterThan(0)
				expect(scene.cast.id.length).toBeGreaterThan(0)
				expect(scene.cast.adults).toBeArray()
				expect(scene.camera.position.length).toBeGreaterThan(0)
				expect(scene.camera.lensLanguage.length).toBeGreaterThan(0)
				expect(scene.composition.length).toBeGreaterThan(0)
				expect(scene.lighting.length).toBeGreaterThan(0)
				expect(scene.palette.length).toBeGreaterThan(0)
				expect(scene.sceneFamilyId.length).toBeGreaterThan(0)
				expect(scene.promptVersion).toBe("lob-v1")
				expect(scene.humanReviewStatus).toBe("not-reviewed")
				expect(scene.automatedReviewStatus).toBe("validated")
				expect(scene.output).toEqual({
					format: "webp",
					width: 768,
					height: 512,
					aspectRatio: "3:2",
					largerMasterRetained: false
				})
			}
		}
	})

	it("assigns four distinct evidence-driven actions with return-safe coverage", () => {
		const actionCounts = new Map<LobsterActionId, number>()
		for (const record of dataset.records) {
			const actions = record.scenePlans.map((scene) => scene.action)
			expect(new Set(actions).size).toBe(4)
			expect(
				actions.some(
					(action) => ACTION_REGISTRY[action].kind === "morphology"
				)
			).toBe(true)
			expect(
				actions.filter((action) => ACTION_REGISTRY[action].returnSafe).length
			).toBeGreaterThanOrEqual(2)
			if (
				record.family === "Nephropidae" ||
				record.family === "Enoplometopidae" ||
				record.family === "Palinuridae"
			) {
				expect(
					actions.some(
						(action) => ACTION_REGISTRY[action].kind === "physical"
					)
				).toBe(true)
			}
			for (const action of actions) {
				actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1)
			}
			expect(record.narrativeVocabulary.evidencePolicy).toEqual({
				citedFamilyAnatomyAllowed: true,
				actionsLimitedToPermittedSet: true,
				unsupportedBehaviorProhibited: true
			})
			for (const { id } of record.permittedActions) {
				expect(record.narrativeVocabulary.safeVerbs).toContain(
					id.replaceAll("-", " ")
				)
			}
		}
		expect(Object.fromEntries(actionCounts)).toEqual({
			pinch: 71,
			"tail-escape": 121,
			"large-chela-stand-off": 71,
			refusal: 264,
			"ceremonial-display": 143,
			"antenna-strike": 61,
			"antenna-stand-off": 61,
			"antenna-plate-refusal": 92,
			"editorial-observe": 132,
			"multi-chela-stand-off": 38,
			"subchelate-stand-off": 2
		})
	})

	it("uses accurate physical and non-contact morphology copy", () => {
		for (const record of dataset.records) {
			for (const scene of record.scenePlans) {
				const text = `${scene.headline} ${scene.altText}`.toLowerCase()
				switch (scene.action) {
					case "pinch":
						expect(text).toContain("pinch")
						expect(text).toContain("first-leg chelae")
						break
					case "antenna-strike":
						expect(text).toContain("antenna strike")
						expect(text).toContain("defensive strike")
						break
					case "tail-escape":
						expect(text).toContain("tail-flip")
						expect(text).toContain("escape")
						break
					case "large-chela-stand-off":
					case "antenna-stand-off":
					case "antenna-plate-refusal":
					case "multi-chela-stand-off":
					case "subchelate-stand-off":
						expect(text).toContain("non-contact")
						expect(text).not.toContain("hunt")
						expect(text).not.toContain("attack")
						break
				}
			}
		}
	})

	it("has 1,056 unique substantive tuples without identifier fields", () => {
		const tuples = new Set(
			dataset.records.flatMap((record) =>
				record.scenePlans.map(substantiveTuple)
			)
		)
		expect(tuples.size).toBe(1056)

		const first = structuredClone(dataset.records[0]!.scenePlans[0]!)
		const originalTuple = substantiveTuple(first)
		first.id = "different-id"
		first.sceneFamilyId = "different-family-id"
		first.headline = "different headline"
		first.altText = "different alt text"
		expect(substantiveTuple(first)).toBe(originalTuple)
	})

	it("rejects duplicate scene IDs and duplicate substantive tuples", () => {
		const duplicateId = cloneDataset()
		duplicateId.records[1]!.scenePlans[0]!.id =
			duplicateId.records[0]!.scenePlans[0]!.id
		expect(() =>
			validateLobsterMetadataDataset(
				duplicateId,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("duplicate scene ID")

		const duplicateTuple = cloneDataset()
		const source = duplicateTuple.records[0]!.scenePlans[0]!
		const targetRecord = duplicateTuple.records.find((record, recordIndex) => {
			if (recordIndex === 0) return false
			const otherScenes = record.scenePlans.slice(1)
			return (
				!otherScenes.some((scene) => scene.medium === source.medium) &&
				!otherScenes.some(
					(scene) => scene.environmentFamily === source.environmentFamily
				) &&
				!otherScenes.some(
					(scene) => scene.composition === source.composition
				) &&
				!otherScenes.some((scene) => scene.tone === source.tone)
			)
		})!
		const target = targetRecord.scenePlans[0]!
		const preservedIdentity = {
			id: target.id,
			headline: `${targetRecord.scientificName} duplicate test`,
			altText:
				`${targetRecord.scientificName} in a ${source.medium} scene set ` +
				`in ${source.environment}; duplicate tuple test.`
		}
		Object.assign(target, structuredClone(source), preservedIdentity)
		target.sceneFamilyId = `${target.environmentFamily}:${target.action}:${target.mediumKind}`
		expect(() =>
			validateLobsterMetadataDataset(
				duplicateTuple,
				taxonomyRecords,
				sourceConfig
			)
		).toThrow("duplicate substantive scene tuple")
	})

	it("derives quotas from canonical config rather than generated labels", () => {
		const quota = computeSceneQuotaReport(dataset, sourceConfig)

		expect(quota.totalScenes).toBe(1056)
		expect(quota.mediumMax.share).toBeLessThanOrEqual(0.15)
		expect(quota.environmentFamilyMax.share).toBeLessThan(0.1)
		expect(quota.officeBoardroomOrHearing.share).toBeLessThan(0.03)
		expect(quota.castPatternMax.share).toBeLessThanOrEqual(0.05)
		expect(quota.prominentAdultWomanHumanScenes.share).toBeGreaterThanOrEqual(
			0.5
		)
		expect(quota.nonPhotorealistic.share).toBeGreaterThanOrEqual(0.2)
		expect(quota.noConventionalModernWorkplace.share).toBeGreaterThanOrEqual(
			0.15
		)
		expect(metadataProvenance.quotaReport).toEqual(quota)

		const badMedium = cloneDataset()
		badMedium.records[0]!.scenePlans[0]!.mediumKind =
			badMedium.records[0]!.scenePlans[0]!.mediumKind === "photorealistic"
				? "non-photorealistic"
				: "photorealistic"
		expect(() => computeSceneQuotaReport(badMedium, sourceConfig)).toThrow(
			"mismatched medium kind"
		)

		const badEnvironment = cloneDataset()
		badEnvironment.records[0]!.scenePlans[0]!.environmentFamily = "invented"
		expect(() => computeSceneQuotaReport(badEnvironment, sourceConfig)).toThrow(
			"mismatched environment family"
		)

		const badCast = cloneDataset()
		badCast.records[0]!.scenePlans[0]!.cast.adults[0]!.role = "invented role"
		expect(() => computeSceneQuotaReport(badCast, sourceConfig)).toThrow(
			"mismatched structured cast"
		)
	})

	it("encodes human diversity structurally and supports non-human casts", () => {
		const kinds = new Set(sourceConfig.scenes.castPatterns.map(({ kind }) => kind))
		expect(kinds).toEqual(new Set(["human", "no-human", "robot", "fantasy"]))
		for (const cast of sourceConfig.scenes.castPatterns) {
			if (cast.kind === "human") {
				expect(cast.adults.length).toBeGreaterThan(0)
				for (const adult of cast.adults) {
					expect(adult.adultStatus).toBe("adult")
					expect(adult.genderPresentation.length).toBeGreaterThan(0)
					expect(adult.skinToneGroup.length).toBeGreaterThan(0)
					expect(adult.ageBand.length).toBeGreaterThan(0)
					expect(adult.bodyType.length).toBeGreaterThan(0)
					expect(adult.wardrobe.length).toBeGreaterThan(0)
					expect(adult.role.length).toBeGreaterThan(0)
				}
			} else {
				expect(cast.adults).toEqual([])
			}
		}
	})

	it("rejects malformed source registries and semantic enums", () => {
		const duplicateMedium = cloneConfig()
		duplicateMedium.scenes.mediums.push({
			...duplicateMedium.scenes.mediums[0]!
		})
		expect(() => parseLobsterMetadataSourceConfig(duplicateMedium)).toThrow(
			"duplicate IDs"
		)

		const unknownAction = cloneConfig()
		;(unknownAction.actions.fallback[0] as string) = "wave"
		expect(() => parseLobsterMetadataSourceConfig(unknownAction)).toThrow(
			"unknown action wave"
		)

		const missingAction = cloneConfig()
		missingAction.actions.physical.pop()
		expect(() => parseLobsterMetadataSourceConfig(missingAction)).toThrow(
			"cover the action registry exactly"
		)

		const invalidCast = cloneConfig()
		;(invalidCast.scenes.castPatterns[0]!.adults[0] as {
			adultStatus: string
		}).adultStatus = "minor"
		expect(() => parseLobsterMetadataSourceConfig(invalidCast)).toThrow(
			"adultStatus"
		)

		const badCitationReference = cloneConfig()
		badCitationReference.familyEvidenceProfiles[0]!.citationIds = ["missing"]
		expect(() =>
			parseLobsterMetadataSourceConfig(badCitationReference)
		).toThrow("unknown citation")

		const falseApproval = cloneConfig()
		falseApproval.scientificAnatomyApproval.statement =
			"Peter Steinberger approved this dataset."
		expect(() => parseLobsterMetadataSourceConfig(falseApproval)).toThrow(
			"scientificAnatomyApproval.statement"
		)

		const extraConfigKey = cloneConfig() as LobsterMetadataSourceConfig & {
			fabricated?: boolean
		}
		extraConfigKey.fabricated = true
		expect(() => parseLobsterMetadataSourceConfig(extraConfigKey)).toThrow(
			"unknown key fabricated"
		)

		const extraRegistryKey = cloneConfig()
		;(extraRegistryKey.scenes.mediums[0] as {
			fabricated?: boolean
		}).fabricated = true
		expect(() => parseLobsterMetadataSourceConfig(extraRegistryKey)).toThrow(
			"unknown key fabricated"
		)

		const invalidClaimBinding = cloneConfig()
		invalidClaimBinding.familyEvidenceProfiles[0]!.capabilityEvidence[0]!
			.supportedClaims = ["Unsupported capability claim"]
		expect(() =>
			parseLobsterMetadataSourceConfig(invalidClaimBinding)
		).toThrow("supports none of the bound claims")

		const wrongCapabilityBinding = cloneConfig()
		wrongCapabilityBinding.capabilityClaimBindings[0]!.capability =
			"tailEscapeBehavior"
		expect(() =>
			parseLobsterMetadataSourceConfig(wrongCapabilityBinding)
		).toThrow("exact capability claim binding")

		const duplicateCapability = cloneConfig()
		duplicateCapability.familyEvidenceProfiles[0]!.capabilityEvidence.push(
			structuredClone(
				duplicateCapability.familyEvidenceProfiles[0]!
					.capabilityEvidence[0]!
			)
		)
		expect(() =>
			parseLobsterMetadataSourceConfig(duplicateCapability)
		).toThrow("duplicate IDs")

		const missingCapability = cloneConfig()
		missingCapability.familyEvidenceProfiles[0]!.capabilityEvidence.pop()
		expect(() =>
			parseLobsterMetadataSourceConfig(missingCapability)
		).toThrow("capability coverage is incomplete")

		const speciesOnlyBehavior = cloneConfig()
		const palinuridProfile =
			speciesOnlyBehavior.familyEvidenceProfiles.find(
				(profile) => profile.family === "Palinuridae"
			)!
		const antennaStrike = palinuridProfile.capabilityEvidence.find(
			(capability) =>
				capability.capability === "antennaStrikingBehavior"
		)!
		antennaStrike.citationIds = ["buscaino-2011-spiny-defense"]
		antennaStrike.supportedClaims = [
			"Palinurus elephas uses antennae to strike during predator attack"
		]
		expect(() =>
			parseLobsterMetadataSourceConfig(speciesOnlyBehavior)
		).toThrow("enabled behavioral capability requires family-behavior evidence")
	})

	it("rejects structurally valid drift from the approved source policy", () => {
		const addedProfile = cloneConfig()
		addedProfile.familyEvidenceProfiles.push({
			...structuredClone(addedProfile.familyEvidenceProfiles[0]!),
			family: "Inventedidae"
		})
		expect(() => parseLobsterMetadataSourceConfig(addedProfile)).toThrow(
			"exact capability claim binding"
		)

		const changedBodyPlan = cloneConfig()
		changedBodyPlan.familyEvidenceProfiles[0]!.broadBodyPlan =
			"altered clawed-lobster body plan"
		expect(() => parseLobsterMetadataSourceConfig(changedBodyPlan)).toThrow(
			"canonical policy checksum"
		)

		const changedClaims = cloneConfig()
		changedClaims.citationRegistry[0]!.supportedClaims[0] =
			"Altered supported claim"
		expect(() => parseLobsterMetadataSourceConfig(changedClaims)).toThrow(
			"canonical policy checksum"
		)

		expect(sha256(serializeJson(sourceConfig))).toBe(
			LOBSTER_METADATA_SOURCE_POLICY_SHA256
		)
	})
})

describe("lobster metadata reproducibility and runtime immutability", () => {
	it("rebuilds byte-identical artifacts with fetch disabled", async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (() => {
			throw new Error("metadata build attempted network access")
		}) as typeof fetch

		try {
			const generated = await generateLobsterMetadataArtifacts()
			expect(generated.datasetContents).toBe(
				await readFile("data/lobster/metadata/lobster-metadata.json", "utf8")
			)
			expect(generated.provenanceContents).toBe(
				await readFile("data/lobster/metadata/provenance.json", "utf8")
			)
			const sourceBytes = await readFile(
				"data/lobster/metadata/source/metadata-config.json"
			)
			expect(generated.provenance.sourceConfig.sha256).toBe(
				sha256(sourceBytes)
			)
			expect(generated.provenance.sourceConfig.policySha256).toBe(
				LOBSTER_METADATA_SOURCE_POLICY_SHA256
			)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("validates, deeply freezes, and exposes read-only runtime data", async () => {
		const runtime = await import("../src/config/lobsterMetadata.js")
		const record = runtime.requireLobsterMetadataByAphiaId(107253)
		const scene = record.scenePlans[0]

		expect(runtime.lobsterMetadataRecords).toHaveLength(264)
		expect(runtime.lobsterMetadataByAphiaId.size).toBe(264)
		expect(record.scientificName).toBe("Homarus gammarus")
		expect(Object.isFrozen(runtime.lobsterMetadata)).toBe(true)
		expect(Object.isFrozen(runtime.lobsterMetadataRecords)).toBe(true)
		expect(Object.isFrozen(record)).toBe(true)
		expect(Object.isFrozen(record.scientificCitations)).toBe(true)
		expect(Object.isFrozen(scene)).toBe(true)
		expect(Object.isFrozen(scene.cast)).toBe(true)
		expect(Object.isFrozen(scene.cast.adults)).toBe(true)
		expect(Object.isFrozen(scene.output)).toBe(true)
		expect(Object.isFrozen(runtime.lobsterMetadataProvenance)).toBe(true)
		expect(
			Reflect.set(record, "displayName", "mutated")
		).toBe(false)
		expect(() =>
			(record.scenePlans as LobsterMetadataRecord["scenePlans"]).push(scene)
		).toThrow()
		expect(Reflect.set(scene.output, "width", 999)).toBe(false)
		expect("set" in (runtime.lobsterMetadataByAphiaId as object)).toBe(false)
		expect(() => runtime.requireLobsterMetadataByAphiaId(-1)).toThrow(
			"No bundled lobster metadata"
		)
	})

	it("rejects false approval and unknown fields in provenance", async () => {
		const runtime = await import("../src/config/lobsterMetadata.js")
		const falseApproval = structuredClone(metadataProvenance)
		falseApproval.scientificAnatomyApproval.statement =
			"Peter Steinberger approved this dataset."
		expect(() =>
			runtime.parseLobsterMetadataProvenance(
				falseApproval,
				dataset,
				sourceConfig
			)
		).toThrow("scientific approval status")

		const extraProvenance = structuredClone(metadataProvenance) as typeof metadataProvenance & {
			fabricated?: boolean
		}
		extraProvenance.fabricated = true
		expect(() =>
			runtime.parseLobsterMetadataProvenance(
				extraProvenance,
				dataset,
				sourceConfig
			)
		).toThrow("unknown key fabricated")

		const extraNested = structuredClone(metadataProvenance)
		;(extraNested.generated.output as typeof extraNested.generated.output & {
			fabricated?: boolean
		}).fabricated = true
		expect(() =>
			runtime.parseLobsterMetadataProvenance(
				extraNested,
				dataset,
				sourceConfig
			)
		).toThrow("unknown key fabricated")

		const forgedChecksum = structuredClone(metadataProvenance)
		forgedChecksum.sourceConfig.policySha256 = "0".repeat(64)
		expect(() =>
			runtime.parseLobsterMetadataProvenance(
				forgedChecksum,
				dataset,
				sourceConfig
			)
		).toThrow("source config policy checksum")
	})
})
