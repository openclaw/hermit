import { createHash } from "node:crypto"

export const LOBSTER_METADATA_SCHEMA_VERSION = 1 as const
export const LOBSTER_METADATA_SNAPSHOT_ID =
	"worms-2026-07-17T060825613Z" as const
export const LOBSTER_TAXONOMY_SHA256 =
	"304e62d2180e380ddd9f7d8f5fbce351edd77605ea79a5e4c7a9042fd4e70152" as const
export const LOBSTER_METADATA_SOURCE_POLICY_SHA256 =
	"9448931b0100094149fdfbc72891cd76afa7467bdc4f4e29c90ed8a081aac932" as const
export const SCIENTIFIC_ANATOMY_APPROVAL_STATEMENT =
	"Peter Steinberger is the designated scientific anatomy approver. This source configuration does not claim that he reviewed or approved the generated dataset." as const

export const LOBSTER_CAPABILITY_NAMES = [
	"largeGraspingClaws",
	"prominentAntennae",
	"antennaStrikingBehavior",
	"tailEscapeBehavior",
	"flattenedPlateAntennae",
	"multipleChelatePereopods",
	"subchelateFirstLegs",
	"forcefulBodyContact",
	"ambushBehavior"
] as const

export type LobsterCapabilityName =
	(typeof LOBSTER_CAPABILITY_NAMES)[number]

export const ACTION_REGISTRY = {
	refusal: { capability: null, kind: "fallback", returnSafe: true },
	"ceremonial-display": {
		capability: null,
		kind: "fallback",
		returnSafe: true
	},
	"editorial-observe": {
		capability: null,
		kind: "fallback",
		returnSafe: true
	},
	"editorial-pose": {
		capability: null,
		kind: "fallback",
		returnSafe: true
	},
	"large-chela-stand-off": {
		capability: "largeGraspingClaws",
		kind: "morphology",
		returnSafe: true
	},
	"antenna-stand-off": {
		capability: "prominentAntennae",
		kind: "morphology",
		returnSafe: true
	},
	"antenna-plate-refusal": {
		capability: "flattenedPlateAntennae",
		kind: "morphology",
		returnSafe: true
	},
	"multi-chela-stand-off": {
		capability: "multipleChelatePereopods",
		kind: "morphology",
		returnSafe: true
	},
	"subchelate-stand-off": {
		capability: "subchelateFirstLegs",
		kind: "morphology",
		returnSafe: true
	},
	pinch: {
		capability: "largeGraspingClaws",
		kind: "physical",
		returnSafe: false
	},
	"antenna-strike": {
		capability: "antennaStrikingBehavior",
		kind: "physical",
		returnSafe: false
	},
	"tail-escape": {
		capability: "tailEscapeBehavior",
		kind: "physical",
		returnSafe: false
	},
	"body-check": {
		capability: "forcefulBodyContact",
		kind: "physical",
		returnSafe: false
	},
	ambush: {
		capability: "ambushBehavior",
		kind: "physical",
		returnSafe: false
	}
} as const

export type LobsterActionId = keyof typeof ACTION_REGISTRY
export type EvidenceStatus = true | false | "unknown"
export type EvidenceKnowledgeStatus = "known" | "unknown"
export type ReviewStatus = "not-reviewed" | "approved" | "rejected"
export type AutomatedReviewStatus = "validated" | "failed"

export type EvidenceValue<T> = {
	value: T | null
	status: EvidenceKnowledgeStatus
	evidenceScope: string
	citationIds: string[]
}

export type CapabilityEvidence = {
	value: EvidenceStatus
	evidenceScope: string
	citationIds: string[]
	supportedClaims: string[]
}

export type CapabilityClaimBinding = {
	family: string
	capability: LobsterCapabilityName
	value: boolean
	citationId: string
	claim: string
}

export type ScientificCitation = {
	id: string
	scope:
		| "record-taxonomy"
		| "dataset-taxonomy"
		| "family-anatomy"
		| "family-behavior"
		| "species-behavior"
	title: string
	authors: string
	provider: string
	publicationYear: number
	url: string
	citation: string
	supportedClaims: string[]
}

export type AdultCastMember = {
	adultStatus: "adult"
	genderPresentation: "woman" | "man" | "nonbinary"
	skinToneGroup: "light" | "medium" | "dark" | "varied"
	ageBand: "young-adult" | "middle-aged" | "older-adult" | "mixed-adult"
	bodyType: string
	wardrobe: string
	role: string
	prominence: "prominent" | "supporting"
}

export type CastPattern = {
	id: string
	kind: "human" | "no-human" | "robot" | "fantasy"
	adults: AdultCastMember[]
}

export type LobsterSceneOutput = {
	format: "webp"
	width: 768
	height: 512
	aspectRatio: "3:2"
	largerMasterRetained: false
}

export type LobsterScenePlan = {
	id: string
	action: LobsterActionId
	environment: string
	environmentFamily: string
	era: string
	medium: string
	mediumKind: "photorealistic" | "non-photorealistic"
	tone: string
	cast: CastPattern
	camera: {
		position: string
		lensLanguage: string
	}
	composition: string
	lighting: string
	palette: string
	sceneFamilyId: string
	promptVersion: "lob-v1"
	humanReviewStatus: ReviewStatus
	automatedReviewStatus: AutomatedReviewStatus
	headline: string
	altText: string
	output: LobsterSceneOutput
}

export type LobsterMetadataRecord = {
	AphiaID: number
	scientificName: string
	displayName: string
	family: string
	broadBodyPlan: EvidenceValue<string>
	anatomyFacts: EvidenceValue<string[]>
	habitat: EvidenceValue<string>
	depthBand: EvidenceValue<string>
	geographicRegion: EvidenceValue<string>
	capabilities: Record<LobsterCapabilityName, CapabilityEvidence>
	permittedActions: Array<{ id: LobsterActionId; reason: string }>
	prohibitedActions: Array<{ id: LobsterActionId; reason: string }>
	narrativeVocabulary: {
		subjectTerms: string[]
		safeVerbs: string[]
		evidencePolicy: {
			citedFamilyAnatomyAllowed: true
			actionsLimitedToPermittedSet: true
			unsupportedBehaviorProhibited: true
		}
	}
	accessibility: {
		subjectFragment: string
		taxonomyFragment: string
		actionEvidenceFragment: string
	}
	scientificCitations: ScientificCitation[]
	scenePlans: [
		LobsterScenePlan,
		LobsterScenePlan,
		LobsterScenePlan,
		LobsterScenePlan
	]
}

export type LobsterMetadataDataset = {
	schemaVersion: typeof LOBSTER_METADATA_SCHEMA_VERSION
	taxonomySnapshotId: typeof LOBSTER_METADATA_SNAPSHOT_ID
	taxonomySha256: typeof LOBSTER_TAXONOMY_SHA256
	records: LobsterMetadataRecord[]
}

export type LobsterTaxonomyInputRecord = {
	AphiaID: number
	scientificName: string
	family: string
	source: { url: string; citation: string }
}

type SceneRegistryEntry = { id: string }
type EnvironmentRegistryEntry = SceneRegistryEntry & {
	family: string
	isOfficeBoardroomOrHearing: boolean
	hasConventionalModernWorkplace: boolean
}

export type LobsterMetadataSourceConfig = {
	schemaVersion: 1
	taxonomy: {
		snapshotId: string
		normalizedPath: string
		normalizedSha256: string
		datasetCitation: Omit<ScientificCitation, "scope">
	}
	scientificAnatomyApproval: {
		designatedApprover: string
		status: "designated-not-reviewed"
		statement: string
	}
	evidencePolicy: {
		unknownCapabilityFailsClosed: true
		capabilityEvidenceRequiresExactClaimBinding: true
		displayNameFallback: "scientificName"
	}
	citationRegistry: Array<
		Omit<ScientificCitation, "scope"> & {
			scope: "family-anatomy" | "family-behavior" | "species-behavior"
		}
	>
	capabilityClaimBindings: CapabilityClaimBinding[]
	familyEvidenceProfiles: Array<{
		family: string
		broadBodyPlan: string
		anatomyFacts: string[]
		citationIds: string[]
		bodyPlanCitationIds: string[]
		capabilityEvidence: Array<
			CapabilityEvidence & { capability: LobsterCapabilityName }
		>
		sceneActions: [
			LobsterActionId,
			LobsterActionId,
			LobsterActionId,
			LobsterActionId
		]
	}>
	actions: {
		fallback: LobsterActionId[]
		morphology: LobsterActionId[]
		physical: LobsterActionId[]
	}
	scenes: {
		mediums: Array<SceneRegistryEntry & {
			kind: "photorealistic" | "non-photorealistic"
		}>
		environments: EnvironmentRegistryEntry[]
		eras: SceneRegistryEntry[]
		cameraPositions: SceneRegistryEntry[]
		lensLanguages: SceneRegistryEntry[]
		compositions: SceneRegistryEntry[]
		lighting: SceneRegistryEntry[]
		palettes: SceneRegistryEntry[]
		tones: SceneRegistryEntry[]
		castPatterns: CastPattern[]
		promptVersion: "lob-v1"
		humanReviewStatus: "not-reviewed"
		automatedReviewStatus: "validated"
	}
	output: LobsterSceneOutput
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const requireObject = (
	value: unknown,
	context: string
): Record<string, unknown> => {
	if (!isObject(value)) throw new Error(`${context} must be an object`)
	return value
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

const requireArray = (value: unknown, context: string): unknown[] => {
	if (!Array.isArray(value)) throw new Error(`${context} must be an array`)
	return value
}

const requireString = (value: unknown, context: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${context} must be a non-empty string`)
	}
	return value
}

const requireBoolean = (value: unknown, context: string): boolean => {
	if (typeof value !== "boolean") throw new Error(`${context} must be boolean`)
	return value
}

const requireInteger = (value: unknown, context: string): number => {
	if (!Number.isInteger(value)) throw new Error(`${context} must be an integer`)
	return value as number
}

const requireLiteral = <T extends string | number | boolean>(
	value: unknown,
	expected: T,
	context: string
): T => {
	if (value !== expected) throw new Error(`${context} must be ${String(expected)}`)
	return expected
}

const requireEnum = <T extends string>(
	value: unknown,
	values: readonly T[],
	context: string
): T => {
	if (typeof value !== "string" || !values.includes(value as T)) {
		throw new Error(`${context} has invalid value ${String(value)}`)
	}
	return value as T
}

const requireStringArray = (value: unknown, context: string): string[] =>
	requireArray(value, context).map((entry, index) =>
		requireString(entry, `${context}[${index}]`)
	)

const requireUnique = (values: string[], context: string) => {
	if (new Set(values).size !== values.length) {
		throw new Error(`${context} contains duplicate IDs`)
	}
}

const requireUrl = (value: unknown, context: string): string => {
	const url = requireString(value, context)
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`${context} must be a valid URL`)
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`${context} must use HTTP or HTTPS`)
	}
	return url
}

const validateCitationShape = (
	value: unknown,
	context: string,
	allowedScope?: ScientificCitation["scope"] | null
) => {
	const citation = requireObject(value, context)
	requireExactKeys(
		citation,
		[
			"id",
			...(allowedScope === null ? [] : ["scope"]),
			"title",
			"authors",
			"provider",
			"publicationYear",
			"url",
			"citation",
			"supportedClaims"
		],
		context
	)
	requireString(citation.id, `${context}.id`)
	requireString(citation.title, `${context}.title`)
	requireString(citation.authors, `${context}.authors`)
	requireString(citation.provider, `${context}.provider`)
	const year = requireInteger(citation.publicationYear, `${context}.publicationYear`)
	if (year < 1800 || year > 2100) {
		throw new Error(`${context}.publicationYear is implausible`)
	}
	requireUrl(citation.url, `${context}.url`)
	requireString(citation.citation, `${context}.citation`)
	const claims = requireStringArray(
		citation.supportedClaims,
		`${context}.supportedClaims`
	)
	if (claims.length === 0) throw new Error(`${context} must support a claim`)
	if (allowedScope !== undefined && allowedScope !== null) {
		requireLiteral(citation.scope, allowedScope, `${context}.scope`)
	}
}

const validateRegistry = (
	value: unknown,
	context: string,
	keys: readonly string[],
	validateEntry?: (entry: Record<string, unknown>, context: string) => void
) => {
	const entries = requireArray(value, context)
	const ids = entries.map((entry, index) => {
		const entryContext = `${context}[${index}]`
		const object = requireObject(entry, entryContext)
		requireExactKeys(object, keys, entryContext)
		validateEntry?.(object, entryContext)
		return requireString(object.id, `${entryContext}.id`)
	})
	requireUnique(ids, context)
	if (entries.length < 4) throw new Error(`${context} requires at least four entries`)
}

const validateAdultCastMember = (value: unknown, context: string) => {
	const member = requireObject(value, context)
	requireExactKeys(
		member,
		[
			"adultStatus",
			"genderPresentation",
			"skinToneGroup",
			"ageBand",
			"bodyType",
			"wardrobe",
			"role",
			"prominence"
		],
		context
	)
	requireLiteral(member.adultStatus, "adult", `${context}.adultStatus`)
	requireEnum(
		member.genderPresentation,
		["woman", "man", "nonbinary"] as const,
		`${context}.genderPresentation`
	)
	requireEnum(
		member.skinToneGroup,
		["light", "medium", "dark", "varied"] as const,
		`${context}.skinToneGroup`
	)
	requireEnum(
		member.ageBand,
		["young-adult", "middle-aged", "older-adult", "mixed-adult"] as const,
		`${context}.ageBand`
	)
	requireString(member.bodyType, `${context}.bodyType`)
	requireString(member.wardrobe, `${context}.wardrobe`)
	requireString(member.role, `${context}.role`)
	requireEnum(
		member.prominence,
		["prominent", "supporting"] as const,
		`${context}.prominence`
	)
}

const validateCastPattern = (value: unknown, context: string) => {
	const cast = requireObject(value, context)
	requireExactKeys(cast, ["id", "kind", "adults"], context)
	requireString(cast.id, `${context}.id`)
	const kind = requireEnum(
		cast.kind,
		["human", "no-human", "robot", "fantasy"] as const,
		`${context}.kind`
	)
	const adults = requireArray(cast.adults, `${context}.adults`)
	adults.forEach((adult, index) =>
		validateAdultCastMember(adult, `${context}.adults[${index}]`)
	)
	if (kind === "human" && adults.length === 0) {
		throw new Error(`${context}: human cast requires structured adults`)
	}
	if (kind !== "human" && adults.length !== 0) {
		throw new Error(`${context}: non-human cast cannot contain adults`)
	}
}

const validateOutput = (value: unknown, context: string) => {
	const output = requireObject(value, context)
	requireExactKeys(
		output,
		["format", "width", "height", "aspectRatio", "largerMasterRetained"],
		context
	)
	requireLiteral(output.format, "webp", `${context}.format`)
	requireLiteral(output.width, 768, `${context}.width`)
	requireLiteral(output.height, 512, `${context}.height`)
	requireLiteral(output.aspectRatio, "3:2", `${context}.aspectRatio`)
	requireLiteral(
		output.largerMasterRetained,
		false,
		`${context}.largerMasterRetained`
	)
}

export const parseLobsterMetadataSourceConfig = (
	value: unknown
): LobsterMetadataSourceConfig => {
	const config = requireObject(value, "metadata source config")
	requireExactKeys(
		config,
		[
			"schemaVersion",
			"taxonomy",
			"scientificAnatomyApproval",
			"evidencePolicy",
			"citationRegistry",
			"capabilityClaimBindings",
			"familyEvidenceProfiles",
			"actions",
			"scenes",
			"output"
		],
		"metadata source config"
	)
	requireLiteral(config.schemaVersion, 1, "metadata source config.schemaVersion")
	const taxonomy = requireObject(config.taxonomy, "metadata source config.taxonomy")
	requireExactKeys(
		taxonomy,
		["snapshotId", "normalizedPath", "normalizedSha256", "datasetCitation"],
		"metadata source config.taxonomy"
	)
	requireString(taxonomy.snapshotId, "metadata source config.taxonomy.snapshotId")
	requireString(
		taxonomy.normalizedPath,
		"metadata source config.taxonomy.normalizedPath"
	)
	requireString(
		taxonomy.normalizedSha256,
		"metadata source config.taxonomy.normalizedSha256"
	)
	validateCitationShape(
		taxonomy.datasetCitation,
		"metadata source config.taxonomy.datasetCitation",
		null
	)

	const approval = requireObject(
		config.scientificAnatomyApproval,
		"metadata source config.scientificAnatomyApproval"
	)
	requireExactKeys(
		approval,
		["designatedApprover", "status", "statement"],
		"metadata source config.scientificAnatomyApproval"
	)
	requireLiteral(
		approval.designatedApprover,
		"Peter Steinberger",
		"scientificAnatomyApproval.designatedApprover"
	)
	requireLiteral(
		approval.status,
		"designated-not-reviewed",
		"scientificAnatomyApproval.status"
	)
	requireLiteral(
		approval.statement,
		SCIENTIFIC_ANATOMY_APPROVAL_STATEMENT,
		"scientificAnatomyApproval.statement"
	)

	const policy = requireObject(config.evidencePolicy, "evidencePolicy")
	requireExactKeys(
		policy,
		[
			"unknownCapabilityFailsClosed",
			"capabilityEvidenceRequiresExactClaimBinding",
			"displayNameFallback"
		],
		"evidencePolicy"
	)
	requireLiteral(
		policy.unknownCapabilityFailsClosed,
		true,
		"evidencePolicy.unknownCapabilityFailsClosed"
	)
	requireLiteral(
		policy.capabilityEvidenceRequiresExactClaimBinding,
		true,
		"evidencePolicy.capabilityEvidenceRequiresExactClaimBinding"
	)
	requireLiteral(
		policy.displayNameFallback,
		"scientificName",
		"evidencePolicy.displayNameFallback"
	)

	const citations = requireArray(config.citationRegistry, "citationRegistry")
	const citationClaims = new Map<string, Set<string>>()
	const citationScopes = new Map<string, ScientificCitation["scope"]>()
	const citationIds = citations.map((citation, index) => {
		const context = `citationRegistry[${index}]`
		validateCitationShape(citation, context)
		const object = requireObject(citation, context)
		requireEnum(
			object.scope,
			["family-anatomy", "family-behavior", "species-behavior"] as const,
			`${context}.scope`
		)
		const id = requireString(
			requireObject(citation, `citationRegistry[${index}]`).id,
			`citationRegistry[${index}].id`
		)
		citationClaims.set(
			id,
			new Set(
				requireStringArray(object.supportedClaims, `${context}.supportedClaims`)
			)
		)
		citationScopes.set(id, object.scope as ScientificCitation["scope"])
		return id
	})
	requireUnique(citationIds, "citationRegistry")

	const claimBindings = requireArray(
		config.capabilityClaimBindings,
		"capabilityClaimBindings"
	)
	const claimBindingKeys = claimBindings.map((binding, index) => {
		const context = `capabilityClaimBindings[${index}]`
		const object = requireObject(binding, context)
		requireExactKeys(
			object,
			["family", "capability", "value", "citationId", "claim"],
			context
		)
		const family = requireString(object.family, `${context}.family`)
		const capability = requireEnum(
			object.capability,
			LOBSTER_CAPABILITY_NAMES,
			`${context}.capability`
		)
		const value = requireBoolean(object.value, `${context}.value`)
		const citationId = requireString(object.citationId, `${context}.citationId`)
		const claim = requireString(object.claim, `${context}.claim`)
		if (!citationClaims.get(citationId)?.has(claim)) {
			throw new Error(`${context}: citation does not contain bound claim`)
		}
		return [family, capability, String(value), citationId, claim].join("\u0000")
	})
	requireUnique(claimBindingKeys, "capabilityClaimBindings")
	const exactClaimBindings = new Set(claimBindingKeys)

	const profiles = requireArray(
		config.familyEvidenceProfiles,
		"familyEvidenceProfiles"
	)
	const profileFamilies = profiles.map((profile, index) => {
		const context = `familyEvidenceProfiles[${index}]`
		const object = requireObject(profile, context)
		requireExactKeys(
			object,
			[
				"family",
				"broadBodyPlan",
				"anatomyFacts",
				"citationIds",
				"bodyPlanCitationIds",
				"capabilityEvidence",
				"sceneActions"
			],
			context
		)
		const family = requireString(object.family, `${context}.family`)
		requireString(object.broadBodyPlan, `${context}.broadBodyPlan`)
		const facts = requireStringArray(object.anatomyFacts, `${context}.anatomyFacts`)
		if (facts.length === 0) throw new Error(`${context} requires anatomy facts`)
		const profileCitationIds = requireStringArray(
			object.citationIds,
			`${context}.citationIds`
		)
		if (profileCitationIds.length === 0) {
			throw new Error(`${context} requires citations`)
		}
		for (const id of profileCitationIds) {
			if (!citationIds.includes(id)) {
				throw new Error(`${context} references unknown citation ${id}`)
			}
		}
		const bodyPlanCitationIds = requireStringArray(
			object.bodyPlanCitationIds,
			`${context}.bodyPlanCitationIds`
		)
		if (
			bodyPlanCitationIds.length === 0 ||
			bodyPlanCitationIds.some((id) => !profileCitationIds.includes(id))
		) {
			throw new Error(
				`${context}: body-plan citations must be a non-empty profile citation subset`
			)
		}
		const capabilityEntries = requireArray(
			object.capabilityEvidence,
			`${context}.capabilityEvidence`
		)
		const capabilityNames = capabilityEntries.map((entry, capabilityIndex) => {
			const capabilityContext =
				`${context}.capabilityEvidence[${capabilityIndex}]`
			const capability = requireObject(entry, capabilityContext)
			requireExactKeys(
				capability,
				[
					"capability",
					"value",
					"evidenceScope",
					"citationIds",
					"supportedClaims"
				],
				capabilityContext
			)
			const name = requireEnum(
				capability.capability,
				LOBSTER_CAPABILITY_NAMES,
				`${capabilityContext}.capability`
			)
			const evidenceValue = capability.value
			if (
				evidenceValue !== true &&
				evidenceValue !== false &&
				evidenceValue !== "unknown"
			) {
				throw new Error(`${capabilityContext}.value is invalid`)
			}
			requireString(
				capability.evidenceScope,
				`${capabilityContext}.evidenceScope`
			)
			const evidenceCitationIds = requireStringArray(
				capability.citationIds,
				`${capabilityContext}.citationIds`
			)
			const supportedClaims = requireStringArray(
				capability.supportedClaims,
				`${capabilityContext}.supportedClaims`
			)
			requireUnique(evidenceCitationIds, `${capabilityContext}.citationIds`)
			requireUnique(supportedClaims, `${capabilityContext}.supportedClaims`)
			if (evidenceValue === "unknown") {
				if (
					evidenceCitationIds.length !== 0 ||
					supportedClaims.length !== 0
				) {
					throw new Error(
						`${capabilityContext}: unknown capability cannot bind evidence`
					)
				}
			} else {
				if (
					evidenceCitationIds.length === 0 ||
					supportedClaims.length === 0
				) {
					throw new Error(
						`${capabilityContext}: known capability requires citations and claims`
					)
				}
				for (const citationId of evidenceCitationIds) {
					const claims = citationClaims.get(citationId)
					if (!claims) {
						throw new Error(
							`${capabilityContext} references unknown citation ${citationId}`
						)
					}
					if (!supportedClaims.some((claim) => claims.has(claim))) {
						throw new Error(
							`${capabilityContext}: citation ${citationId} supports none of the bound claims`
						)
					}
					if (
						!supportedClaims.some((claim) =>
							exactClaimBindings.has(
								[
									family,
									name,
									String(evidenceValue),
									citationId,
									claim
								].join("\u0000")
							)
						)
					) {
						throw new Error(
							`${capabilityContext}: citation has no exact capability claim binding`
						)
					}
				}
				for (const claim of supportedClaims) {
					if (
						!evidenceCitationIds.some((citationId) =>
							exactClaimBindings.has(
								[
									family,
									name,
									String(evidenceValue),
									citationId,
									claim
								].join("\u0000")
							)
						)
					) {
						throw new Error(
							`${capabilityContext}: unsupported exact claim binding ${claim}`
						)
					}
				}
				if (
					evidenceValue === true &&
					[
						"antennaStrikingBehavior",
						"tailEscapeBehavior",
						"forcefulBodyContact",
						"ambushBehavior"
					].includes(name) &&
					!evidenceCitationIds.some(
						(citationId) =>
							citationScopes.get(citationId) === "family-behavior"
					)
				) {
					throw new Error(
						`${capabilityContext}: enabled behavioral capability requires family-behavior evidence`
					)
				}
			}
			return name
		})
		requireUnique(capabilityNames, `${context}.capabilityEvidence`)
		if (
			capabilityNames.length !== LOBSTER_CAPABILITY_NAMES.length ||
			LOBSTER_CAPABILITY_NAMES.some(
				(capability) => !capabilityNames.includes(capability)
			)
		) {
			throw new Error(`${context}: capability coverage is incomplete`)
		}
		const capabilityValues = new Map(
			capabilityEntries.map((entry) => {
				const capability = entry as {
					capability: LobsterCapabilityName
					value: EvidenceStatus
				}
				return [capability.capability, capability.value] as const
			})
		)
		const sceneActions = requireStringArray(
			object.sceneActions,
			`${context}.sceneActions`
		)
		requireUnique(sceneActions, `${context}.sceneActions`)
		if (sceneActions.length !== 4) {
			throw new Error(`${context}: exactly four scene actions are required`)
		}
		for (const actionId of sceneActions) {
			if (!(actionId in ACTION_REGISTRY)) {
				throw new Error(`${context}: unknown scene action ${actionId}`)
			}
			const action = ACTION_REGISTRY[actionId as LobsterActionId]
			if (
				action.capability &&
				capabilityValues.get(action.capability) !== true
			) {
				throw new Error(
					`${context}: scene action ${actionId} lacks exact capability evidence`
				)
			}
		}
		if (
			!sceneActions.some(
				(actionId) =>
					ACTION_REGISTRY[actionId as LobsterActionId].kind === "morphology"
			)
		) {
			throw new Error(`${context}: an evidence-driven morphology scene is required`)
		}
		const supportedPhysicalActions = Object.entries(ACTION_REGISTRY).filter(
			([, action]) =>
				action.kind === "physical" &&
				action.capability !== null &&
				capabilityValues.get(action.capability) === true
		)
		if (
			supportedPhysicalActions.length > 0 &&
			!sceneActions.some(
				(actionId) =>
					ACTION_REGISTRY[actionId as LobsterActionId].kind === "physical"
			)
		) {
			throw new Error(`${context}: a supported physical scene is required`)
		}
		if (
			sceneActions.filter(
				(actionId) =>
					ACTION_REGISTRY[actionId as LobsterActionId].returnSafe
			).length < 2
		) {
			throw new Error(`${context}: at least two return-safe scenes are required`)
		}
		return family
	})
	requireUnique(profileFamilies, "familyEvidenceProfiles")

	const actions = requireObject(config.actions, "actions")
	requireExactKeys(actions, ["fallback", "morphology", "physical"], "actions")
	const fallback = requireStringArray(actions.fallback, "actions.fallback")
	const morphology = requireStringArray(actions.morphology, "actions.morphology")
	const physical = requireStringArray(actions.physical, "actions.physical")
	requireUnique(fallback, "actions.fallback")
	requireUnique(morphology, "actions.morphology")
	requireUnique(physical, "actions.physical")
	const allActionIds = Object.keys(ACTION_REGISTRY)
	for (const id of [...fallback, ...morphology, ...physical]) {
		if (!allActionIds.includes(id)) throw new Error(`unknown action ${id}`)
	}
	for (const [ids, kind] of [
		[fallback, "fallback"],
		[morphology, "morphology"],
		[physical, "physical"]
	] as const) {
		if (
			ids.some(
				(id) => ACTION_REGISTRY[id as LobsterActionId]?.kind !== kind
			)
		) {
			throw new Error(`${kind} action registry contains a mismatched action`)
		}
	}
	const configuredActions = [...fallback, ...morphology, ...physical]
	if (
		new Set(configuredActions).size !== allActionIds.length ||
		configuredActions.some((id) => !allActionIds.includes(id))
	) {
		throw new Error("source action lists must cover the action registry exactly")
	}

	const scenes = requireObject(config.scenes, "scenes")
	requireExactKeys(
		scenes,
		[
			"mediums",
			"environments",
			"eras",
			"cameraPositions",
			"lensLanguages",
			"compositions",
			"lighting",
			"palettes",
			"tones",
			"castPatterns",
			"promptVersion",
			"humanReviewStatus",
			"automatedReviewStatus"
		],
		"scenes"
	)
	validateRegistry(
		scenes.mediums,
		"scenes.mediums",
		["id", "kind"],
		(entry, context) => {
		requireEnum(
			entry.kind,
			["photorealistic", "non-photorealistic"] as const,
			`${context}.kind`
		)
		}
	)
	validateRegistry(
		scenes.environments,
		"scenes.environments",
		[
			"id",
			"family",
			"isOfficeBoardroomOrHearing",
			"hasConventionalModernWorkplace"
		],
		(entry, context) => {
			requireString(entry.family, `${context}.family`)
			requireBoolean(
				entry.isOfficeBoardroomOrHearing,
				`${context}.isOfficeBoardroomOrHearing`
			)
			requireBoolean(
				entry.hasConventionalModernWorkplace,
				`${context}.hasConventionalModernWorkplace`
			)
		}
	)
	const environmentFamilies = new Set(
		requireArray(scenes.environments, "scenes.environments").map(
			(entry, index) =>
				requireString(
					requireObject(entry, `scenes.environments[${index}]`).family,
					`scenes.environments[${index}].family`
				)
		)
	)
	if (environmentFamilies.size > 12 || environmentFamilies.size < 10) {
		throw new Error("environment registry must use 10 to 12 broad families")
	}
	for (const field of [
		"eras",
		"cameraPositions",
		"lensLanguages",
		"compositions",
		"lighting",
		"palettes",
		"tones"
	] as const) {
		validateRegistry(scenes[field], `scenes.${field}`, ["id"])
	}
	const casts = requireArray(scenes.castPatterns, "scenes.castPatterns")
	casts.forEach((cast, index) =>
		validateCastPattern(cast, `scenes.castPatterns[${index}]`)
	)
	requireUnique(
		casts.map((cast, index) =>
			requireString(
				requireObject(cast, `scenes.castPatterns[${index}]`).id,
				`scenes.castPatterns[${index}].id`
			)
		),
		"scenes.castPatterns"
	)
	if (casts.length < 21) {
		throw new Error("at least 21 cast patterns are required for the 5% quota")
	}
	requireLiteral(scenes.promptVersion, "lob-v1", "scenes.promptVersion")
	requireLiteral(
		scenes.humanReviewStatus,
		"not-reviewed",
		"scenes.humanReviewStatus"
	)
	requireLiteral(
		scenes.automatedReviewStatus,
		"validated",
		"scenes.automatedReviewStatus"
	)
	validateOutput(config.output, "output")
	const policySha256 = sha256(serializeJson(value))
	if (policySha256 !== LOBSTER_METADATA_SOURCE_POLICY_SHA256) {
		throw new Error(
			"metadata source config does not match canonical policy checksum; " +
				"an intentional policy update must update " +
				"LOBSTER_METADATA_SOURCE_POLICY_SHA256"
		)
	}

	return value as LobsterMetadataSourceConfig
}

const capabilityValue = (
	record: LobsterMetadataRecord,
	name: LobsterCapabilityName
) => record.capabilities[name].value

export const validateActionPermission = (
	record: LobsterMetadataRecord,
	actionId: LobsterActionId
) => {
	const action = ACTION_REGISTRY[actionId]
	if (!action) throw new Error(`unknown action ${actionId}`)
	if (action.capability && capabilityValue(record, action.capability) !== true) {
		throw new Error(
			`AphiaID ${record.AphiaID}: action ${actionId} requires capability ` +
				`${action.capability} exactly true`
		)
	}
}

const validateEvidenceValue = (
	value: unknown,
	context: string,
	citationIds: Set<string>,
	arrayValue = false
) => {
	const evidence = requireObject(value, context)
	const status = requireEnum(
		evidence.status,
		["known", "unknown"] as const,
		`${context}.status`
	)
	requireString(evidence.evidenceScope, `${context}.evidenceScope`)
	const ids = requireStringArray(evidence.citationIds, `${context}.citationIds`)
	for (const id of ids) {
		if (!citationIds.has(id)) throw new Error(`${context}: unknown citation ${id}`)
	}
	if (status === "unknown") {
		if (evidence.value !== null) {
			throw new Error(`${context}: unknown evidence must have a null value`)
		}
		if (ids.length !== 0) {
			throw new Error(`${context}: unknown evidence cannot cite known claims`)
		}
	} else {
		if (arrayValue) {
			if (requireStringArray(evidence.value, `${context}.value`).length === 0) {
				throw new Error(`${context}: known evidence must have values`)
			}
		} else {
			requireString(evidence.value, `${context}.value`)
		}
		if (ids.length === 0) {
			throw new Error(`${context}: known evidence requires a citation`)
		}
	}
}

const validateCapability = (
	value: unknown,
	context: string,
	citationClaims: Map<string, Set<string>>,
	exactClaimBindings: Set<string>,
	family: string,
	capabilityName: LobsterCapabilityName
) => {
	const capability = requireObject(value, context)
	requireExactKeys(
		capability,
		["value", "evidenceScope", "citationIds", "supportedClaims"],
		context
	)
	if (
		capability.value !== true &&
		capability.value !== false &&
		capability.value !== "unknown"
	) {
		throw new Error(`${context}.value has invalid capability value`)
	}
	requireString(capability.evidenceScope, `${context}.evidenceScope`)
	const ids = requireStringArray(
		capability.citationIds,
		`${context}.citationIds`
	)
	const claims = requireStringArray(
		capability.supportedClaims,
		`${context}.supportedClaims`
	)
	requireUnique(ids, `${context}.citationIds`)
	requireUnique(claims, `${context}.supportedClaims`)
	for (const id of ids) {
		if (!citationClaims.has(id)) {
			throw new Error(`${context}: unknown citation ${id}`)
		}
	}
	if (
		capability.value === "unknown" &&
		(ids.length !== 0 || claims.length !== 0)
	) {
		throw new Error(`${context}: unknown capability cannot cite support`)
	}
	if (
		capability.value !== "unknown" &&
		(ids.length === 0 || claims.length === 0)
	) {
		throw new Error(`${context}: known capability requires citation claims`)
	}
	for (const claim of claims) {
		if (
			!ids.some((id) =>
				exactClaimBindings.has(
					[
						family,
						capabilityName,
						String(capability.value),
						id,
						claim
					].join("\u0000")
				)
			)
		) {
			throw new Error(`${context}: unsupported exact claim binding ${claim}`)
		}
	}
	for (const id of ids) {
		if (
			!claims.some((claim) =>
				exactClaimBindings.has(
					[
						family,
						capabilityName,
						String(capability.value),
						id,
						claim
					].join("\u0000")
				)
			)
		) {
			throw new Error(`${context}: citation has no exact capability claim binding`)
		}
	}
}

const registryMap = <T extends { id: string }>(entries: T[]) =>
	new Map(entries.map((entry) => [entry.id, entry]))

const castsEqual = (left: CastPattern, right: CastPattern) =>
	JSON.stringify(left) === JSON.stringify(right)

const validateSceneSemantics = (
	scene: LobsterScenePlan,
	config: LobsterMetadataSourceConfig
) => {
	const medium = registryMap(config.scenes.mediums).get(scene.medium)
	if (!medium) throw new Error(`${scene.id}: unknown medium ${scene.medium}`)
	if (scene.mediumKind !== medium.kind) {
		throw new Error(`${scene.id}: mismatched medium kind`)
	}
	const environment = registryMap(config.scenes.environments).get(
		scene.environment
	)
	if (!environment) {
		throw new Error(`${scene.id}: unknown environment ${scene.environment}`)
	}
	if (scene.environmentFamily !== environment.family) {
		throw new Error(`${scene.id}: mismatched environment family`)
	}
	const cast = registryMap(config.scenes.castPatterns).get(scene.cast.id)
	if (!cast) throw new Error(`${scene.id}: unknown cast pattern ${scene.cast.id}`)
	if (!castsEqual(scene.cast, cast)) {
		throw new Error(`${scene.id}: mismatched structured cast`)
	}
	const registryChecks: Array<[string, Array<{ id: string }>, string]> = [
		[scene.era, config.scenes.eras, "era"],
		[scene.camera.position, config.scenes.cameraPositions, "camera position"],
		[scene.camera.lensLanguage, config.scenes.lensLanguages, "lens language"],
		[scene.composition, config.scenes.compositions, "composition"],
		[scene.lighting, config.scenes.lighting, "lighting"],
		[scene.palette, config.scenes.palettes, "palette"],
		[scene.tone, config.scenes.tones, "tone"]
	]
	for (const [id, registry, label] of registryChecks) {
		if (!registry.some((entry) => entry.id === id)) {
			throw new Error(`${scene.id}: unknown ${label} ${id}`)
		}
	}
	const expectedFamilyId = `${environment.family}:${scene.action}:${medium.kind}`
	if (scene.sceneFamilyId !== expectedFamilyId) {
		throw new Error(`${scene.id}: mismatched scene family ID`)
	}
	return { medium, environment, cast }
}

export const validateLobsterMetadataRecord = (
	record: LobsterMetadataRecord,
	config: LobsterMetadataSourceConfig
) => {
	requireInteger(record.AphiaID, "AphiaID")
	requireString(record.scientificName, "scientificName")
	requireString(record.displayName, "displayName")
	requireString(record.family, "family")

	if (!Array.isArray(record.scientificCitations) || record.scientificCitations.length < 2) {
		throw new Error(`AphiaID ${record.AphiaID}: scientific citations required`)
	}
	const citationIds = new Set<string>()
	const citationClaims = new Map<string, Set<string>>()
	const exactClaimBindings = new Set(
		config.capabilityClaimBindings.map((binding) =>
			[
				binding.family,
				binding.capability,
				String(binding.value),
				binding.citationId,
				binding.claim
			].join("\u0000")
		)
	)
	for (const [index, citation] of record.scientificCitations.entries()) {
		validateCitationShape(citation, `scientificCitations[${index}]`)
		requireEnum(
			citation.scope,
			[
				"record-taxonomy",
				"dataset-taxonomy",
				"family-anatomy",
				"family-behavior",
				"species-behavior"
			] as const,
			`scientificCitations[${index}].scope`
		)
		if (citationIds.has(citation.id)) {
			throw new Error(`AphiaID ${record.AphiaID}: duplicate citation ${citation.id}`)
		}
		citationIds.add(citation.id)
		citationClaims.set(citation.id, new Set(citation.supportedClaims))
	}
	if (!citationIds.has("worms-record") || !citationIds.has("worms-dataset")) {
		throw new Error(`AphiaID ${record.AphiaID}: WoRMS citations required`)
	}

	validateEvidenceValue(record.broadBodyPlan, "broadBodyPlan", citationIds)
	validateEvidenceValue(record.anatomyFacts, "anatomyFacts", citationIds, true)
	validateEvidenceValue(record.habitat, "habitat", citationIds)
	validateEvidenceValue(record.depthBand, "depthBand", citationIds)
	validateEvidenceValue(record.geographicRegion, "geographicRegion", citationIds)

	for (const capabilityName of LOBSTER_CAPABILITY_NAMES) {
		validateCapability(
			record.capabilities?.[capabilityName],
			`capabilities.${capabilityName}`,
			citationClaims,
			exactClaimBindings,
			record.family,
			capabilityName
		)
	}

	const permittedEntries = requireArray(
		record.permittedActions,
		"permittedActions"
	)
	const prohibitedEntries = requireArray(
		record.prohibitedActions,
		"prohibitedActions"
	)
	const readActions = (entries: unknown[], context: string) =>
		entries.map((entry, index) => {
			const object = requireObject(entry, `${context}[${index}]`)
			const id = requireString(object.id, `${context}[${index}].id`)
			if (!(id in ACTION_REGISTRY)) throw new Error(`unknown action ${id}`)
			requireString(object.reason, `${context}[${index}].reason`)
			return id as LobsterActionId
		})
	const permittedIds = readActions(permittedEntries, "permittedActions")
	const prohibitedIds = readActions(prohibitedEntries, "prohibitedActions")
	requireUnique(permittedIds, "permittedActions")
	requireUnique(prohibitedIds, "prohibitedActions")
	const permitted = new Set(permittedIds)
	const prohibited = new Set(prohibitedIds)
	for (const actionId of Object.keys(ACTION_REGISTRY) as LobsterActionId[]) {
		const coverage =
			Number(permitted.has(actionId)) + Number(prohibited.has(actionId))
		if (coverage !== 1) {
			throw new Error(
				`AphiaID ${record.AphiaID}: action ${actionId} must be covered exactly once`
			)
		}
		if (permitted.has(actionId)) validateActionPermission(record, actionId)
	}

	const vocabulary = requireObject(
		record.narrativeVocabulary,
		"narrativeVocabulary"
	)
	if (
		!requireStringArray(
			vocabulary.subjectTerms,
			"narrativeVocabulary.subjectTerms"
		).includes(record.scientificName)
	) {
		throw new Error("narrative vocabulary must include scientific name")
	}
	requireStringArray(vocabulary.safeVerbs, "narrativeVocabulary.safeVerbs")
	const narrativePolicy = requireObject(
		vocabulary.evidencePolicy,
		"narrativeVocabulary.evidencePolicy"
	)
	requireExactKeys(
		narrativePolicy,
		[
			"citedFamilyAnatomyAllowed",
			"actionsLimitedToPermittedSet",
			"unsupportedBehaviorProhibited"
		],
		"narrativeVocabulary.evidencePolicy"
	)
	requireLiteral(
		narrativePolicy.citedFamilyAnatomyAllowed,
		true,
		"narrativeVocabulary.evidencePolicy.citedFamilyAnatomyAllowed"
	)
	requireLiteral(
		narrativePolicy.actionsLimitedToPermittedSet,
		true,
		"narrativeVocabulary.evidencePolicy.actionsLimitedToPermittedSet"
	)
	requireLiteral(
		narrativePolicy.unsupportedBehaviorProhibited,
		true,
		"narrativeVocabulary.evidencePolicy.unsupportedBehaviorProhibited"
	)
	const accessibility = requireObject(record.accessibility, "accessibility")
	requireString(accessibility.subjectFragment, "accessibility.subjectFragment")
	const taxonomyFragment = requireString(
		accessibility.taxonomyFragment,
		"accessibility.taxonomyFragment"
	)
	if (!taxonomyFragment.includes(record.family)) {
		throw new Error("accessibility taxonomy must name the family")
	}
	requireString(
		accessibility.actionEvidenceFragment,
		"accessibility.actionEvidenceFragment"
	)

	if (!Array.isArray(record.scenePlans) || record.scenePlans.length !== 4) {
		throw new Error(`AphiaID ${record.AphiaID}: exactly four scenes required`)
	}
	const expectedIds = [1, 2, 3, 4].map(
		(index) => `lob-v1-a${record.AphiaID}-s${String(index).padStart(2, "0")}`
	)
	if (record.scenePlans.map(({ id }) => id).join("|") !== expectedIds.join("|")) {
		throw new Error(`AphiaID ${record.AphiaID}: scene IDs are not stable`)
	}
	for (const scene of record.scenePlans) {
		requireString(scene.id, "scene.id")
		if (!(scene.action in ACTION_REGISTRY)) {
			throw new Error(`${scene.id}: unknown action ${String(scene.action)}`)
		}
		if (!permitted.has(scene.action) || prohibited.has(scene.action)) {
			throw new Error(
				`AphiaID ${record.AphiaID}: scene ${scene.id} uses disallowed action`
			)
		}
		validateActionPermission(record, scene.action)
		validateSceneSemantics(scene, config)
		requireLiteral(scene.promptVersion, "lob-v1", `${scene.id}.promptVersion`)
		requireEnum(
			scene.humanReviewStatus,
			["not-reviewed", "approved", "rejected"] as const,
			`${scene.id}.humanReviewStatus`
		)
		requireEnum(
			scene.automatedReviewStatus,
			["validated", "failed"] as const,
			`${scene.id}.automatedReviewStatus`
		)
		requireString(scene.headline, `${scene.id}.headline`)
		const altText = requireString(scene.altText, `${scene.id}.altText`)
		if (
			!altText.includes(record.scientificName) ||
			!altText.includes(scene.environment)
		) {
			throw new Error(`${scene.id}: alt text lacks subject or environment`)
		}
		validateOutput(scene.output, `${scene.id}.output`)
	}
	if (new Set(record.scenePlans.map((scene) => scene.action)).size !== 4) {
		throw new Error(`AphiaID ${record.AphiaID}: all four scene actions must differ`)
	}
	if (
		record.scenePlans.filter(
			(scene) => ACTION_REGISTRY[scene.action].returnSafe
		).length < 2
	) {
		throw new Error(`AphiaID ${record.AphiaID}: two return-safe scenes required`)
	}
	if (
		!record.scenePlans.some(
			(scene) => ACTION_REGISTRY[scene.action].kind === "morphology"
		)
	) {
		throw new Error(
			`AphiaID ${record.AphiaID}: evidence-driven morphology scene required`
		)
	}
	for (const field of [
		"medium",
		"environmentFamily",
		"composition",
		"tone"
	] as const) {
		if (new Set(record.scenePlans.map((scene) => scene[field])).size !== 4) {
			throw new Error(
				`AphiaID ${record.AphiaID}: all four scenes must differ in ${field}`
			)
		}
	}
}

const sceneHeadline = (action: LobsterActionId, scientificName: string) => {
	switch (action) {
		case "refusal":
			return `${scientificName} stages a clear refusal`
		case "ceremonial-display":
			return `${scientificName} enters a ceremonial display`
		case "editorial-observe":
			return `${scientificName} surveys the scene`
		case "editorial-pose":
			return `${scientificName} holds the editorial frame`
		case "large-chela-stand-off":
			return `${scientificName} stages a non-contact large-chela stand-off`
		case "antenna-stand-off":
			return `${scientificName} stages a non-contact antenna stand-off`
		case "antenna-plate-refusal":
			return `${scientificName} stages a non-contact antenna-plate refusal`
		case "multi-chela-stand-off":
			return `${scientificName} stages a non-contact multi-chela stand-off`
		case "subchelate-stand-off":
			return `${scientificName} stages a non-contact subchelate stand-off`
		case "pinch":
			return `${scientificName} visibly pinches with enlarged first-leg chelae`
		case "antenna-strike":
			return `${scientificName} visibly delivers a defensive antenna strike`
		case "tail-escape":
			return `${scientificName} visibly tail-flips backward to escape`
		case "body-check":
			return `${scientificName} visibly makes forceful body contact`
		case "ambush":
			return `${scientificName} visibly initiates an ambush`
	}
}

const actionDescription = (action: LobsterActionId) => {
	switch (action) {
		case "refusal":
			return "a clear refusal pose without contact"
		case "ceremonial-display":
			return "a ceremonial, non-contact display"
		case "editorial-observe":
			return "an anatomy-neutral observational pose"
		case "editorial-pose":
			return "an anatomy-neutral editorial pose"
		case "large-chela-stand-off":
			return "a staged, non-contact display of enlarged first-leg chelae"
		case "antenna-stand-off":
			return "a staged, non-contact display of enlarged antennae"
		case "antenna-plate-refusal":
			return "a staged, non-contact refusal displaying flattened antenna plates"
		case "multi-chela-stand-off":
			return "a staged, non-contact display of multiple chelate pereopods"
		case "subchelate-stand-off":
			return "a staged, non-contact display of strongly subchelate first legs"
		case "pinch":
			return "a visible pinch closing enlarged first-leg chelae"
		case "antenna-strike":
			return "a visible defensive strike with an enlarged antenna"
		case "tail-escape":
			return "a visible backward tail-flip escape response"
		case "body-check":
			return "visible forceful body contact"
		case "ambush":
			return "visible ambush behavior"
	}
}

const sceneAltText = (
	scientificName: string,
	action: LobsterActionId,
	environment: string,
	medium: string,
	composition: string
) =>
	`${scientificName} in a ${medium} ${composition} scene set in ${environment}; ` +
	`${actionDescription(action)} is shown within the cited family evidence limits.`

const unknownEvidence = <T>(scope: string): EvidenceValue<T> => ({
	value: null,
	status: "unknown",
	evidenceScope: scope,
	citationIds: []
})

const entryAt = <T>(entries: T[], index: number, context: string): T => {
	const entry = entries[index % entries.length]
	if (entry === undefined) throw new Error(`${context} registry is empty`)
	return entry
}

export const buildLobsterMetadataDataset = (
	taxonomyRecords: LobsterTaxonomyInputRecord[],
	configInput: LobsterMetadataSourceConfig
): LobsterMetadataDataset => {
	const config = parseLobsterMetadataSourceConfig(configInput)
	if (
		config.taxonomy.snapshotId !== LOBSTER_METADATA_SNAPSHOT_ID ||
		config.taxonomy.normalizedSha256 !== LOBSTER_TAXONOMY_SHA256
	) {
		throw new Error("metadata source config does not match frozen taxonomy")
	}
	const familyProfiles = new Map(
		config.familyEvidenceProfiles.map((profile) => [profile.family, profile])
	)
	const citationRegistry = new Map(
		config.citationRegistry.map((citation) => [citation.id, citation])
	)
	const environmentsByFamily = new Map<string, EnvironmentRegistryEntry[]>()
	for (const environment of config.scenes.environments) {
		const entries = environmentsByFamily.get(environment.family) ?? []
		entries.push(environment)
		environmentsByFamily.set(environment.family, entries)
	}
	const environmentFamilies = [...environmentsByFamily.keys()].sort()
	const seenAphiaIds = new Set<number>()

	const records = [...taxonomyRecords]
		.sort((left, right) => left.AphiaID - right.AphiaID)
		.map((taxonomy, recordIndex): LobsterMetadataRecord => {
			if (
				!Number.isInteger(taxonomy.AphiaID) ||
				typeof taxonomy.scientificName !== "string" ||
				typeof taxonomy.family !== "string" ||
				!isObject(taxonomy.source)
			) {
				throw new Error("malformed taxonomy record")
			}
			if (seenAphiaIds.has(taxonomy.AphiaID)) {
				throw new Error(`duplicate taxonomy AphiaID ${taxonomy.AphiaID}`)
			}
			seenAphiaIds.add(taxonomy.AphiaID)

			const profile = familyProfiles.get(taxonomy.family)
			if (!profile) {
				throw new Error(`no approved family evidence profile for ${taxonomy.family}`)
			}
			const familyCitations = (profile?.citationIds ?? []).map((id) => {
				const citation = citationRegistry.get(id)
				if (!citation) throw new Error(`unknown family citation ${id}`)
				return structuredClone(citation)
			})
			const capabilities = Object.fromEntries(
				profile.capabilityEvidence.map(
					({ capability, ...evidence }) => [
						capability,
						structuredClone(evidence)
					]
				)
			) as LobsterMetadataRecord["capabilities"]

			const scenePlans = profile.sceneActions.map((action, sceneIndex) => {
				const medium = entryAt(
					config.scenes.mediums,
					(recordIndex % config.scenes.mediums.length) + sceneIndex * 4,
					"medium"
				)
				const family = entryAt(
					environmentFamilies,
					recordIndex + sceneIndex * 3,
					"environment family"
				)
				const familyEnvironments = environmentsByFamily.get(family)!
				const environment = entryAt(
					familyEnvironments,
					Math.floor(recordIndex / environmentFamilies.length) + sceneIndex,
					"environment"
				)
				const era = entryAt(
					config.scenes.eras,
					Math.floor(recordIndex / config.scenes.mediums.length) +
						sceneIndex * 5,
					"era"
				)
				const composition = entryAt(
					config.scenes.compositions,
					recordIndex + sceneIndex * 5,
					"composition"
				)
				const tone = entryAt(
					config.scenes.tones,
					recordIndex + sceneIndex * 3,
					"tone"
				)
				const cast = entryAt(
					config.scenes.castPatterns,
					recordIndex * 4 + sceneIndex,
					"cast"
				)
				const cameraPosition = entryAt(
					config.scenes.cameraPositions,
					recordIndex * 3 + sceneIndex * 5,
					"camera position"
				)
				const lens = entryAt(
					config.scenes.lensLanguages,
					recordIndex * 5 + sceneIndex * 7,
					"lens language"
				)
				const lighting = entryAt(
					config.scenes.lighting,
					recordIndex * 7 + sceneIndex * 3,
					"lighting"
				)
				const palette = entryAt(
					config.scenes.palettes,
					recordIndex * 11 + sceneIndex * 5,
					"palette"
				)
				const sceneNumber = String(sceneIndex + 1).padStart(2, "0")
				return {
					id: `lob-v1-a${taxonomy.AphiaID}-s${sceneNumber}`,
					action,
					environment: environment.id,
					environmentFamily: environment.family,
					era: era.id,
					medium: medium.id,
					mediumKind: medium.kind,
					tone: tone.id,
					cast: structuredClone(cast),
					camera: {
						position: cameraPosition.id,
						lensLanguage: lens.id
					},
					composition: composition.id,
					lighting: lighting.id,
					palette: palette.id,
					sceneFamilyId: `${environment.family}:${action}:${medium.kind}`,
					promptVersion: config.scenes.promptVersion,
					humanReviewStatus: config.scenes.humanReviewStatus,
					automatedReviewStatus: config.scenes.automatedReviewStatus,
					headline: sceneHeadline(action, taxonomy.scientificName),
					altText: sceneAltText(
						taxonomy.scientificName,
						action,
						environment.id,
						medium.id,
						composition.id
					),
					output: structuredClone(config.output)
				}
			}) as LobsterMetadataRecord["scenePlans"]

			const profileScope =
				`Family-level default for ${taxonomy.family}; this is not a ` +
				"species-specific determination."
			const permittedActionIds = (
				Object.keys(ACTION_REGISTRY) as LobsterActionId[]
			).filter((actionId) => {
				const capability = ACTION_REGISTRY[actionId].capability
				return capability === null || capabilities[capability].value === true
			})
			const prohibitedActionIds = (
				Object.keys(ACTION_REGISTRY) as LobsterActionId[]
			).filter((actionId) => !permittedActionIds.includes(actionId))
			const record: LobsterMetadataRecord = {
				AphiaID: taxonomy.AphiaID,
				scientificName: taxonomy.scientificName,
				displayName: taxonomy.scientificName,
				family: taxonomy.family,
				broadBodyPlan: {
					value: profile.broadBodyPlan,
					status: "known",
					evidenceScope: profileScope,
					citationIds: [...profile.bodyPlanCitationIds]
				},
				anatomyFacts: {
					value: [...profile.anatomyFacts],
					status: "known",
					evidenceScope: profileScope,
					citationIds: [...profile.bodyPlanCitationIds]
				},
				habitat: {
					value: "marine",
					status: "known",
					evidenceScope:
						"Record-level WoRMS selection evidence states isMarine=1.",
					citationIds: ["worms-record"]
				},
				depthBand: unknownEvidence(
					"No committed record-specific depth source is bundled."
				),
				geographicRegion: unknownEvidence(
					"No committed record-specific geographic source is bundled."
				),
				capabilities,
				permittedActions: permittedActionIds.map((id) => ({
					id,
					reason: ACTION_REGISTRY[id].capability
						? `Permitted by exact true capability evidence for ${ACTION_REGISTRY[id].capability}.`
						: "Universally safe refusal, ceremonial, or editorial fallback."
				})),
				prohibitedActions: prohibitedActionIds.map((id) => ({
					id,
					reason:
						`Fails closed because ${ACTION_REGISTRY[id].capability ?? "the required capability"} ` +
						"is not exactly true in committed evidence."
				})),
				narrativeVocabulary: {
					subjectTerms: [
						taxonomy.scientificName,
						`${taxonomy.family} family taxon`,
						"marine lobster subject"
					],
					safeVerbs: permittedActionIds.map((id) => id.replaceAll("-", " ")),
					evidencePolicy: {
						citedFamilyAnatomyAllowed: true,
						actionsLimitedToPermittedSet: true,
						unsupportedBehaviorProhibited: true
					}
				},
				accessibility: {
					subjectFragment: `${taxonomy.scientificName}, displayed under its scientific name`,
					taxonomyFragment: `an accepted marine species in family ${taxonomy.family}`,
					actionEvidenceFragment:
						`permitted actions are limited to ${permittedActionIds.join(", ")} ` +
						"under cited family-level evidence"
				},
				scientificCitations: [
					{
						id: "worms-record",
						scope: "record-taxonomy",
						title: `WoRMS taxon record for ${taxonomy.scientificName}`,
						authors: "DecaNet editors",
						provider: "World Register of Marine Species",
						publicationYear: 2026,
						url: taxonomy.source.url,
						citation: taxonomy.source.citation,
						supportedClaims: [
							"accepted scientific identity",
							"family membership",
							"marine status"
						]
					},
					{ ...config.taxonomy.datasetCitation, scope: "dataset-taxonomy" },
					...familyCitations
				],
				scenePlans
			}
			validateLobsterMetadataRecord(record, config)
			return record
		})

	return {
		schemaVersion: LOBSTER_METADATA_SCHEMA_VERSION,
		taxonomySnapshotId: LOBSTER_METADATA_SNAPSHOT_ID,
		taxonomySha256: LOBSTER_TAXONOMY_SHA256,
		records
	}
}

export type LobsterSceneQuotaReport = {
	totalScenes: number
	mediumMax: { id: string; count: number; share: number }
	environmentFamilyMax: { id: string; count: number; share: number }
	officeBoardroomOrHearing: { count: number; share: number }
	castPatternMax: { id: string; count: number; share: number }
	humanScenes: number
	prominentAdultWomanHumanScenes: { count: number; share: number }
	nonPhotorealistic: { count: number; share: number }
	noConventionalModernWorkplace: { count: number; share: number }
}

const maxBucket = (values: string[], total: number) => {
	const counts = new Map<string, number>()
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	const [id, count] = [...counts.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
	)[0] ?? ["none", 0]
	return { id, count, share: total === 0 ? 0 : count / total }
}

export const computeSceneQuotaReport = (
	dataset: LobsterMetadataDataset,
	config: LobsterMetadataSourceConfig
): LobsterSceneQuotaReport => {
	const scenes = dataset.records.flatMap((record) => record.scenePlans)
	const totalScenes = scenes.length
	const resolved = scenes.map((scene) => ({
		scene,
		...validateSceneSemantics(scene, config)
	}))
	const humanScenes = resolved.filter(({ cast }) => cast.kind === "human")
	const countShare = (count: number, total = totalScenes) => ({
		count,
		share: total === 0 ? 0 : count / total
	})
	return {
		totalScenes,
		mediumMax: maxBucket(
			resolved.map(({ medium }) => medium.id),
			totalScenes
		),
		environmentFamilyMax: maxBucket(
			resolved.map(({ environment }) => environment.family),
			totalScenes
		),
		officeBoardroomOrHearing: countShare(
			resolved.filter(
				({ environment }) => environment.isOfficeBoardroomOrHearing
			).length
		),
		castPatternMax: maxBucket(
			resolved.map(({ cast }) => cast.id),
			totalScenes
		),
		humanScenes: humanScenes.length,
		prominentAdultWomanHumanScenes: countShare(
			humanScenes.filter(({ cast }) =>
				cast.adults.some(
					(adult) =>
						adult.adultStatus === "adult" &&
						adult.genderPresentation === "woman" &&
						adult.prominence === "prominent"
				)
			).length,
			humanScenes.length
		),
		nonPhotorealistic: countShare(
			resolved.filter(
				({ medium }) => medium.kind === "non-photorealistic"
			).length
		),
		noConventionalModernWorkplace: countShare(
			resolved.filter(
				({ environment }) => !environment.hasConventionalModernWorkplace
			).length
		)
	}
}

export const validateSceneQuotas = (report: LobsterSceneQuotaReport) => {
	if (report.mediumMax.share > 0.15) {
		throw new Error("medium quota exceeds 15%")
	}
	if (report.environmentFamilyMax.share >= 0.1) {
		throw new Error("environment-family quota must remain below 10%")
	}
	if (report.officeBoardroomOrHearing.share >= 0.03) {
		throw new Error("office/boardroom/hearing quota must remain below 3%")
	}
	if (report.castPatternMax.share > 0.05) {
		throw new Error("cast-pattern quota exceeds 5%")
	}
	if (report.prominentAdultWomanHumanScenes.share < 0.5) {
		throw new Error("adult-woman human-scene quota is below 50%")
	}
	if (report.nonPhotorealistic.share < 0.2) {
		throw new Error("non-photorealistic quota is below 20%")
	}
	if (report.noConventionalModernWorkplace.share < 0.15) {
		throw new Error("no-modern-workplace quota is below 15%")
	}
}

const substantiveSceneTuple = (scene: LobsterScenePlan) =>
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

export const validateLobsterMetadataDataset = (
	dataset: LobsterMetadataDataset,
	taxonomyRecords: LobsterTaxonomyInputRecord[],
	config: LobsterMetadataSourceConfig
) => {
	if (dataset.schemaVersion !== LOBSTER_METADATA_SCHEMA_VERSION) {
		throw new Error("metadata dataset schema version is invalid")
	}
	if (
		dataset.taxonomySnapshotId !== LOBSTER_METADATA_SNAPSHOT_ID ||
		dataset.taxonomySha256 !== LOBSTER_TAXONOMY_SHA256
	) {
		throw new Error("metadata dataset taxonomy binding is invalid")
	}
	if (!Array.isArray(dataset.records)) {
		throw new Error("metadata records must be an array")
	}
	const expectedAphiaIds = [...taxonomyRecords]
		.sort((left, right) => left.AphiaID - right.AphiaID)
		.map((record) => record.AphiaID)
	if (dataset.records.length !== expectedAphiaIds.length) {
		throw new Error("metadata record count does not match frozen taxonomy")
	}
	const actualAphiaIds = dataset.records.map((record) => record.AphiaID)
	if (actualAphiaIds.join(",") !== expectedAphiaIds.join(",")) {
		throw new Error("metadata AphiaID coverage or ordering mismatch")
	}
	const sceneIds = new Set<string>()
	for (const record of dataset.records) {
		if (!Array.isArray(record.scenePlans)) continue
		for (const scene of record.scenePlans) {
			if (sceneIds.has(scene.id)) throw new Error(`duplicate scene ID ${scene.id}`)
			sceneIds.add(scene.id)
		}
	}
	const sceneTuples = new Set<string>()
	for (const record of dataset.records) {
		validateLobsterMetadataRecord(record, config)
		for (const scene of record.scenePlans) {
			const tuple = substantiveSceneTuple(scene)
			if (sceneTuples.has(tuple)) {
				throw new Error(`duplicate substantive scene tuple ${scene.id}`)
			}
			sceneTuples.add(tuple)
		}
	}
	validateSceneQuotas(computeSceneQuotaReport(dataset, config))
	const canonicalDataset = buildLobsterMetadataDataset(taxonomyRecords, config)
	if (JSON.stringify(dataset) !== JSON.stringify(canonicalDataset)) {
		throw new Error(
			"metadata dataset does not exactly match canonical taxonomy/config semantics"
		)
	}
}

const validateDatasetObjectKeys = (
	dataset: Record<string, unknown>,
	records: unknown[]
) => {
	for (const [recordIndex, recordValue] of records.entries()) {
		const context = `lobster metadata dataset.records[${recordIndex}]`
		const record = requireObject(recordValue, context)
		requireExactKeys(
			record,
			[
				"AphiaID",
				"scientificName",
				"displayName",
				"family",
				"broadBodyPlan",
				"anatomyFacts",
				"habitat",
				"depthBand",
				"geographicRegion",
				"capabilities",
				"permittedActions",
				"prohibitedActions",
				"narrativeVocabulary",
				"accessibility",
				"scientificCitations",
				"scenePlans"
			],
			context
		)
		for (const field of [
			"broadBodyPlan",
			"anatomyFacts",
			"habitat",
			"depthBand",
			"geographicRegion"
		] as const) {
			requireExactKeys(
				requireObject(record[field], `${context}.${field}`),
				["value", "status", "evidenceScope", "citationIds"],
				`${context}.${field}`
			)
		}
		const capabilities = requireObject(
			record.capabilities,
			`${context}.capabilities`
		)
		requireExactKeys(
			capabilities,
			LOBSTER_CAPABILITY_NAMES,
			`${context}.capabilities`
		)
		for (const capabilityName of LOBSTER_CAPABILITY_NAMES) {
			const capabilityContext = `${context}.capabilities.${capabilityName}`
			requireExactKeys(
				requireObject(capabilities[capabilityName], capabilityContext),
				["value", "evidenceScope", "citationIds", "supportedClaims"],
				capabilityContext
			)
		}
		for (const actionField of [
			"permittedActions",
			"prohibitedActions"
		] as const) {
			const actions = requireArray(record[actionField], `${context}.${actionField}`)
			for (const [actionIndex, actionValue] of actions.entries()) {
				const actionContext = `${context}.${actionField}[${actionIndex}]`
				requireExactKeys(
					requireObject(actionValue, actionContext),
					["id", "reason"],
					actionContext
				)
			}
		}
		requireExactKeys(
			requireObject(
				record.narrativeVocabulary,
				`${context}.narrativeVocabulary`
			),
			["subjectTerms", "safeVerbs", "evidencePolicy"],
			`${context}.narrativeVocabulary`
		)
		requireExactKeys(
			requireObject(
				requireObject(
					record.narrativeVocabulary,
					`${context}.narrativeVocabulary`
				).evidencePolicy,
				`${context}.narrativeVocabulary.evidencePolicy`
			),
			[
				"citedFamilyAnatomyAllowed",
				"actionsLimitedToPermittedSet",
				"unsupportedBehaviorProhibited"
			],
			`${context}.narrativeVocabulary.evidencePolicy`
		)
		requireExactKeys(
			requireObject(record.accessibility, `${context}.accessibility`),
			["subjectFragment", "taxonomyFragment", "actionEvidenceFragment"],
			`${context}.accessibility`
		)
		const citations = requireArray(
			record.scientificCitations,
			`${context}.scientificCitations`
		)
		for (const [citationIndex, citation] of citations.entries()) {
			validateCitationShape(
				citation,
				`${context}.scientificCitations[${citationIndex}]`
			)
		}
		const scenes = requireArray(record.scenePlans, `${context}.scenePlans`)
		for (const [sceneIndex, sceneValue] of scenes.entries()) {
			const sceneContext = `${context}.scenePlans[${sceneIndex}]`
			const scene = requireObject(sceneValue, sceneContext)
			requireExactKeys(
				scene,
				[
					"id",
					"action",
					"environment",
					"environmentFamily",
					"era",
					"medium",
					"mediumKind",
					"tone",
					"cast",
					"camera",
					"composition",
					"lighting",
					"palette",
					"sceneFamilyId",
					"promptVersion",
					"humanReviewStatus",
					"automatedReviewStatus",
					"headline",
					"altText",
					"output"
				],
				sceneContext
			)
			validateCastPattern(scene.cast, `${sceneContext}.cast`)
			requireExactKeys(
				requireObject(scene.camera, `${sceneContext}.camera`),
				["position", "lensLanguage"],
				`${sceneContext}.camera`
			)
			validateOutput(scene.output, `${sceneContext}.output`)
		}
	}
}

export const parseLobsterMetadataDataset = (
	value: unknown,
	taxonomyRecords: LobsterTaxonomyInputRecord[],
	config: LobsterMetadataSourceConfig
): LobsterMetadataDataset => {
	const dataset = requireObject(value, "lobster metadata dataset")
	requireExactKeys(
		dataset,
		["schemaVersion", "taxonomySnapshotId", "taxonomySha256", "records"],
		"lobster metadata dataset"
	)
	const records = requireArray(
		dataset.records,
		"lobster metadata dataset.records"
	)
	validateDatasetObjectKeys(dataset, records)
	const typed = value as LobsterMetadataDataset
	validateLobsterMetadataDataset(typed, taxonomyRecords, config)
	return typed
}

export const deepFreeze = <T>(value: T): T => {
	if (
		(typeof value !== "object" && typeof value !== "function") ||
		value === null ||
		Object.isFrozen(value)
	) {
		return value
	}
	for (const key of Reflect.ownKeys(value)) {
		deepFreeze((value as Record<PropertyKey, unknown>)[key])
	}
	return Object.freeze(value)
}

export const sha256 = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex")

export const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`
