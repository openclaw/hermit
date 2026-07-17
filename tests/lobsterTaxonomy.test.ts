import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "bun:test"
import { generateLobsterTaxonomyArtifacts } from "../scripts/build-lobster-taxonomy.js"
import {
	buildLobsterTaxonomyDataset,
	FAMILY_SCOPE,
	normalizeLobsterRecord,
	parseTarMembers,
	SOURCE_CHECKSUMS,
	validateArchiveProvenance,
	validateTraversalManifest
} from "../scripts/lib/lobster-taxonomy.js"
import primaryManifest from "../data/lobster/taxonomy/source/manifest.json" with {
	type: "json"
}
import sourceRecords from "../data/lobster/taxonomy/source/selected-all-families.json" with {
	type: "json"
}

const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex")

const sourceRecord = () =>
	structuredClone(sourceRecords[0]) as Record<string, unknown>

describe("lobster taxonomy artifacts", () => {
	it("contains the exact approved family scope and accepted species counts", () => {
		const dataset = buildLobsterTaxonomyDataset(sourceRecords)

		expect(dataset.records).toHaveLength(264)
		expect(dataset.records.map((record) => record.AphiaID)).toEqual(
			dataset.records
				.map((record) => record.AphiaID)
				.toSorted((left, right) => left - right)
		)
		for (const scope of FAMILY_SCOPE) {
			expect(
				dataset.records.filter(
					(record) => record.family === scope.family
				)
			).toHaveLength(scope.speciesCount)
		}
	})

	it("preserves required evidence and per-record WoRMS attribution", () => {
		const dataset = buildLobsterTaxonomyDataset(sourceRecords)

		for (const record of dataset.records) {
			expect(record.rank).toBe("Species")
			expect(record.status).toBe("accepted")
			expect(record.marineEvidence.isMarine).toBe(1)
			expect(record.extantEvidence.isExtinct).toBe(0)
			expect(record.source.url).toBe(
				`https://www.marinespecies.org/aphia.php?p=taxdetails&id=${record.AphiaID}`
			)
			expect(record.source.citation).toContain(
				"World Register of Marine Species"
			)
		}
	})

	it("rebuilds exact committed bytes and checksums without network access", async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (() => {
			throw new Error("taxonomy build attempted network access")
		}) as typeof fetch

		try {
			const generated = await generateLobsterTaxonomyArtifacts()
			const committedDataset = await readFile(
				"data/lobster/taxonomy/lobster-species.json",
				"utf8"
			)
			const committedProvenance = await readFile(
				"data/lobster/taxonomy/provenance.json",
				"utf8"
			)

			expect(generated.datasetContents).toBe(committedDataset)
			expect(generated.provenanceContents).toBe(committedProvenance)
			expect(sha256(new TextEncoder().encode(committedDataset))).toBe(
				generated.normalizedSha256
			)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("statically loads the bundled runtime dataset without fetching", async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (() => {
			throw new Error("runtime taxonomy attempted network access")
		}) as typeof fetch

		try {
			const runtime = await import("../src/config/lobsterTaxonomy.js")
			expect(runtime.lobsterSpecies).toHaveLength(264)
			expect(runtime.getLobsterSpeciesByAphiaId(107253)?.scientificName).toBe(
				"Homarus gammarus"
			)
			expect(runtime.lobsterTaxonomyProvenance.normalized.recordCount).toBe(
				264
			)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("matches the committed official source checksums", async () => {
		const files = [
			[
				"data/lobster/taxonomy/source/worms-official-raw-responses.tar",
				SOURCE_CHECKSUMS.rawArchive
			],
			[
				"data/lobster/taxonomy/source/manifest.json",
				SOURCE_CHECKSUMS.manifest
			],
			[
				"data/lobster/taxonomy/source/selected-all-families.json",
				SOURCE_CHECKSUMS.selectedRecords
			]
		] as const

		for (const [path, expected] of files) {
			expect(sha256(await readFile(path))).toBe(expected)
		}
	})

	it("uses portable archive-relative paths for every primary response", () => {
		expect(primaryManifest.requests).toHaveLength(1294)
		for (const request of primaryManifest.requests) {
			expect(request.path).toMatch(
				/^raw\/[A-Za-z]+\/\d{5}-parent-\d+-offset-\d+-status-(200|204)\.json$/
			)
			expect(request.path).not.toStartWith("/")
			expect(request.path).not.toContain("\\")
			expect(request.path.split("/")).not.toContain("..")
		}
	})

	it("validates both archive traversal chains and reconstructs the selected set", async () => {
		const archiveBytes = await readFile(
			"data/lobster/taxonomy/source/worms-official-raw-responses.tar"
		)
		const validation = validateArchiveProvenance(
			archiveBytes,
			primaryManifest,
			sourceRecords
		)

		expect(validation.archiveMemberCount).toBe(2022)
		expect(validation.portableManifestMatchesEmbeddedPrimary).toBe(true)
		expect(validation.primary).toEqual({
			archiveRoot: "raw",
			requestCount: 1294,
			responseRecordOccurrences: 1335,
			selectedRecordCount: 264,
			selectedRecordsMatch: true
		})
		expect(validation.filtered).toEqual(
			expect.objectContaining({
				archiveRoot: "raw-filtered",
				requestCount: 714,
				responseRecordOccurrences: 748,
				selectedRecordCount: 264,
				selectedRecordsMatch: true,
				manifestArchiveMember: "manifest-filtered.json"
			})
		)
	})

	it("rejects broken manifest paths, response hashes, and selected-set drift", async () => {
		const archiveBytes = await readFile(
			"data/lobster/taxonomy/source/worms-official-raw-responses.tar"
		)
		const members = parseTarMembers(archiveBytes)
		const validate = (manifest: unknown, selected: unknown = sourceRecords) =>
			validateTraversalManifest(manifest, members, selected, {
				context: "primary traversal",
				archiveRoot: "raw",
				pathMode: "portable",
				marineOnly: false,
				extantOnly: false
			})

		const absolutePathManifest = structuredClone(primaryManifest)
		absolutePathManifest.requests[0]!.path =
			`/tmp/worms-lob-tax-1.x1NYXB/` +
			absolutePathManifest.requests[0]!.path
		expect(() => validate(absolutePathManifest)).toThrow(
			"path must be archive-relative"
		)

		const badHashManifest = structuredClone(primaryManifest)
		badHashManifest.requests[0]!.sha256 = "0".repeat(64)
		expect(() => validate(badHashManifest)).toThrow("SHA-256 mismatch")

		const driftedSelection = structuredClone(sourceRecords)
		driftedSelection[0]!.scientificname = "Not the archived record"
		expect(() => validate(primaryManifest, driftedSelection)).toThrow(
			"reconstructed selected records do not match committed source"
		)
	})
})

describe("lobster taxonomy exclusions", () => {
	it("rejects synonyms and unaccepted records", () => {
		const record = sourceRecord()
		record.status = "unaccepted"
		record.valid_AphiaID = 999999

		expect(() => normalizeLobsterRecord(record)).toThrow(
			"record must be an accepted taxon, not a synonym"
		)
	})

	it("rejects non-Species and subspecies records", () => {
		const record = sourceRecord()
		record.rank = "Subspecies"

		expect(() => normalizeLobsterRecord(record)).toThrow(
			"rank must be Species"
		)
	})

	it("rejects extinct records", () => {
		const record = sourceRecord()
		record.isExtinct = 1

		expect(() => normalizeLobsterRecord(record)).toThrow(
			"extinct taxa are excluded"
		)
	})

	it.each([
		["freshwater-only", { isMarine: 0, isFreshwater: 1, isBrackish: 0 }],
		["brackish-only", { isMarine: 0, isFreshwater: 0, isBrackish: 1 }],
		["nonmarine", { isMarine: 0, isFreshwater: 0, isBrackish: 0 }]
	])("rejects %s records", (label, evidence) => {
		const record = sourceRecord()
		Object.assign(record, evidence)

		expect(() => normalizeLobsterRecord(record)).toThrow(
			`${label} taxa are excluded`
		)
	})

	it("rejects records outside the approved families", () => {
		const record = sourceRecord()
		record.family = "Astacidae"

		expect(() => normalizeLobsterRecord(record)).toThrow(
			"outside the approved scope"
		)
	})
})
