import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"
import {
	buildLobsterMetadataDataset,
	computeSceneQuotaReport,
	parseLobsterMetadataSourceConfig,
	type LobsterTaxonomyInputRecord,
	serializeJson,
	sha256,
	validateLobsterMetadataDataset
} from "./lib/lobster-metadata.js"

const root = "data/lobster/metadata"
const taxonomyPath = "data/lobster/taxonomy/lobster-species.json"
const taxonomyProvenancePath = "data/lobster/taxonomy/provenance.json"
const sourceConfigPath = `${root}/source/metadata-config.json`
const datasetPath = `${root}/lobster-metadata.json`
const provenancePath = `${root}/provenance.json`

type TaxonomyDataset = {
	schemaVersion: 1
	snapshotId: string
	records: LobsterTaxonomyInputRecord[]
}

type TaxonomyProvenance = {
	snapshot: {
		id: string
	}
	normalized: {
		path: string
		recordCount: number
		sha256: string
	}
}

const parseJson = (bytes: Uint8Array, context: string): unknown => {
	try {
		return JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		throw new Error(`${context} is not valid JSON`)
	}
}

const parseTaxonomyDataset = (value: unknown): TaxonomyDataset => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("taxonomy dataset must be an object")
	}
	const candidate = value as Record<string, unknown>
	if (
		candidate.schemaVersion !== 1 ||
		typeof candidate.snapshotId !== "string" ||
		!Array.isArray(candidate.records)
	) {
		throw new Error("taxonomy dataset is malformed")
	}
	for (const [index, record] of candidate.records.entries()) {
		if (typeof record !== "object" || record === null || Array.isArray(record)) {
			throw new Error(`taxonomy record ${index} is malformed`)
		}
		const entry = record as Record<string, unknown>
		if (
			!Number.isInteger(entry.AphiaID) ||
			typeof entry.scientificName !== "string" ||
			typeof entry.family !== "string" ||
			typeof entry.source !== "object" ||
			entry.source === null
		) {
			throw new Error(`taxonomy record ${index} is malformed`)
		}
		const source = entry.source as Record<string, unknown>
		if (
			typeof source.url !== "string" ||
			typeof source.citation !== "string"
		) {
			throw new Error(`taxonomy record ${index} source is malformed`)
		}
	}
	return value as TaxonomyDataset
}

const parseTaxonomyProvenance = (value: unknown): TaxonomyProvenance => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("taxonomy provenance must be an object")
	}
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.snapshot !== "object" ||
		candidate.snapshot === null ||
		typeof candidate.normalized !== "object" ||
		candidate.normalized === null
	) {
		throw new Error("taxonomy provenance is malformed")
	}
	const snapshot = candidate.snapshot as Record<string, unknown>
	const normalized = candidate.normalized as Record<string, unknown>
	if (
		typeof snapshot.id !== "string" ||
		typeof normalized.path !== "string" ||
		!Number.isInteger(normalized.recordCount) ||
		typeof normalized.sha256 !== "string"
	) {
		throw new Error("taxonomy provenance is malformed")
	}
	return value as TaxonomyProvenance
}

export const generateLobsterMetadataArtifacts = async () => {
	const [
		taxonomyBytes,
		taxonomyProvenanceBytes,
		sourceConfigBytes
	] = await Promise.all([
		readFile(taxonomyPath),
		readFile(taxonomyProvenancePath),
		readFile(sourceConfigPath)
	])
	const taxonomy = parseTaxonomyDataset(
		parseJson(taxonomyBytes, taxonomyPath)
	)
	const taxonomyProvenance = parseTaxonomyProvenance(
		parseJson(taxonomyProvenanceBytes, taxonomyProvenancePath)
	)
	const sourceConfig = parseLobsterMetadataSourceConfig(
		parseJson(sourceConfigBytes, sourceConfigPath)
	)
	const taxonomySha256 = sha256(taxonomyBytes)

	if (
		taxonomy.snapshotId !== sourceConfig.taxonomy.snapshotId ||
		taxonomyProvenance.snapshot.id !== sourceConfig.taxonomy.snapshotId
	) {
		throw new Error("taxonomy snapshot agreement failed")
	}
	if (
		taxonomySha256 !== sourceConfig.taxonomy.normalizedSha256 ||
		taxonomyProvenance.normalized.sha256 !==
			sourceConfig.taxonomy.normalizedSha256
	) {
		throw new Error("taxonomy checksum agreement failed")
	}
	if (
		taxonomyProvenance.normalized.path !== taxonomyPath ||
		taxonomyProvenance.normalized.recordCount !== taxonomy.records.length
	) {
		throw new Error("taxonomy provenance does not describe the normalized input")
	}

	const dataset = buildLobsterMetadataDataset(taxonomy.records, sourceConfig)
	validateLobsterMetadataDataset(dataset, taxonomy.records, sourceConfig)
	const datasetContents = serializeJson(dataset)
	const datasetSha256 = sha256(datasetContents)
	const quotaReport = computeSceneQuotaReport(dataset, sourceConfig)
	const provenance = {
		schemaVersion: 1,
		taxonomy: {
			snapshotId: taxonomy.snapshotId,
			path: taxonomyPath,
			sha256: taxonomySha256,
			recordCount: taxonomy.records.length
		},
		sourceConfig: {
			path: sourceConfigPath,
			sha256: sha256(sourceConfigBytes),
			policySha256: sha256(serializeJson(sourceConfig))
		},
		evidencePolicy: sourceConfig.evidencePolicy,
		scientificAnatomyApproval:
			sourceConfig.scientificAnatomyApproval,
		generated: {
			path: datasetPath,
			sha256: datasetSha256,
			recordCount: dataset.records.length,
			sceneCount: quotaReport.totalScenes,
			sceneIdPattern: "lob-v1-a{AphiaID}-s01..s04",
			output: sourceConfig.output
		},
		quotaReport
	}

	return {
		dataset,
		datasetContents,
		datasetSha256,
		provenance,
		provenanceContents: serializeJson(provenance),
		quotaReport
	}
}

const verifyOutput = async (path: string, expected: string) => {
	let actual: string
	try {
		actual = await readFile(path, "utf8")
	} catch {
		throw new Error(
			`${path} is missing; run bun scripts/build-lobster-metadata.ts --write`
		)
	}
	if (actual !== expected) {
		throw new Error(
			`${path} is stale; run bun scripts/build-lobster-metadata.ts --write`
		)
	}
}

const percent = (value: number) => `${(value * 100).toFixed(2)}%`

const summary = (
	mode: "wrote" | "verified",
	artifacts: Awaited<ReturnType<typeof generateLobsterMetadataArtifacts>>
) => {
	const quota = artifacts.quotaReport
	console.log(
		`${mode} ${basename(datasetPath)} and ${basename(provenancePath)}: ` +
			`${artifacts.dataset.records.length} records, ${quota.totalScenes} scenes, ` +
			`sha256 ${artifacts.datasetSha256}`
	)
	console.log(
		`quotas: medium ${percent(quota.mediumMax.share)}, ` +
			`environment ${percent(quota.environmentFamilyMax.share)}, ` +
			`office ${percent(quota.officeBoardroomOrHearing.share)}, ` +
			`cast ${percent(quota.castPatternMax.share)}, ` +
			`adult-woman human scenes ` +
			`${percent(quota.prominentAdultWomanHumanScenes.share)}, ` +
			`non-photorealistic ${percent(quota.nonPhotorealistic.share)}, ` +
			`no modern workplace ${percent(quota.noConventionalModernWorkplace.share)}`
	)
}

const main = async () => {
	const mode = Bun.argv[2] ?? "--verify"
	if (mode !== "--verify" && mode !== "--write") {
		throw new Error(
			"usage: bun scripts/build-lobster-metadata.ts [--verify|--write]"
		)
	}

	const artifacts = await generateLobsterMetadataArtifacts()
	if (mode === "--write") {
		await writeFile(datasetPath, artifacts.datasetContents)
		await writeFile(provenancePath, artifacts.provenanceContents)
		summary("wrote", artifacts)
		return
	}

	await verifyOutput(datasetPath, artifacts.datasetContents)
	await verifyOutput(provenancePath, artifacts.provenanceContents)
	summary("verified", artifacts)
}

if (import.meta.main) {
	await main()
}
