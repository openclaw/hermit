import { readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import {
	buildLobsterTaxonomyDataset,
	FAMILY_SCOPE,
	LOBSTER_TAXONOMY_SNAPSHOT,
	serializeJson,
	sha256,
	SOURCE_CHECKSUMS,
	validateArchiveProvenance,
	WORMS_CITATION
} from "./lib/lobster-taxonomy.js"

const root = "data/lobster/taxonomy"
const sourceRoot = join(root, "source")
const datasetPath = join(root, "lobster-species.json")
const provenancePath = join(root, "provenance.json")

const sourceFiles = {
	rawArchive: join(sourceRoot, "worms-official-raw-responses.tar"),
	manifest: join(sourceRoot, "manifest.json"),
	selectedRecords: join(sourceRoot, "selected-all-families.json"),
	selectionSummary: join(sourceRoot, "selection-summary.json"),
	openApi: join(sourceRoot, "openapi.yaml")
} as const

const readBytes = (path: string) => readFile(path)

const verifyChecksum = async (
	label: string,
	path: string,
	expected: string
) => {
	const actual = sha256(await readBytes(path))
	if (actual !== expected) {
		throw new Error(
			`${label} checksum mismatch for ${path}: expected ${expected}, received ${actual}`
		)
	}
	return actual
}

const verifyFamilyEvidence = async () => {
	const evidence = []
	for (const scope of FAMILY_SCOPE) {
		const namePath = join(
			sourceRoot,
			"families",
			`family-name-${scope.family}.json`
		)
		const recordPath = join(
			sourceRoot,
			"families",
			`family-record-${scope.family}-${scope.AphiaID}.json`
		)
		const nameBytes = await readBytes(namePath)
		const recordBytes = await readBytes(recordPath)
		const nameResponse = JSON.parse(nameBytes.toString()) as unknown
		const recordResponse = JSON.parse(recordBytes.toString()) as unknown

		if (!Array.isArray(nameResponse)) {
			throw new Error(`${namePath}: expected AphiaRecordsByName array response`)
		}
		const resolved = nameResponse.find(
			(value) =>
				value &&
				typeof value === "object" &&
				(value as Record<string, unknown>).AphiaID === scope.AphiaID &&
				(value as Record<string, unknown>).scientificname === scope.family
		) as Record<string, unknown> | undefined
		if (
			!resolved ||
			resolved.rank !== "Family" ||
			resolved.status !== "accepted"
		) {
			throw new Error(`${namePath}: did not resolve the approved family`)
		}

		if (
			!recordResponse ||
			typeof recordResponse !== "object" ||
			Array.isArray(recordResponse)
		) {
			throw new Error(`${recordPath}: expected AphiaRecordByAphiaID object`)
		}
		const confirmed = recordResponse as Record<string, unknown>
		if (
			confirmed.AphiaID !== scope.AphiaID ||
			confirmed.scientificname !== scope.family ||
			confirmed.rank !== "Family" ||
			confirmed.status !== "accepted"
		) {
			throw new Error(`${recordPath}: family identity confirmation failed`)
		}

		evidence.push({
			family: scope.family,
			AphiaID: scope.AphiaID,
			nameResolution: {
				path: namePath,
				sha256: sha256(nameBytes),
				url:
					`https://www.marinespecies.org/rest/AphiaRecordsByName/` +
					`${scope.family}?like=false&marine_only=false&offset=1`
			},
			identityConfirmation: {
				path: recordPath,
				sha256: sha256(recordBytes),
				url:
					`https://www.marinespecies.org/rest/AphiaRecordByAphiaID/` +
					scope.AphiaID
			}
		})
	}
	return evidence
}

export const generateLobsterTaxonomyArtifacts = async () => {
	for (const [label, path] of Object.entries(sourceFiles)) {
		await verifyChecksum(
			label,
			path,
			SOURCE_CHECKSUMS[label as keyof typeof SOURCE_CHECKSUMS]
		)
	}

	const familyEvidence = await verifyFamilyEvidence()
	const archiveBytes = await readBytes(sourceFiles.rawArchive)
	const primaryManifest = JSON.parse(
		(await readBytes(sourceFiles.manifest)).toString()
	) as unknown
	const selectedSource = JSON.parse(
		(await readBytes(sourceFiles.selectedRecords)).toString()
	) as unknown
	const archiveValidation = validateArchiveProvenance(
		archiveBytes,
		primaryManifest,
		selectedSource
	)
	const dataset = buildLobsterTaxonomyDataset(selectedSource)
	const datasetContents = serializeJson(dataset)
	const normalizedSha256 = sha256(datasetContents)
	const provenance = {
		schemaVersion: 1,
		snapshot: LOBSTER_TAXONOMY_SNAPSHOT,
		familyScope: FAMILY_SCOPE,
		source: {
			provider: "World Register of Marine Species (WoRMS)",
			citation: WORMS_CITATION,
			apiSpecification: {
				path: sourceFiles.openApi,
				sha256: SOURCE_CHECKSUMS.openApi
			},
			endpoints: {
				familyNameResolution:
					"GET /AphiaRecordsByName/{scientificname}?like=false&marine_only=false&offset=1",
				familyIdentityConfirmation:
					"GET /AphiaRecordByAphiaID/{AphiaID}",
				recursiveEnumeration:
					"GET /AphiaChildrenByAphiaID/{AphiaID}?marine_only=false&extant_only=false&offset={1,51,...}"
			},
			selection:
				"rank=Species; status=accepted; isMarine=1; isExtinct=0; exact approved family",
			rawArchive: {
				path: sourceFiles.rawArchive,
				sha256: SOURCE_CHECKSUMS.rawArchive,
				memberCount: archiveValidation.archiveMemberCount,
				embeddedPrimaryManifestSha256:
					archiveValidation.embeddedPrimaryManifestSha256
			},
			manifest: {
				path: sourceFiles.manifest,
				sha256: SOURCE_CHECKSUMS.manifest,
				pathMode: "archive-relative",
				archiveRoot: archiveValidation.primary.archiveRoot,
				matchesEmbeddedPrimaryAfterPathNormalization:
					archiveValidation.portableManifestMatchesEmbeddedPrimary,
				requestCount: archiveValidation.primary.requestCount,
				responseRecordOccurrences:
					archiveValidation.primary.responseRecordOccurrences,
				selectedRecordCount:
					archiveValidation.primary.selectedRecordCount,
				selectedRecordsMatch:
					archiveValidation.primary.selectedRecordsMatch
			},
			selectedRecords: {
				path: sourceFiles.selectedRecords,
				sha256: SOURCE_CHECKSUMS.selectedRecords
			},
			selectionSummary: {
				path: sourceFiles.selectionSummary,
				sha256: SOURCE_CHECKSUMS.selectionSummary
			},
			filteredValidationTraversal: archiveValidation.filtered,
			familyEvidence
		},
		normalized: {
			path: datasetPath,
			recordCount: dataset.records.length,
			sha256: normalizedSha256
		}
	}

	return {
		datasetContents,
		provenanceContents: serializeJson(provenance),
		normalizedSha256
	}
}

const verifyOutput = async (path: string, expected: string) => {
	const actual = await readFile(path, "utf8")
	if (actual !== expected) {
		throw new Error(
			`${path} is stale; run bun scripts/build-lobster-taxonomy.ts --write`
		)
	}
}

const main = async () => {
	const mode = Bun.argv[2] ?? "--verify"
	if (mode !== "--verify" && mode !== "--write") {
		throw new Error("usage: bun scripts/build-lobster-taxonomy.ts [--verify|--write]")
	}

	const artifacts = await generateLobsterTaxonomyArtifacts()
	if (mode === "--write") {
		await writeFile(datasetPath, artifacts.datasetContents)
		await writeFile(provenancePath, artifacts.provenanceContents)
		console.log(
			`wrote ${basename(datasetPath)} and ${basename(provenancePath)} ` +
				`(${artifacts.normalizedSha256})`
		)
		return
	}

	await verifyOutput(datasetPath, artifacts.datasetContents)
	await verifyOutput(provenancePath, artifacts.provenanceContents)
	console.log(
		`verified ${basename(datasetPath)} and ${basename(provenancePath)} ` +
			`(${artifacts.normalizedSha256})`
	)
}

if (import.meta.main) {
	await main()
}
