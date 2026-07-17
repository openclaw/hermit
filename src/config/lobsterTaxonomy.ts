import taxonomyData from "../../data/lobster/taxonomy/lobster-species.json" with {
	type: "json"
}
import provenanceData from "../../data/lobster/taxonomy/provenance.json" with {
	type: "json"
}

export type LobsterTaxonomyFamily =
	| "Nephropidae"
	| "Enoplometopidae"
	| "Glypheidae"
	| "Palinuridae"
	| "Scyllaridae"
	| "Polychelidae"

export type LobsterTaxonomyRecord = {
	AphiaID: number
	scientificName: string
	authority: string
	family: LobsterTaxonomyFamily
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

export type LobsterTaxonomyProvenance = {
	schemaVersion: 1
	snapshot: {
		id: string
		retrievedAtUtc: string
		accessedDate: string
	}
	familyScope: Array<{
		family: LobsterTaxonomyFamily
		AphiaID: number
		speciesCount: number
	}>
	source: {
		provider: string
		citation: string
		rawArchive: {
			path: string
			sha256: string
		}
	}
	normalized: {
		path: string
		recordCount: number
		sha256: string
	}
}

export const lobsterTaxonomy =
	taxonomyData as unknown as LobsterTaxonomyDataset

export const lobsterTaxonomyProvenance =
	provenanceData as unknown as LobsterTaxonomyProvenance

export const lobsterSpecies = lobsterTaxonomy.records

export const lobsterSpeciesByAphiaId = new Map(
	lobsterSpecies.map((record) => [record.AphiaID, record])
)

export const getLobsterSpeciesByAphiaId = (AphiaID: number) =>
	lobsterSpeciesByAphiaId.get(AphiaID)
