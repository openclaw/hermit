import { lobsterPrimaryUrl } from "../config/lobster.js"
import { getLobsterMetadataByAphiaId } from "../config/lobsterMetadata.js"
import { getLobsterPrimaryArtwork } from "../config/lobsterPrimaryArtwork.js"
import { getLobsterSpeciesByAphiaId } from "../config/lobsterTaxonomy.js"
import { renderDocument } from "../forms/document.js"
import {
	LobsterDossierNotFoundPage,
	LobsterDossierPage
} from "./page.js"

const dossierHost = "hermit-discord.openclaw.ai"
const dossierPath = /^\/lobsters\/([^/]+)\/?$/
const dossierPrefix = "/lobsters/"
const positiveAphiaId = /^[1-9]\d*$/

const htmlHeaders = {
	"cache-control": "public, max-age=3600",
	"content-type": "text/html; charset=utf-8"
}

const htmlResponse = (
	request: Request,
	body: string,
	status: number,
	headers: HeadersInit = htmlHeaders
) =>
	new Response(request.method === "HEAD" ? null : body, {
		status,
		headers
	})

const notFoundResponse = (request: Request) =>
	htmlResponse(
		request,
		renderDocument(
			"Lobster dossier not found",
			<LobsterDossierNotFoundPage />
		),
		404
	)

export const handleLobsterDossierRequest = (request: Request) => {
	const url = new URL(request.url)
	if (url.hostname !== dossierHost) {
		return null
	}

	if (!url.pathname.startsWith(dossierPrefix)) {
		return null
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" }
		})
	}

	const match = dossierPath.exec(url.pathname)
	if (!match) {
		return notFoundResponse(request)
	}

	const rawAphiaId = match[1]!
	if (!positiveAphiaId.test(rawAphiaId)) {
		return notFoundResponse(request)
	}

	const AphiaID = Number(rawAphiaId)
	if (!Number.isSafeInteger(AphiaID)) {
		return notFoundResponse(request)
	}

	const taxonomy = getLobsterSpeciesByAphiaId(AphiaID)
	const metadata = getLobsterMetadataByAphiaId(AphiaID)
	const primary = getLobsterPrimaryArtwork(AphiaID)
	if (!taxonomy || !metadata || !primary) {
		return notFoundResponse(request)
	}

	return htmlResponse(
		request,
		renderDocument(
			`${metadata.displayName} - Lobster Dossier`,
			<LobsterDossierPage
				metadata={metadata}
				sceneAltText={primary.altText}
				sceneUrl={lobsterPrimaryUrl(primary.relativeOutputPath)}
				taxonomy={taxonomy}
			/>
		),
		200
	)
}
