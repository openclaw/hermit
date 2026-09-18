import fs from "node:fs"
import path from "node:path"
import { contentFeatures } from "../review/features.js"
import type { ReviewMessage } from "../review/types.js"
import { reviewConfig } from "../config/review.js"

interface DiscrawlRawMessage {
	id: string
	author?: { id: string; username?: string; bot?: boolean }
	author_id?: string
	authorId?: string
	channel_id?: string
	channelId?: string
	guild_id?: string
	guildId?: string
	content?: string
	timestamp: string | number
	reply_to_id?: string | null
	replyToId?: string | null
	message_reference?: { message_id?: string }
	attachments?: unknown[]
}

interface ParsedMessage {
	id: string
	authorId: string
	guildId: string
	channelId: string
	content: string
	createdAt: number
	replyToId: string | null
	hasMedia: boolean
}

// In-memory cache for indexed Discrawl messages
interface CacheEntry {
	mtimeMs: number
	messagesByAuthor: Map<string, ParsedMessage[]>
	messageTimestampMap: Map<string, number>
}

let cache: CacheEntry | null = null
let cachedPath: string | null = null

const getSecretKey = () =>
	process.env.DEPLOY_SECRET ||
	"hermit-review-salt-key-minimum-32-chars-length-padding"

const parseTimestamp = (value: string | number): number => {
	if (typeof value === "number") {
		return value
	}
	const parsed = Date.parse(value)
	return Number.isFinite(parsed) ? parsed : Date.now()
}

const parseRawItem = (item: unknown): ParsedMessage | null => {
	if (!item || typeof item !== "object") return null
	const raw = item as DiscrawlRawMessage

	const id = typeof raw.id === "string" ? raw.id : String(raw.id || "")
	if (!id) return null

	const authorId =
		raw.author?.id ||
		(typeof raw.author_id === "string" ? raw.author_id : "") ||
		(typeof raw.authorId === "string" ? raw.authorId : "") ||
		""
	if (!authorId) return null

	const guildId =
		raw.guild_id || raw.guildId || reviewConfig.guildId
	const channelId =
		raw.channel_id || raw.channelId || "channel-unknown"
	const content = typeof raw.content === "string" ? raw.content : ""
	const createdAt = parseTimestamp(raw.timestamp)

	const replyToId =
		raw.message_reference?.message_id ||
		raw.reply_to_id ||
		raw.replyToId ||
		null

	const hasMedia = Array.isArray(raw.attachments) && raw.attachments.length > 0

	return {
		id,
		authorId,
		guildId,
		channelId,
		content,
		createdAt,
		replyToId,
		hasMedia
	}
}

const parseFileContent = (content: string): ParsedMessage[] => {
	const trimmed = content.trim()
	if (!trimmed) return []

	// Try JSON parse first (array or object with messages)
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed)
			if (Array.isArray(parsed)) {
				return parsed
					.map(parseRawItem)
					.filter((m: ParsedMessage | null): m is ParsedMessage => Boolean(m))
			}
			if (parsed && typeof parsed === "object" && Array.isArray(parsed.messages)) {
				return parsed.messages
					.map(parseRawItem)
					.filter((m: ParsedMessage | null): m is ParsedMessage => Boolean(m))
			}
		} catch {
			// If JSON parse fails, fall through to JSONL
		}
	}

	// Try JSON Lines
	const lines = trimmed.split("\n")
	const results: ParsedMessage[] = []
	for (const line of lines) {
		const lineTrimmed = line.trim()
		if (!lineTrimmed) continue
		try {
			const parsed = JSON.parse(lineTrimmed)
			const item = parseRawItem(parsed)
			if (item) results.push(item)
		} catch {
			// Skip unparseable line
		}
	}
	return results
}

const getDiscrawlMtime = (exportPath: string): number => {
	try {
		const stat = fs.statSync(exportPath)
		if (stat.isDirectory()) {
			let maxMtime = stat.mtimeMs
			const files = fs.readdirSync(exportPath)
			for (const file of files) {
				if (file.endsWith(".json") || file.endsWith(".jsonl")) {
					const fileStat = fs.statSync(path.join(exportPath, file))
					if (fileStat.mtimeMs > maxMtime) maxMtime = fileStat.mtimeMs
				}
			}
			return maxMtime
		}
		return stat.mtimeMs
	} catch {
		return 0
	}
}

export const loadDiscrawlIndex = (exportPath: string): CacheEntry => {
	const currentMtime = getDiscrawlMtime(exportPath)
	if (
		cache &&
		cachedPath === exportPath &&
		currentMtime > 0 &&
		cache.mtimeMs >= currentMtime
	) {
		return cache
	}

	const messagesByAuthor = new Map<string, ParsedMessage[]>()
	const messageTimestampMap = new Map<string, number>()

	try {
		const stat = fs.statSync(exportPath)
		const filesToRead: string[] = []

		if (stat.isDirectory()) {
			const dirEntries = fs.readdirSync(exportPath)
			for (const entry of dirEntries) {
				if (entry.endsWith(".json") || entry.endsWith(".jsonl")) {
					filesToRead.push(path.join(exportPath, entry))
				}
			}
		} else {
			filesToRead.push(exportPath)
		}

		for (const filePath of filesToRead) {
			const content = fs.readFileSync(filePath, "utf-8")
			const parsedItems = parseFileContent(content)

			for (const item of parsedItems) {
				messageTimestampMap.set(item.id, item.createdAt)
				const existing = messagesByAuthor.get(item.authorId)
				if (existing) {
					existing.push(item)
				} else {
					messagesByAuthor.set(item.authorId, [item])
				}
			}
		}

		// Sort each author's messages descending by createdAt
		for (const messages of messagesByAuthor.values()) {
			messages.sort((a, b) => b.createdAt - a.createdAt)
		}
	} catch (error) {
		console.warn(`Failed to read Discrawl export from ${exportPath}:`, error)
	}

	cache = {
		mtimeMs: currentMtime,
		messagesByAuthor,
		messageTimestampMap
	}
	cachedPath = exportPath

	return cache
}

export const getRecentDiscrawlObservations = (
	exportPath: string,
	guildId: string,
	authorId: string,
	windowDays = 7,
	limit = 200
): ReviewMessage[] => {
	const index = loadDiscrawlIndex(exportPath)
	const rawMessages = index.messagesByAuthor.get(authorId) || []
	const cutoff = Date.now() - windowDays * 86400000

	const secret = getSecretKey()
	const result: ReviewMessage[] = []

	for (const raw of rawMessages) {
		if (raw.createdAt < cutoff) continue
		if (raw.guildId && raw.guildId !== guildId) continue

		let replyLatencyMs: number | null = null
		if (raw.replyToId && index.messageTimestampMap.has(raw.replyToId)) {
			const parentTime = index.messageTimestampMap.get(raw.replyToId)!
			if (raw.createdAt >= parentTime) {
				replyLatencyMs = raw.createdAt - parentTime
			}
		}

		const features = contentFeatures(
			raw.content,
			secret,
			guildId,
			authorId,
			{ hasMedia: raw.hasMedia }
		)

		result.push({
			messageId: raw.id,
			guildId: raw.guildId,
			channelId: raw.channelId,
			authorId: raw.authorId,
			createdAt: raw.createdAt,
			replyToId: raw.replyToId,
			replyLatencyMs,
			contentLength: features.contentLength,
			lineCount: features.lineCount,
			fingerprint: features.fingerprint,
			artifacts: features.artifacts
		})

		if (result.length >= limit) break
	}

	return result
}

export const getDiscrawlObservationCount = (
	exportPath: string,
	guildId: string,
	authorId: string,
	windowDays = 7
): number => {
	const index = loadDiscrawlIndex(exportPath)
	const rawMessages = index.messagesByAuthor.get(authorId) || []
	const cutoff = Date.now() - windowDays * 86400000

	let count = 0
	for (const raw of rawMessages) {
		if (raw.createdAt < cutoff) continue
		if (raw.guildId && raw.guildId !== guildId) continue
		count++
	}
	return count
}

export const clearDiscrawlCache = () => {
	cache = null
	cachedPath = null
}

export const fetchRemoteDiscrawlObservations = async (
	exportUrl: string,
	secret: string,
	guildId: string,
	authorId: string,
	windowDays = 7,
	limit = 200
): Promise<ReviewMessage[]> => {
	try {
		const url = new URL("/api/discrawl/observations", exportUrl)
		url.searchParams.set("guildId", guildId)
		url.searchParams.set("authorId", authorId)
		url.searchParams.set("windowDays", String(windowDays))
		url.searchParams.set("limit", String(limit))

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${secret}`,
				Accept: "application/json"
			}
		})

		if (!response.ok) {
			console.warn(`[DiscrawlRemote] Endpoint returned ${response.status}`)
			return []
		}

		return (await response.json()) as ReviewMessage[]
	} catch (error) {
		console.warn("[DiscrawlRemote] Failed to fetch remote observations:", error)
		return []
	}
}

export const fetchRemoteDiscrawlCount = async (
	exportUrl: string,
	secret: string,
	guildId: string,
	authorId: string,
	windowDays = 7
): Promise<number> => {
	try {
		const url = new URL("/api/discrawl/count", exportUrl)
		url.searchParams.set("guildId", guildId)
		url.searchParams.set("authorId", authorId)
		url.searchParams.set("windowDays", String(windowDays))

		const response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${secret}`,
				Accept: "application/json"
			}
		})

		if (!response.ok) {
			console.warn(`[DiscrawlRemote] Endpoint returned ${response.status}`)
			return 0
		}

		const data = (await response.json()) as { count?: number }
		return typeof data.count === "number" ? data.count : 0
	} catch (error) {
		console.warn("[DiscrawlRemote] Failed to fetch remote count:", error)
		return 0
	}
}

