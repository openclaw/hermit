import metadataData from "../../data/lobster/metadata/lobster-metadata.json" with {
	type: "json"
}
import provenanceData from "../../data/lobster/metadata/provenance.json" with {
	type: "json"
}
import sourceConfigData from "../../data/lobster/metadata/source/metadata-config.json" with {
	type: "json"
}
import taxonomyData from "../../data/lobster/taxonomy/lobster-species.json" with {
	type: "json"
}
import {
	computeSceneQuotaReport,
	deepFreeze,
	type LobsterMetadataDataset,
	type LobsterMetadataRecord,
	type LobsterSceneQuotaReport,
	type LobsterTaxonomyInputRecord,
	parseLobsterMetadataDataset,
	parseLobsterMetadataSourceConfig,
	SCIENTIFIC_ANATOMY_APPROVAL_STATEMENT,
	serializeJson,
	sha256
} from "../../scripts/lib/lobster-metadata.js"

export type LobsterMetadataProvenance = {
	schemaVersion: 1
	taxonomy: {
		snapshotId: string
		path: string
		sha256: string
		recordCount: number
	}
	sourceConfig: { path: string; sha256: string; policySha256: string }
	evidencePolicy: {
		unknownCapabilityFailsClosed: true
		capabilityEvidenceRequiresExactClaimBinding: true
		displayNameFallback: "scientificName"
	}
	scientificAnatomyApproval: {
		designatedApprover: string
		status: "designated-not-reviewed"
		statement: string
	}
	generated: {
		path: string
		sha256: string
		recordCount: number
		sceneCount: number
		sceneIdPattern: string
		output: {
			format: "webp"
			width: 768
			height: 512
			aspectRatio: "3:2"
			largerMasterRetained: false
		}
	}
	quotaReport: LobsterSceneQuotaReport
}

const requireObject = (
	value: unknown,
	context: string
): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${context} must be an object`)
	}
	return value as Record<string, unknown>
}

const requireString = (value: unknown, context: string) => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${context} must be a non-empty string`)
	}
}

const requireExactKeys = (
	value: Record<string, unknown>,
	keys: readonly string[],
	context: string
) => {
	const allowed = new Set(keys)
	const unknown = Object.keys(value).filter((key) => !allowed.has(key))
	if (unknown.length > 0) {
		throw new Error(`${context} contains unknown key ${unknown.sort()[0]}`)
	}
}

const requireInteger = (value: unknown, context: string) => {
	if (!Number.isInteger(value)) throw new Error(`${context} must be an integer`)
}

const requireNumber = (value: unknown, context: string) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${context} must be a finite number`)
	}
}

const parseTaxonomyRecords = (value: unknown): LobsterTaxonomyInputRecord[] => {
	const taxonomy = requireObject(value, "lobster taxonomy")
	const records = taxonomy.records
	if (!Array.isArray(records) || records.length !== 264) {
		throw new Error("lobster taxonomy records are invalid")
	}
	const parsed = records.map((record, index) => {
		const entry = requireObject(record, `lobster taxonomy.records[${index}]`)
		requireInteger(entry.AphiaID, `lobster taxonomy.records[${index}].AphiaID`)
		requireString(
			entry.scientificName,
			`lobster taxonomy.records[${index}].scientificName`
		)
		requireString(entry.family, `lobster taxonomy.records[${index}].family`)
		const source = requireObject(
			entry.source,
			`lobster taxonomy.records[${index}].source`
		)
		requireString(source.url, `lobster taxonomy.records[${index}].source.url`)
		requireString(
			source.citation,
			`lobster taxonomy.records[${index}].source.citation`
		)
		return {
			AphiaID: entry.AphiaID as number,
			scientificName: entry.scientificName as string,
			family: entry.family as string,
			source: {
				url: source.url as string,
				citation: source.citation as string
			}
		}
	})
	const ids = parsed.map(({ AphiaID }) => AphiaID)
	if (
		new Set(ids).size !== ids.length ||
		ids.some((id, index) => index > 0 && id <= ids[index - 1]!)
	) {
		throw new Error("lobster taxonomy AphiaIDs must be unique and sorted")
	}
	return parsed
}

const validateQuotaReport = (value: unknown) => {
	const quota = requireObject(value, "provenance.quotaReport")
	requireExactKeys(
		quota,
		[
			"totalScenes",
			"mediumMax",
			"environmentFamilyMax",
			"officeBoardroomOrHearing",
			"castPatternMax",
			"humanScenes",
			"prominentAdultWomanHumanScenes",
			"nonPhotorealistic",
			"noConventionalModernWorkplace"
		],
		"provenance.quotaReport"
	)
	requireInteger(quota.totalScenes, "provenance.quotaReport.totalScenes")
	requireInteger(quota.humanScenes, "provenance.quotaReport.humanScenes")
	for (const field of [
		"mediumMax",
		"environmentFamilyMax",
		"castPatternMax"
	] as const) {
		const bucket = requireObject(quota[field], `provenance.quotaReport.${field}`)
		requireExactKeys(
			bucket,
			["id", "count", "share"],
			`provenance.quotaReport.${field}`
		)
		requireString(bucket.id, `provenance.quotaReport.${field}.id`)
		requireInteger(bucket.count, `provenance.quotaReport.${field}.count`)
		requireNumber(bucket.share, `provenance.quotaReport.${field}.share`)
	}
	for (const field of [
		"officeBoardroomOrHearing",
		"prominentAdultWomanHumanScenes",
		"nonPhotorealistic",
		"noConventionalModernWorkplace"
	] as const) {
		const bucket = requireObject(quota[field], `provenance.quotaReport.${field}`)
		requireExactKeys(
			bucket,
			["count", "share"],
			`provenance.quotaReport.${field}`
		)
		requireInteger(bucket.count, `provenance.quotaReport.${field}.count`)
		requireNumber(bucket.share, `provenance.quotaReport.${field}.share`)
	}
}

export const parseLobsterMetadataProvenance = (
	value: unknown,
	dataset: LobsterMetadataDataset,
	config = sourceConfig
): LobsterMetadataProvenance => {
	const provenance = requireObject(value, "lobster metadata provenance")
	requireExactKeys(
		provenance,
		[
			"schemaVersion",
			"taxonomy",
			"sourceConfig",
			"evidencePolicy",
			"scientificAnatomyApproval",
			"generated",
			"quotaReport"
		],
		"lobster metadata provenance"
	)
	if (provenance.schemaVersion !== 1) {
		throw new Error("lobster metadata provenance schema is invalid")
	}
	const taxonomy = requireObject(provenance.taxonomy, "provenance.taxonomy")
	requireExactKeys(
		taxonomy,
		["snapshotId", "path", "sha256", "recordCount"],
		"provenance.taxonomy"
	)
	requireString(taxonomy.snapshotId, "provenance.taxonomy.snapshotId")
	requireString(taxonomy.path, "provenance.taxonomy.path")
	requireString(taxonomy.sha256, "provenance.taxonomy.sha256")
	requireInteger(taxonomy.recordCount, "provenance.taxonomy.recordCount")
	const provenanceSourceConfig = requireObject(
		provenance.sourceConfig,
		"provenance.sourceConfig"
	)
	requireExactKeys(
		provenanceSourceConfig,
		["path", "sha256", "policySha256"],
		"provenance.sourceConfig"
	)
	requireString(provenanceSourceConfig.path, "provenance.sourceConfig.path")
	requireString(provenanceSourceConfig.sha256, "provenance.sourceConfig.sha256")
	requireString(
		provenanceSourceConfig.policySha256,
		"provenance.sourceConfig.policySha256"
	)
	if (
		provenanceSourceConfig.path !==
			"data/lobster/metadata/source/metadata-config.json" ||
		!/^[a-f0-9]{64}$/.test(provenanceSourceConfig.sha256 as string) ||
		!/^[a-f0-9]{64}$/.test(
			provenanceSourceConfig.policySha256 as string
		)
	) {
		throw new Error("provenance source config binding is invalid")
	}
	const policy = requireObject(
		provenance.evidencePolicy,
		"provenance.evidencePolicy"
	)
	requireExactKeys(
		policy,
		[
			"unknownCapabilityFailsClosed",
			"capabilityEvidenceRequiresExactClaimBinding",
			"displayNameFallback"
		],
		"provenance.evidencePolicy"
	)
	if (
		policy.unknownCapabilityFailsClosed !== true ||
		policy.capabilityEvidenceRequiresExactClaimBinding !== true ||
		policy.displayNameFallback !== "scientificName"
	) {
		throw new Error("provenance evidence policy is invalid")
	}
	const approval = requireObject(
		provenance.scientificAnatomyApproval,
		"provenance.scientificAnatomyApproval"
	)
	requireExactKeys(
		approval,
		["designatedApprover", "status", "statement"],
		"provenance.scientificAnatomyApproval"
	)
	if (
		approval.designatedApprover !== "Peter Steinberger" ||
		approval.status !== "designated-not-reviewed" ||
		approval.statement !== SCIENTIFIC_ANATOMY_APPROVAL_STATEMENT ||
		JSON.stringify(approval) !==
			JSON.stringify(config.scientificAnatomyApproval)
	) {
		throw new Error("provenance scientific approval status is invalid")
	}
	const generated = requireObject(provenance.generated, "provenance.generated")
	requireExactKeys(
		generated,
		[
			"path",
			"sha256",
			"recordCount",
			"sceneCount",
			"sceneIdPattern",
			"output"
		],
		"provenance.generated"
	)
	requireString(generated.path, "provenance.generated.path")
	requireString(generated.sha256, "provenance.generated.sha256")
	requireInteger(generated.recordCount, "provenance.generated.recordCount")
	requireInteger(generated.sceneCount, "provenance.generated.sceneCount")
	requireString(generated.sceneIdPattern, "provenance.generated.sceneIdPattern")
	const output = requireObject(generated.output, "provenance.generated.output")
	requireExactKeys(
		output,
		["format", "width", "height", "aspectRatio", "largerMasterRetained"],
		"provenance.generated.output"
	)
	if (
		output.format !== "webp" ||
		output.width !== 768 ||
		output.height !== 512 ||
		output.aspectRatio !== "3:2" ||
		output.largerMasterRetained !== false
	) {
		throw new Error("provenance output specification is invalid")
	}
	validateQuotaReport(provenance.quotaReport)
	const quota = provenance.quotaReport as Record<string, unknown>
	if (
		taxonomy.recordCount !== 264 ||
		generated.recordCount !== 264 ||
		generated.sceneCount !== 1056 ||
		quota.totalScenes !== 1056
	) {
		throw new Error("provenance generated counts are invalid")
	}
	if (
		taxonomy.snapshotId !== dataset.taxonomySnapshotId ||
		taxonomy.sha256 !== dataset.taxonomySha256
	) {
		throw new Error("provenance taxonomy binding does not match metadata")
	}
	if (generated.sha256 !== sha256(serializeJson(dataset))) {
		throw new Error("provenance checksums do not match imported metadata")
	}
	if (
		provenanceSourceConfig.policySha256 !== sha256(serializeJson(config))
	) {
		throw new Error(
			"provenance source config policy checksum does not match imported canonical config"
		)
	}
	const expectedQuota = computeSceneQuotaReport(dataset, config)
	if (JSON.stringify(provenance.quotaReport) !== JSON.stringify(expectedQuota)) {
		throw new Error("provenance quota report does not match metadata")
	}
	return value as LobsterMetadataProvenance
}

const sourceConfig = parseLobsterMetadataSourceConfig(sourceConfigData)
const taxonomyRecords = parseTaxonomyRecords(taxonomyData)

export const lobsterMetadata: Readonly<LobsterMetadataDataset> = deepFreeze(
	parseLobsterMetadataDataset(metadataData, taxonomyRecords, sourceConfig)
)

export const lobsterMetadataProvenance: Readonly<LobsterMetadataProvenance> =
	deepFreeze(
		parseLobsterMetadataProvenance(
			provenanceData,
			lobsterMetadata,
			sourceConfig
		)
	)

export const lobsterMetadataRecords: readonly LobsterMetadataRecord[] =
	lobsterMetadata.records

const readonlyMap = new Map(
	lobsterMetadataRecords.map((record) => [record.AphiaID, record] as const)
)

export const lobsterMetadataByAphiaId: ReadonlyMap<
	number,
	LobsterMetadataRecord
> = Object.freeze({
	get size() {
		return readonlyMap.size
	},
	has: (key: number) => readonlyMap.has(key),
	get: (key: number) => readonlyMap.get(key),
	entries: () => readonlyMap.entries(),
	keys: () => readonlyMap.keys(),
	values: () => readonlyMap.values(),
	forEach: (
		callback: (
			value: LobsterMetadataRecord,
			key: number,
			map: ReadonlyMap<number, LobsterMetadataRecord>
		) => void,
		thisArg?: unknown
	) => {
		for (const [key, value] of readonlyMap) {
			callback.call(thisArg, value, key, lobsterMetadataByAphiaId)
		}
	},
	[Symbol.iterator]: () => readonlyMap[Symbol.iterator]()
} satisfies ReadonlyMap<number, LobsterMetadataRecord>)

export const getLobsterMetadataByAphiaId = (AphiaID: number) =>
	lobsterMetadataByAphiaId.get(AphiaID)

export const requireLobsterMetadataByAphiaId = (AphiaID: number) => {
	const record = getLobsterMetadataByAphiaId(AphiaID)
	if (!record) {
		throw new Error(`No bundled lobster metadata for AphiaID ${AphiaID}`)
	}
	return record
}
