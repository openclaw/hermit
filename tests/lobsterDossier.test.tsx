import { describe, expect, it } from "bun:test"
import {
	lobsterArtworkRevision,
	lobsterPrimaryUrl
} from "../src/config/lobster.js"
import { getLobsterMetadataByAphiaId } from "../src/config/lobsterMetadata.js"
import { getLobsterPrimaryArtwork } from "../src/config/lobsterPrimaryArtwork.js"
import { getLobsterSpeciesByAphiaId } from "../src/config/lobsterTaxonomy.js"
import { handleLobsterDossierRequest } from "../src/lobsterDossiers/server.js"

const dossierUrl = (path: string) =>
	`https://hermit-discord.openclaw.ai${path}`

describe("public lobster dossiers", () => {
	it("renders a known species from bundled taxonomy and metadata", async () => {
		const AphiaID = 107253
		const taxonomy = getLobsterSpeciesByAphiaId(AphiaID)!
		const metadata = getLobsterMetadataByAphiaId(AphiaID)!
		const primary = getLobsterPrimaryArtwork(AphiaID)!
		const response = handleLobsterDossierRequest(
			new Request(dossierUrl(`/lobsters/${AphiaID}`))
		)

		expect(response).toBeInstanceOf(Response)
		expect(response!.status).toBe(200)
		expect(response!.headers.get("content-type")).toBe(
			"text/html; charset=utf-8"
		)

		const html = await response!.text()
		expect(html).toStartWith("<!doctype html>")
		expect(html).toContain(taxonomy.scientificName)
		expect(html).toContain(taxonomy.authority)
		expect(html).toContain(taxonomy.family)
		expect(html).toContain(`AphiaID ${AphiaID}`)
		expect(html).toContain(taxonomy.source.url.replaceAll("&", "&amp;"))
		expect(html).toContain(taxonomy.source.citation.replaceAll("&", "&amp;"))
		expect(html).toContain("Unknown in the bundled evidence")
		expect(html).toContain(
			lobsterPrimaryUrl(primary.relativeOutputPath)
		)
		expect(html).toContain(lobsterArtworkRevision)
	})

	it("serves HEAD without a response body", async () => {
		const response = handleLobsterDossierRequest(
			new Request(dossierUrl("/lobsters/107253"), { method: "HEAD" })
		)

		expect(response!.status).toBe(200)
		expect(await response!.text()).toBe("")
	})

	it.each(["abc", "0", "-1", "1.5", "001", "999999999"])(
		"returns 404 for malformed or unknown AphiaID %s",
		async (AphiaID) => {
			const response = handleLobsterDossierRequest(
				new Request(dossierUrl(`/lobsters/${AphiaID}`))
			)

			expect(response!.status).toBe(404)
			expect(await response!.text()).toContain("Lobster dossier not found")
		}
	)

	it("returns 405 for unsupported methods on a dossier path", async () => {
		const response = handleLobsterDossierRequest(
			new Request(dossierUrl("/lobsters/107253"), { method: "POST" })
		)

		expect(response!.status).toBe(405)
		expect(response!.headers.get("allow")).toBe("GET, HEAD")
	})

	it("returns null for unrelated hosts and paths", () => {
		expect(
			handleLobsterDossierRequest(
				new Request("https://forms.openclaw.ai/lobsters/107253")
			)
		).toBeNull()
		const malformedPathResponse = handleLobsterDossierRequest(
			new Request(dossierUrl("/lobsters/107253/more"))
		)
		expect(malformedPathResponse!.status).toBe(404)
		expect(
			handleLobsterDossierRequest(new Request(dossierUrl("/health")))
		).toBeNull()
	})
})
