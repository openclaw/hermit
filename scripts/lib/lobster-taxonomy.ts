import { createHash } from "node:crypto"

export const LOBSTER_TAXONOMY_SNAPSHOT = {
	id: "worms-2026-07-17T060825613Z",
	retrievedAtUtc: "2026-07-17T06:08:25.613Z",
	accessedDate: "2026-07-17"
} as const

export const WORMS_CITATION =
	"WoRMS Editorial Board (2026). World Register of Marine Species. Available from https://www.marinespecies.org at VLIZ. Accessed 2026-07-17. doi:10.14284/170."

export const FAMILY_SCOPE = [
	{ family: "Nephropidae", AphiaID: 106741, speciesCount: 60 },
	{ family: "Enoplometopidae", AphiaID: 106740, speciesCount: 11 },
	{ family: "Glypheidae", AphiaID: 382823, speciesCount: 2 },
	{ family: "Palinuridae", AphiaID: 106794, speciesCount: 61 },
	{ family: "Scyllaridae", AphiaID: 106795, speciesCount: 92 },
	{ family: "Polychelidae", AphiaID: 106793, speciesCount: 38 }
] as const

export type LobsterFamily = typeof FAMILY_SCOPE[number]["family"]

export const SOURCE_CHECKSUMS = {
	rawArchive:
		"dc4935582175008791c1639bc9d05f8aab2f81743501e98413e10562c777ebb9",
	manifest:
		"55e4d8a2fa9984f4f8ee117552c1f4b6d3bbcced1762140409da20ce452bc326",
	selectedRecords:
		"b53a025dac9d5baf00538dab0d656f3b69e330899db01488dd4393309a66e439",
	selectionSummary:
		"7f2cfb253c58c13ba12c845d755c00c42ef14ad35b40b6d39c5aa44aadcee54f",
	openApi:
		"efa1a36c019efff199fe93c9b48393a527c5c8cb7106e9e26baeeb3d44879536"
} as const

export const ARCHIVE_MANIFEST_CHECKSUMS = {
	primary:
		"75c8ba30cfa7300831189cf4cc73cb576e88f312357051acb0ae93aacb38e302",
	filtered:
		"119b75499f7156f8828f057963ac97b2990f3856f397b89342dd601fcf47daba"
} as const

export type WormsSourceRecord = {
	AphiaID: number
	url: string
	scientificname: string
	authority: string
	status: string
	taxonRankID: number
	rank: string
	valid_AphiaID: number
	valid_name: string
	valid_authority: string
	family: string
	genus: string
	citation: string
	lsid: string
	isMarine: number
	isBrackish: number
	isFreshwater: number
	isTerrestrial: number
	isExtinct: number
	modified: string
}

export type WormsManifestRequest = {
	family: string
	parent_AphiaID: number
	offset: number
	url: string
	status: number
	path: string
	bytes: number
	sha256: string
}

export type WormsManifest = {
	started_utc: string
	strategy: string
	requests: WormsManifestRequest[]
}

export type TarMember = {
	path: string
	bytes: Uint8Array
}

export type TraversalValidation = {
	archiveRoot: "raw" | "raw-filtered"
	requestCount: number
	responseRecordOccurrences: number
	selectedRecordCount: number
	selectedRecordsMatch: true
}

export type LobsterTaxonomyRecord = {
	AphiaID: number
	scientificName: string
	authority: string
	family: LobsterFamily
	genus: string
	rank: "Species"
	status: "accepted"
	marineEvidence: {
		isMarine: 1
		isBrackish: 0 | 1
		isFreshwater: 0 | 1
		isTerrestrial: 0 | 1
	}
	extantEvidence: {
		isExtinct: 0
	}
	source: {
		url: string
		citation: string
		lsid: string
		modified: string
	}
}

export type LobsterTaxonomyDataset = {
	schemaVersion: 1
	snapshotId: string
	records: LobsterTaxonomyRecord[]
}

export const sha256 = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex")

const readTarString = (
	bytes: Uint8Array,
	offset: number,
	length: number
) => {
	const field = bytes.subarray(offset, offset + length)
	const zero = field.indexOf(0)
	return new TextDecoder()
		.decode(zero === -1 ? field : field.subarray(0, zero))
		.trim()
}

const readTarNumber = (
	bytes: Uint8Array,
	offset: number,
	length: number,
	context: string
) => {
	const value = readTarString(bytes, offset, length)
	if (!/^[0-7]+$/.test(value)) {
		throw new Error(`${context}: invalid tar numeric field ${JSON.stringify(value)}`)
	}
	return Number.parseInt(value, 8)
}

const parsePaxAttributes = (bytes: Uint8Array, context: string) => {
	const attributes = new Map<string, string>()
	let cursor = 0
	while (cursor < bytes.length) {
		const space = bytes.indexOf(32, cursor)
		if (space === -1) {
			throw new Error(`${context}: malformed PAX record length`)
		}
		const lengthText = new TextDecoder().decode(bytes.subarray(cursor, space))
		if (!/^\d+$/.test(lengthText)) {
			throw new Error(`${context}: malformed PAX record length`)
		}
		const length = Number.parseInt(lengthText, 10)
		const end = cursor + length
		if (length <= 0 || end > bytes.length || bytes[end - 1] !== 10) {
			throw new Error(`${context}: malformed PAX record bounds`)
		}
		const record = new TextDecoder().decode(bytes.subarray(space + 1, end - 1))
		const equals = record.indexOf("=")
		if (equals !== -1) {
			attributes.set(record.slice(0, equals), record.slice(equals + 1))
		}
		cursor = end
	}
	return attributes
}

export const parseTarMembers = (archive: Uint8Array) => {
	const members = new Map<string, TarMember>()
	let offset = 0
	let pendingPax = new Map<string, string>()
	const globalPax = new Map<string, string>()

	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512)
		if (header.every((byte) => byte === 0)) {
			break
		}

		const name = readTarString(header, 0, 100)
		const prefix = readTarString(header, 345, 155)
		const headerPath = prefix ? `${prefix}/${name}` : name
		const size = readTarNumber(header, 124, 12, headerPath)
		const type = String.fromCharCode(header[156] ?? 0)
		const dataOffset = offset + 512
		const dataEnd = dataOffset + size
		if (dataEnd > archive.length) {
			throw new Error(`${headerPath}: tar member extends beyond archive bounds`)
		}

		if (type === "x" || type === "g") {
			const attributes = parsePaxAttributes(
				archive.subarray(dataOffset, dataEnd),
				headerPath
			)
			if (type === "g") {
				for (const [key, value] of attributes) {
					globalPax.set(key, value)
				}
			} else {
				pendingPax = attributes
			}
		} else {
			const path =
				pendingPax.get("path") ?? globalPax.get("path") ?? headerPath
			pendingPax = new Map()
			if (type === "\0" || type === "0") {
				if (members.has(path)) {
					throw new Error(`${path}: duplicate tar member`)
				}
				members.set(path, {
					path,
					bytes: archive.subarray(dataOffset, dataEnd)
				})
			} else if (type !== "5") {
				throw new Error(`${path}: unsupported tar member type ${type}`)
			}
		}

		offset = dataOffset + Math.ceil(size / 512) * 512
	}

	return members
}

const parseManifest = (input: unknown, context: string): WormsManifest => {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`${context}: expected a manifest object`)
	}
	const manifest = input as Record<string, unknown>
	if (
		typeof manifest.started_utc !== "string" ||
		typeof manifest.strategy !== "string" ||
		!Array.isArray(manifest.requests)
	) {
		throw new Error(`${context}: missing manifest metadata or requests`)
	}
	return manifest as unknown as WormsManifest
}

const parseJsonMember = (member: TarMember, context: string) => {
	try {
		return JSON.parse(new TextDecoder().decode(member.bytes)) as unknown
	} catch {
		throw new Error(`${context}: archive member is not valid JSON`)
	}
}

const approvedFamilies = new Set<string>(
	FAMILY_SCOPE.map((entry) => entry.family)
)

export const isSelectedLobsterRecord = (input: unknown) => {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return false
	}
	const record = input as Record<string, unknown>
	return (
		record.rank === "Species" &&
		record.status === "accepted" &&
		record.valid_AphiaID === record.AphiaID &&
		record.isMarine === 1 &&
		record.isExtinct === 0 &&
		typeof record.family === "string" &&
		approvedFamilies.has(record.family)
	)
}

const selectUniqueRecords = (records: unknown[], context: string) => {
	const selected = new Map<number, unknown>()
	for (const record of records.filter(isSelectedLobsterRecord)) {
		const AphiaID = (record as Record<string, unknown>).AphiaID
		if (!Number.isInteger(AphiaID)) {
			throw new Error(`${context}: selected record has invalid AphiaID`)
		}
		const previous = selected.get(AphiaID as number)
		if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
			throw new Error(`${context}: conflicting records for AphiaID ${AphiaID}`)
		}
		selected.set(AphiaID as number, record)
	}
	return [...selected.values()].sort(
		(left, right) =>
			((left as Record<string, unknown>).AphiaID as number) -
			((right as Record<string, unknown>).AphiaID as number)
	)
}

const archiveRelativePath = (
	path: string,
	archiveRoot: "raw" | "raw-filtered",
	pathMode: "portable" | "retrieval-native",
	context: string
) => {
	if (pathMode === "portable") {
		if (
			path.startsWith("/") ||
			path.includes("\\") ||
			path.split("/").includes("..") ||
			!path.startsWith(`${archiveRoot}/`)
		) {
			throw new Error(`${context}: path must be archive-relative under ${archiveRoot}/`)
		}
		return path
	}

	const marker = `${archiveRoot}/`
	const markerIndex = path.indexOf(`/${marker}`)
	if (
		!path.startsWith("/") ||
		path.includes("\\") ||
		path.split("/").includes("..") ||
		markerIndex === -1
	) {
		throw new Error(`${context}: invalid retrieval-native archive path`)
	}
	return path.slice(markerIndex + 1)
}

export const validateTraversalManifest = (
	input: unknown,
	members: Map<string, TarMember>,
	selectedSource: unknown,
	options: {
		context: string
		archiveRoot: "raw" | "raw-filtered"
		pathMode: "portable" | "retrieval-native"
		marineOnly: boolean
		extantOnly: boolean
	}
): TraversalValidation => {
	const manifest = parseManifest(input, options.context)
	if (!Array.isArray(selectedSource)) {
		throw new Error(`${options.context}: selected source must be an array`)
	}

	const manifestPaths = new Set<string>()
	const responseRecords: unknown[] = []
	for (const [index, request] of manifest.requests.entries()) {
		const context = `${options.context} request ${index}`
		if (!request || typeof request !== "object") {
			throw new Error(`${context}: expected a request object`)
		}
		if (
			!approvedFamilies.has(request.family) ||
			!Number.isInteger(request.parent_AphiaID) ||
			!Number.isInteger(request.offset) ||
			typeof request.url !== "string" ||
			typeof request.path !== "string" ||
			(request.status !== 200 && request.status !== 204) ||
			!Number.isInteger(request.bytes) ||
			request.bytes < 0 ||
			!/^[a-f0-9]{64}$/.test(request.sha256)
		) {
			throw new Error(`${context}: invalid request metadata`)
		}

		const path = archiveRelativePath(
			request.path,
			options.archiveRoot,
			options.pathMode,
			context
		)
		const fileName = path.slice(path.lastIndexOf("/") + 1)
		const expectedSuffix =
			`parent-${request.parent_AphiaID}-offset-${request.offset}-` +
			`status-${request.status}.json`
		if (!/^\d{5}-/.test(fileName) || !fileName.endsWith(expectedSuffix)) {
			throw new Error(`${context}: path does not match request metadata`)
		}
		const expectedUrl =
			`https://www.marinespecies.org/rest/AphiaChildrenByAphiaID/` +
			`${request.parent_AphiaID}?marine_only=${options.marineOnly}` +
			`&extant_only=${options.extantOnly}&offset=${request.offset}`
		if (request.url !== expectedUrl) {
			throw new Error(`${context}: URL does not match request metadata`)
		}
		if (manifestPaths.has(path)) {
			throw new Error(`${context}: duplicate manifest path ${path}`)
		}
		manifestPaths.add(path)

		const member = members.get(path)
		if (!member) {
			throw new Error(`${context}: missing archive member ${path}`)
		}
		if (member.bytes.length !== request.bytes) {
			throw new Error(`${context}: byte size mismatch for ${path}`)
		}
		if (sha256(member.bytes) !== request.sha256) {
			throw new Error(`${context}: SHA-256 mismatch for ${path}`)
		}
		if (request.status === 204) {
			if (member.bytes.length !== 0) {
				throw new Error(`${context}: HTTP 204 member must be empty`)
			}
			continue
		}

		const response = parseJsonMember(member, context)
		if (!Array.isArray(response)) {
			throw new Error(`${context}: HTTP 200 response must be an array`)
		}
		responseRecords.push(...response)
	}

	const archivePaths = [...members.keys()].filter((path) =>
		path.startsWith(`${options.archiveRoot}/`)
	)
	const unmanifested = archivePaths.filter((path) => !manifestPaths.has(path))
	if (
		archivePaths.length !== manifestPaths.size ||
		unmanifested.length > 0
	) {
		throw new Error(
			`${options.context}: archive coverage mismatch ` +
				`(${manifestPaths.size} manifest, ${archivePaths.length} archive)`
		)
	}

	const reconstructed = selectUniqueRecords(responseRecords, options.context)
	if (JSON.stringify(reconstructed) !== JSON.stringify(selectedSource)) {
		throw new Error(
			`${options.context}: reconstructed selected records do not match committed source`
		)
	}

	return {
		archiveRoot: options.archiveRoot,
		requestCount: manifest.requests.length,
		responseRecordOccurrences: responseRecords.length,
		selectedRecordCount: reconstructed.length,
		selectedRecordsMatch: true
	}
}

export const validateArchiveProvenance = (
	archiveBytes: Uint8Array,
	primaryManifest: unknown,
	selectedSource: unknown
) => {
	const members = parseTarMembers(archiveBytes)
	const archivedPrimaryManifest = members.get("manifest.json")
	const filteredManifest = members.get("manifest-filtered.json")
	if (!archivedPrimaryManifest || !filteredManifest) {
		throw new Error("raw archive is missing embedded traversal manifests")
	}
	if (
		sha256(archivedPrimaryManifest.bytes) !==
		ARCHIVE_MANIFEST_CHECKSUMS.primary
	) {
		throw new Error("embedded primary manifest checksum mismatch")
	}
	if (
		sha256(filteredManifest.bytes) !==
		ARCHIVE_MANIFEST_CHECKSUMS.filtered
	) {
		throw new Error("embedded filtered manifest checksum mismatch")
	}

	const archivedPrimary = parseJsonMember(
		archivedPrimaryManifest,
		"embedded primary manifest"
	)
	const portablePrimary = JSON.parse(
		JSON.stringify(archivedPrimary)
	) as WormsManifest
	for (const [index, request] of portablePrimary.requests.entries()) {
		request.path = archiveRelativePath(
			request.path,
			"raw",
			"retrieval-native",
			`embedded primary manifest request ${index}`
		)
	}
	if (JSON.stringify(portablePrimary) !== JSON.stringify(primaryManifest)) {
		throw new Error(
			"portable primary manifest differs from embedded official manifest"
		)
	}

	const primary = validateTraversalManifest(
		primaryManifest,
		members,
		selectedSource,
		{
			context: "primary traversal",
			archiveRoot: "raw",
			pathMode: "portable",
			marineOnly: false,
			extantOnly: false
		}
	)
	const filtered = validateTraversalManifest(
		parseJsonMember(filteredManifest, "filtered traversal manifest"),
		members,
		selectedSource,
		{
			context: "filtered validation traversal",
			archiveRoot: "raw-filtered",
			pathMode: "retrieval-native",
			marineOnly: true,
			extantOnly: true
		}
	)

	return {
		archiveMemberCount: members.size,
		embeddedPrimaryManifestSha256: ARCHIVE_MANIFEST_CHECKSUMS.primary,
		portableManifestMatchesEmbeddedPrimary: true as const,
		primary,
		filtered: {
			...filtered,
			manifestArchiveMember: "manifest-filtered.json",
			manifestSha256: ARCHIVE_MANIFEST_CHECKSUMS.filtered,
			archivedPathMode:
				"retrieval-native paths validated after mapping to raw-filtered/ archive members"
		}
	}
}

const requireString = (
	record: Record<string, unknown>,
	field: string,
	context: string
) => {
	const value = record[field]
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${context}: ${field} must be a non-empty string`)
	}
	return value
}

const requireInteger = (
	record: Record<string, unknown>,
	field: string,
	context: string
) => {
	const value = record[field]
	if (!Number.isInteger(value)) {
		throw new Error(`${context}: ${field} must be an integer`)
	}
	return value as number
}

const requireBinary = (
	record: Record<string, unknown>,
	field: string,
	context: string
) => {
	const value = requireInteger(record, field, context)
	if (value !== 0 && value !== 1) {
		throw new Error(`${context}: ${field} must be 0 or 1`)
	}
	return value as 0 | 1
}

export const normalizeLobsterRecord = (
	input: unknown,
	index = 0
): LobsterTaxonomyRecord => {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`record ${index}: expected an object`)
	}

	const record = input as Record<string, unknown>
	const AphiaID = requireInteger(record, "AphiaID", `record ${index}`)
	const context = `record ${index} (AphiaID ${AphiaID})`
	const rank = requireString(record, "rank", context)
	const status = requireString(record, "status", context)
	const family = requireString(record, "family", context)
	const validAphiaId = requireInteger(record, "valid_AphiaID", context)
	const isMarine = requireBinary(record, "isMarine", context)
	const isBrackish = requireBinary(record, "isBrackish", context)
	const isFreshwater = requireBinary(record, "isFreshwater", context)
	const isTerrestrial = requireBinary(record, "isTerrestrial", context)
	const isExtinct = requireBinary(record, "isExtinct", context)

	if (rank !== "Species") {
		throw new Error(`${context}: rank must be Species, received ${rank}`)
	}
	if (status !== "accepted" || validAphiaId !== AphiaID) {
		throw new Error(`${context}: record must be an accepted taxon, not a synonym`)
	}
	if (isExtinct !== 0) {
		throw new Error(`${context}: extinct taxa are excluded`)
	}
	if (isMarine !== 1) {
		const habitat =
			isFreshwater === 1
				? "freshwater-only"
				: isBrackish === 1
					? "brackish-only"
					: "nonmarine"
		throw new Error(`${context}: ${habitat} taxa are excluded`)
	}

	const scope = FAMILY_SCOPE.find((entry) => entry.family === family)
	if (!scope) {
		throw new Error(`${context}: family ${family} is outside the approved scope`)
	}

	const scientificName = requireString(record, "scientificname", context)
	const authority = requireString(record, "authority", context)
	const validName = requireString(record, "valid_name", context)
	const validAuthority = requireString(record, "valid_authority", context)
	const genus = requireString(record, "genus", context)
	const url = requireString(record, "url", context)
	const citation = requireString(record, "citation", context)
	const lsid = requireString(record, "lsid", context)
	const modified = requireString(record, "modified", context)

	if (validName !== scientificName || validAuthority !== authority) {
		throw new Error(`${context}: accepted-name evidence does not match the record`)
	}
	if (!scientificName.startsWith(`${genus} `)) {
		throw new Error(`${context}: genus does not match the scientific name`)
	}
	if (
		url !==
		`https://www.marinespecies.org/aphia.php?p=taxdetails&id=${AphiaID}`
	) {
		throw new Error(`${context}: source URL does not match AphiaID`)
	}
	if (lsid !== `urn:lsid:marinespecies.org:taxname:${AphiaID}`) {
		throw new Error(`${context}: LSID does not match AphiaID`)
	}

	return {
		AphiaID,
		scientificName,
		authority,
		family: scope.family,
		genus,
		rank: "Species",
		status: "accepted",
		marineEvidence: {
			isMarine: 1,
			isBrackish,
			isFreshwater,
			isTerrestrial
		},
		extantEvidence: {
			isExtinct: 0
		},
		source: {
			url,
			citation,
			lsid,
			modified
		}
	}
}

export const buildLobsterTaxonomyDataset = (
	input: unknown
): LobsterTaxonomyDataset => {
	if (!Array.isArray(input)) {
		throw new Error("WoRMS selected source must be an array")
	}

	const records = input
		.map((record, index) => normalizeLobsterRecord(record, index))
		.sort((left, right) => left.AphiaID - right.AphiaID)
	const seen = new Set<number>()
	for (const record of records) {
		if (seen.has(record.AphiaID)) {
			throw new Error(`duplicate AphiaID ${record.AphiaID}`)
		}
		seen.add(record.AphiaID)
	}

	const expectedTotal = FAMILY_SCOPE.reduce(
		(total, family) => total + family.speciesCount,
		0
	)
	if (records.length !== expectedTotal) {
		throw new Error(
			`expected ${expectedTotal} accepted species, received ${records.length}`
		)
	}
	for (const scope of FAMILY_SCOPE) {
		const count = records.filter(
			(record) => record.family === scope.family
		).length
		if (count !== scope.speciesCount) {
			throw new Error(
				`${scope.family}: expected ${scope.speciesCount} species, received ${count}`
			)
		}
	}

	return {
		schemaVersion: 1,
		snapshotId: LOBSTER_TAXONOMY_SNAPSHOT.id,
		records
	}
}

export const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`
