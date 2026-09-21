import {
	Routes,
	TextDisplay,
	serializePayload,
	type Client
} from "@buape/carbon"
import { formSettings } from "../../forms.config.js"
import { getRuntimeEnv } from "../runtime/env.js"

type Delivery = {
	version: 1
	hash: string
	status: "sending" | "sent" | "retryable" | "uncertain"
	startedAt: number
	messageId?: string
}
const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	if (value && typeof value === "object")
		return (
			"{" +
			Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
				.join(",") +
			"}"
		)
	return JSON.stringify(value)
}
const hash = async (value: string) =>
	Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		),
		(byte) => byte.toString(16).padStart(2, "0")
	).join("")
const response = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" }
	})

const componentText = (value: unknown): string[] => {
	if (!value || typeof value !== "object") return []
	const row = value as {
		content?: unknown
		components?: unknown
		type?: unknown
		url?: unknown
		label?: unknown
	}
	return [
		...(typeof row.content === "string" ? [row.content] : []),
		// Full lineups carry candidate identities in link buttons. Reconciliation
		// must match those destinations as well as the human-readable text.
		...(row.type === 2 && typeof row.url === "string"
			? [canonical({ url: row.url, label: row.label })]
			: []),
		...(Array.isArray(row.components)
			? row.components.flatMap(componentText)
			: [])
	]
}
// Discord's enforce_nonce is only a few-minute safeguard. An uncertain send is
// reconciled read-only; absence from bounded history is NOT permission to resend.
const findDeliveredMessage = async (
	client: Client,
	body: ReturnType<typeof serializePayload>,
	startedAt: number
): Promise<string | null> => {
	const botId = getRuntimeEnv().DISCORD_CLIENT_ID
	if (!botId) return null
	const expected = JSON.stringify(
		(body.components ?? []).flatMap(componentText)
	)
	let before: string | undefined
	for (let page = 0; page < 5; page++) {
		const messages = await client.rest.get(
			Routes.channelMessages(formSettings.clawhubAppealReviewChannelId),
			{ limit: 100, ...(before ? { before } : {}) }
		)
		if (!Array.isArray(messages)) return null
		for (const message of messages) {
			if (!message || typeof message !== "object") continue
			const time = Date.parse(message.timestamp)
			if (!Number.isFinite(time) || time < startedAt - 60_000) continue
			if (
				message.author?.id === botId &&
				message.author?.bot === true &&
				typeof message.id === "string" &&
				Array.isArray(message.components) &&
				JSON.stringify(message.components.flatMap(componentText)) === expected
			)
				return message.id
		}
		const oldest = messages.at(-1)
		if (
			messages.length < 100 ||
			!oldest ||
			typeof oldest.id !== "string" ||
			oldest.id === before ||
			Date.parse(oldest.timestamp) < startedAt - 60_000
		)
			return null
		before = oldest.id
	}
	return null
}

type DigestIdentity = {
	kind?: string
	weekStart: number
	weekEnd: number
	dashboardUrl: string
}
type MessageBody = ReturnType<typeof serializePayload>
const fingerprint = (body: MessageBody, value: string): MessageBody => ({
	...body,
	components: [
		...(body.components ?? []),
		...(serializePayload({
			components: [new TextDisplay(`-# Report ${value}`)]
		}).components ?? [])
	]
})
export const deliverWeeklyDigest = async (
	client: Client,
	digest: DigestIdentity,
	rendered: MessageBody | MessageBody[]
): Promise<Response> => {
	const key = `clawhub-search-weekly:${new URL(digest.dashboardUrl).origin}:${digest.weekStart}`
	const payloadHash = await hash(canonical(digest))
	if (!Array.isArray(rendered))
		return deliverMessage(
			client,
			digest,
			digest.kind === "search_intelligence_weekly_v3"
				? fingerprint(rendered, payloadHash)
				: rendered,
			key,
			payloadHash
		)
	// The existing weekly key freezes the whole report. Each deterministic part
	// uses the same claim/reconciliation owner; a lost part never resends prior parts.
	const db = getRuntimeEnv().DB.withSession("first-primary")
	const startedAt = Date.now()
	const partHashes = await Promise.all(
		rendered.map((body) => hash(canonical(body)))
	)
	const claim = {
		version: 2,
		hash: payloadHash,
		status: "sending",
		startedAt,
		partHashes
	}
	const serialized = JSON.stringify(claim)
	await db
		.prepare(
			"INSERT INTO keyValue (key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key"
		)
		.bind(key, serialized, startedAt, startedAt)
		.first()
	const existing = await db
		.prepare("SELECT value FROM keyValue WHERE key = ?")
		.bind(key)
		.first<{ value: string }>()
	if (!existing) return response({ error: "Delivery state unavailable" }, 503)
	const state = JSON.parse(existing.value) as typeof claim
	if (state.hash !== payloadHash || state.version !== 2)
		return response({ error: "Weekly payload conflict" }, 409)
	const success = () =>
		response({ ok: true, delivered: true, weekEnd: digest.weekEnd })
	// A completed receipt acknowledges the same report across presentation changes.
	// Incomplete deliveries stay bound to their original parts to prevent duplicates.
	if (state.status === "sent") return success()
	if (canonical(state.partHashes) !== canonical(partHashes))
		return response({ error: "Weekly payload conflict" }, 409)
	for (let index = 0; index < rendered.length; index++) {
		const result = await deliverMessage(
			client,
			digest,
			fingerprint(
				rendered[index],
				`${payloadHash} · ${index + 1}/${rendered.length}`
			),
			`${key}:part:${index + 1}`,
			payloadHash
		)
		if (!result.ok) return result
	}
	const saved = await db
		.prepare(
			"UPDATE keyValue SET value = ?, updatedAt = ? WHERE key = ? AND value = ? RETURNING key"
		)
		.bind(
			JSON.stringify({ ...state, status: "sent" }),
			Date.now(),
			key,
			existing.value
		)
		.first()
	return saved
		? success()
		: response({ error: "Delivery receipt pending" }, 503)
}
const deliverMessage = async (
	client: Client,
	digest: DigestIdentity,
	body: MessageBody,
	key: string,
	payloadHash: string
): Promise<Response> => {
	const db = getRuntimeEnv().DB.withSession("first-primary")
	const claim: Delivery = {
		version: 1,
		hash: payloadHash,
		status: "sending",
		startedAt: Date.now()
	}
	const serialized = JSON.stringify(claim)
	const inserted = await db
		.prepare(
			"INSERT INTO keyValue (key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key"
		)
		.bind(key, serialized, claim.startedAt, claim.startedAt)
		.first()
	const success = () =>
		response({ ok: true, delivered: true, weekEnd: digest.weekEnd })
	const save = (next: Delivery, previous = serialized) =>
		db
			.prepare(
				"UPDATE keyValue SET value = ?, updatedAt = ? WHERE key = ? AND value = ? RETURNING key"
			)
			.bind(JSON.stringify(next), Date.now(), key, previous)
			.first()
	if (!inserted) {
		const existing = await db
			.prepare("SELECT value FROM keyValue WHERE key = ?")
			.bind(key)
			.first<{ value: string }>()
		if (!existing) return response({ error: "Delivery state unavailable" }, 503)
		const state = JSON.parse(existing.value) as Delivery
		if (state.hash !== payloadHash)
			return response({ error: "Weekly payload conflict" }, 409)
		if (state.status === "sent") return success()
		if (state.status !== "retryable") {
			if (state.status === "sending" && Date.now() - state.startedAt < 120_000)
				return response({ error: "Delivery pending" }, 409)
			const messageId = await findDeliveredMessage(
				client,
				body,
				state.startedAt
			)
			if (!messageId)
				return response(
					{ error: "Delivery uncertain; reconciliation required" },
					503
				)
			return (await save(
				{ ...state, status: "sent", messageId },
				existing.value
			))
				? success()
				: response({ error: "Delivery receipt pending" }, 503)
		}
		if (!(await save(claim, existing.value)))
			return response({ error: "Delivery pending" }, 409)
	}
	let message: unknown
	try {
		message = await client.rest.post(
			Routes.channelMessages(formSettings.clawhubAppealReviewChannelId),
			{
				body: {
					...body,
					nonce: (await hash(key)).slice(0, 25),
					enforce_nonce: true
				}
			}
		)
	} catch (error) {
		const status =
			error && typeof error === "object" && "status" in error
				? error.status
				: null
		// Only an explicit rejection proves Discord did not accept a message.
		const rejected =
			typeof status === "number" &&
			status >= 400 &&
			status < 500 &&
			status !== 408
		await save({ ...claim, status: rejected ? "retryable" : "uncertain" })
		return response(
			{ error: rejected ? "Discord rejected delivery" : "Delivery uncertain" },
			rejected ? 502 : 503
		)
	}
	if (
		!message ||
		typeof message !== "object" ||
		!("id" in message) ||
		typeof message.id !== "string" ||
		!message.id
	) {
		await save({ ...claim, status: "uncertain" })
		return response({ error: "Delivery uncertain" }, 503)
	}
	const saved = await save({ ...claim, status: "sent", messageId: message.id })
	return saved
		? success()
		: response({ error: "Delivery receipt pending" }, 503)
}
