import type {
	MessagePayloadFile,
	MessagePayloadObject
} from "@buape/carbon"
import {
	buildLobsterEncounterContainer,
	type LobsterEncounterMedia
} from "../components/lobsterButtons.js"
import type { LobsterEncounter } from "../db/schema.js"
import { formatLobsterEncounterId } from "./lobsterEngine.js"

export type LobsterImageFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>

let configuredFetcher: LobsterImageFetcher | null = null

export const setLobsterImageFetcherForTesting = (
	fetcher: LobsterImageFetcher | null
) => {
	configuredFetcher = fetcher
}

const trustedImageOrigin = "https://raw.githubusercontent.com"
const maximumImageBytes = 120 * 1024
const trustedImageUrl =
	/^https:\/\/raw\.githubusercontent\.com\/openclaw\/hermit\/[a-f0-9]{40}\/assets\/lobster\/(?:scenes|primary)\/[1-9]\d*\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.webp$/

const ascii = (bytes: Uint8Array, start: number, length: number) =>
	String.fromCharCode(...bytes.subarray(start, start + length))

const uint32LittleEndian = (bytes: Uint8Array, offset: number) =>
	(
		bytes[offset]! |
		(bytes[offset + 1]! << 8) |
		(bytes[offset + 2]! << 16) |
		(bytes[offset + 3]! << 24)
	) >>> 0

const isWebp = (bytes: Uint8Array) => {
	if (
		bytes.length < 20 ||
		ascii(bytes, 0, 4) !== "RIFF" ||
		ascii(bytes, 8, 4) !== "WEBP" ||
		uint32LittleEndian(bytes, 4) + 8 !== bytes.length
	) {
		return false
	}

	let offset = 12
	let hasImageBitstream = false
	while (offset < bytes.length) {
		if (offset + 8 > bytes.length) {
			return false
		}
		const chunkType = ascii(bytes, offset, 4)
		const chunkSize = uint32LittleEndian(bytes, offset + 4)
		const dataStart = offset + 8
		if (chunkSize > bytes.length - dataStart) {
			return false
		}
		const dataEnd = dataStart + chunkSize
		const paddedChunkEnd = dataEnd + (chunkSize % 2)
		if (paddedChunkEnd > bytes.length) {
			return false
		}

		switch (chunkType) {
			case "VP8 ":
				if (
					chunkSize < 10 ||
					bytes[dataStart + 3] !== 0x9d ||
					bytes[dataStart + 4] !== 0x01 ||
					bytes[dataStart + 5] !== 0x2a
				) {
					return false
				}
				hasImageBitstream = true
				break
			case "VP8L":
				if (chunkSize < 5 || bytes[dataStart] !== 0x2f) {
					return false
				}
				hasImageBitstream = true
				break
			case "VP8X":
				if (chunkSize !== 10) {
					return false
				}
				break
		}

		offset = paddedChunkEnd
	}

	return offset === bytes.length && hasImageBitstream
}

const fetchImageFile = async (
	url: string,
	name: string,
	description: string,
	fetcher: LobsterImageFetcher
): Promise<MessagePayloadFile> => {
	const parsed = new URL(url)
	if (
		!trustedImageUrl.test(url) ||
		parsed.origin !== trustedImageOrigin ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error("Refusing to fetch an untrusted lobster image URL")
	}

	const response = await fetcher(parsed, {
		headers: { accept: "image/webp" }
	})
	if (!response.ok) {
		throw new Error(`Lobster image fetch failed with HTTP ${response.status}`)
	}

	const bytes = new Uint8Array(await response.arrayBuffer())
	if (bytes.length > maximumImageBytes || !isWebp(bytes)) {
		throw new Error("Lobster image response was not a valid bounded WebP")
	}

	return {
		name,
		data: new Blob([bytes], { type: "image/webp" }),
		description
	}
}

export const buildLobsterEncounterPayload = async (
	encounter: LobsterEncounter,
	fetcher: LobsterImageFetcher = configuredFetcher ?? fetch
): Promise<MessagePayloadObject> => {
	const encounterId = formatLobsterEncounterId(encounter.id)
	const files: MessagePayloadFile[] = []
	const media: LobsterEncounterMedia = {
		imageUrl: null,
		counterImageUrl: encounter.counterAssetUrl ? null : undefined
	}

	try {
		const name = `lobster-${encounter.id}-initial.webp`
		files.push(
			await fetchImageFile(
				encounter.assetUrl,
				name,
				`${encounter.speciesDisplayName}, assigned to ${encounterId}`,
				fetcher
			)
		)
		media.imageUrl = `attachment://${name}`
	} catch (error) {
		console.error(
			`Failed to attach lobster image for encounter ${encounter.id}:`,
			error
		)
	}

	if (encounter.counterAssetUrl) {
		try {
			const name = `lobster-${encounter.id}-return.webp`
			files.push(
				await fetchImageFile(
					encounter.counterAssetUrl,
					name,
					`Return scene for ${encounter.speciesDisplayName} in ${encounterId}`,
					fetcher
				)
			)
			media.counterImageUrl = `attachment://${name}`
		} catch (error) {
			console.error(
				`Failed to attach lobster return image for encounter ${encounter.id}:`,
				error
			)
		}
	}

	return {
		components: [buildLobsterEncounterContainer(encounter, media)],
		...(files.length > 0 ? { files } : {})
	}
}
