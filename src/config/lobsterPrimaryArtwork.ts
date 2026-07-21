import runtimeData from "../../data/lobster/artwork/primary-runtime.json" with {
	type: "json"
}
import {
	parsePrimaryArtworkRuntimeManifest,
	type PrimaryArtworkRuntimeEntry
} from "../../scripts/lib/lobster-primary-artwork.js"

export const lobsterPrimaryArtwork =
	parsePrimaryArtworkRuntimeManifest(runtimeData)

export const lobsterPrimaryArtworkByAphiaId = new Map(
	lobsterPrimaryArtwork.entries.map((entry) => [entry.AphiaID, entry])
)

export const getLobsterPrimaryArtwork = (
	AphiaID: number
): PrimaryArtworkRuntimeEntry | undefined =>
	lobsterPrimaryArtworkByAphiaId.get(AphiaID)
