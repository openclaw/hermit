import { and, desc, eq, gte, lte, sql } from "drizzle-orm"
import { db } from "../db.js"
import { helperEvents, trackedThreads } from "../db/schema.js"

type GenericWorkerEventPayload = {
	type?: string | null
	time?: string | null
	invokedBy?: {
		id?: string | null
		username?: string | null
		globalName?: string | null
	} | null
	context?: {
		guildId?: string | null
		channelId?: string | null
		threadId?: string | null
		messageCount?: number | null
		parentId?: string | null
	} | null
	data?: {
		command?: string | null
	} | null
}

type NormalizedEvent = {
	eventType: string
	threadId: string | null
	messageCount: number | null
	eventTime: string
	command: string
	invokedById: string | null
	invokedByUsername: string | null
	invokedByGlobalName: string | null
	rawPayload: string
}

type ThreadUpsertPayload = {
	threadId?: string | null
	createdAt?: string | null
	lastChecked?: string | null
	solved?: boolean | number | string | null
	warningLevel?: number | null
	closed?: boolean | number | string | null
	lastMessageCount?: number | null
}

type EventFilters = {
	eventType?: string | null
	command?: string | null
	threadId?: string | null
	invokedBy?: string | null
	from?: string | null
	to?: string | null
	limit?: number
}

type ThreadFilters = {
	threadId?: string | null
	solved?: boolean
	closed?: boolean
	limit?: number
}

const asStringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const asNumberOrNull = (value: unknown): number | null => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return null
	}

	return Math.trunc(value)
}

const toIsoOrNow = (value: unknown): string => {
	if (typeof value !== "string") {
		return new Date().toISOString()
	}

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return new Date().toISOString()
	}

	return date.toISOString()
}

const parseIsoOrNull = (value: unknown): string | null => {
	if (typeof value !== "string") {
		return null
	}

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return null
	}

	return date.toISOString()
}

const parseBooleanLike = (value: unknown): number => {
	if (typeof value === "boolean") {
		return value ? 1 : 0
	}

	if (typeof value === "number") {
		return value === 1 ? 1 : 0
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase()
		if (normalized === "true" || normalized === "1") {
			return 1
		}
	}

	return 0
}

const parseNonNegativeInt = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return fallback
	}

	return Math.max(0, Math.trunc(value))
}

export const normalizeEventPayload = (
	payload: unknown
): NormalizedEvent | null => {
	if (!payload || typeof payload !== "object") {
		return null
	}

	const rawPayload = JSON.stringify(payload)
	const record = payload as GenericWorkerEventPayload & Record<string, unknown>
	const invokedBy = record.invokedBy as Record<string, unknown> | null | undefined

	const invokedById = asStringOrNull(invokedBy?.id)
	const invokedByUsername = asStringOrNull(invokedBy?.username)
	const invokedByGlobalName = asStringOrNull(invokedBy?.globalName)
	const eventType = asStringOrNull(record.type)
	if (!eventType) {
		return null
	}

	const context = record.context as Record<string, unknown> | null | undefined
	const data = record.data as Record<string, unknown> | null | undefined

	return {
		eventType,
		threadId: asStringOrNull(context?.threadId),
		messageCount: asNumberOrNull(context?.messageCount),
		eventTime: toIsoOrNow(record.time),
		command: asStringOrNull(data?.command) ?? eventType,
		invokedById,
		invokedByUsername,
		invokedByGlobalName,
		rawPayload
	}
}

export const insertEvent = async (normalizedEvent: NormalizedEvent) => {
	await db.insert(helperEvents).values(normalizedEvent)
}

export const listEvents = async ({
	eventType,
	command,
	threadId,
	invokedBy,
	from,
	to,
	limit = 100
}: EventFilters = {}) => {
	const filters = []

	if (eventType) {
		filters.push(eq(helperEvents.eventType, eventType))
	}

	if (command) {
		filters.push(eq(helperEvents.command, command))
	}

	if (threadId) {
		filters.push(eq(helperEvents.threadId, threadId))
	}

	if (invokedBy) {
		filters.push(eq(helperEvents.invokedById, invokedBy))
	}

	const fromIso = parseIsoOrNull(from)
	if (fromIso) {
		filters.push(gte(helperEvents.eventTime, fromIso))
	}

	const toIso = parseIsoOrNull(to)
	if (toIso) {
		filters.push(lte(helperEvents.eventTime, toIso))
	}

	return db
		.select({
			id: helperEvents.id,
			event_type: helperEvents.eventType,
			thread_id: helperEvents.threadId,
			message_count: helperEvents.messageCount,
			event_time: helperEvents.eventTime,
			command: helperEvents.command,
			invoked_by_id: helperEvents.invokedById,
			invoked_by_username: helperEvents.invokedByUsername,
			invoked_by_global_name: helperEvents.invokedByGlobalName,
			received_at: helperEvents.receivedAt
		})
		.from(helperEvents)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(desc(helperEvents.eventTime))
		.limit(Math.min(limit, 500))
}

export const upsertTrackedThread = async (payload: ThreadUpsertPayload) => {
	const threadId = asStringOrNull(payload.threadId)
	if (!threadId) {
		return { error: "threadId is required", status: 400 as const }
	}

	const createdAt = toIsoOrNow(payload.createdAt)
	const lastChecked = parseIsoOrNull(payload.lastChecked)
	const solved = parseBooleanLike(payload.solved)
	const warningLevel = parseNonNegativeInt(payload.warningLevel, 0)
	const closed = parseBooleanLike(payload.closed)
	const lastMessageCount = asNumberOrNull(payload.lastMessageCount)
	const rawPayload = JSON.stringify(payload)

	await db
		.insert(trackedThreads)
		.values({
			threadId,
			createdAt,
			lastChecked,
			solved,
			warningLevel,
			closed,
			lastMessageCount,
			receivedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			rawPayload
		})
		.onConflictDoUpdate({
			target: trackedThreads.threadId,
			set: {
				createdAt,
				lastChecked,
				solved,
				warningLevel,
				closed,
				lastMessageCount,
				receivedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
				rawPayload
			}
		})

	return { ok: true as const }
}

export const listTrackedThreads = async ({
	threadId,
	solved,
	closed,
	limit = 100
}: ThreadFilters = {}) => {
	const filters = []

	if (threadId) {
		filters.push(eq(trackedThreads.threadId, threadId))
	}

	if (solved !== undefined) {
		filters.push(eq(trackedThreads.solved, solved ? 1 : 0))
	}

	if (closed !== undefined) {
		filters.push(eq(trackedThreads.closed, closed ? 1 : 0))
	}

	return db
		.select({
			id: trackedThreads.id,
			thread_id: trackedThreads.threadId,
			created_at: trackedThreads.createdAt,
			last_checked: trackedThreads.lastChecked,
			solved: trackedThreads.solved,
			warning_level: trackedThreads.warningLevel,
			closed: trackedThreads.closed,
			last_message_count: trackedThreads.lastMessageCount,
			received_at: trackedThreads.receivedAt
		})
		.from(trackedThreads)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(sql`coalesce(${trackedThreads.lastChecked}, ${trackedThreads.createdAt}) asc`)
		.limit(Math.min(limit, 500))
}

export type { ThreadUpsertPayload }
