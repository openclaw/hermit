// Temporary, signed migration surface. No credential export or generic admin action.
// Removed with nomination runtime after the one-owner handoff is verified.
import publicKeys from "../config/society-handoff.json" with { type: "json" }
import type { HermitEnv } from "../runtime/env.js"

export const societyHandoffPath = "/api/migrations/shell-society"
const ownershipKey = "shell-society-owner-v1"
const applicationId = "986514866749702184"
const guildId = "1456350064065904867"
type Ownership = {
	mode: "frozen" | "retired"
	frozenAt: number
	retiredAt?: number
}
type PublicKeys = {
	expiresAt: number
	signing: JsonWebKey
	encryption: JsonWebKey
}
const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store" }
	})
const bytes = (value: string) =>
	Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
const base64 = (value: ArrayBuffer) => {
	const raw = new Uint8Array(value)
	let text = ""
	for (let start = 0; start < raw.length; start += 8192)
		text += String.fromCharCode(...raw.subarray(start, start + 8192))
	return btoa(text)
}
const primary = (env: HermitEnv) => env.DB.withSession("first-primary")

export async function societyOwnership(
	db: D1Database | D1DatabaseSession
): Promise<Ownership | null> {
	const row = await db
		.prepare("SELECT value FROM keyValue WHERE key=?")
		.bind(ownershipKey)
		.first<{ value: string }>()
	return row ? (JSON.parse(row.value) as Ownership) : null
}
export async function societyIsFrozen(env: HermitEnv) {
	return !!(await societyOwnership(primary(env)))
}
export async function societyIsRetired(env: HermitEnv) {
	return (await societyOwnership(primary(env)))?.mode === "retired"
}

async function encrypted(value: unknown, keys: PublicKeys) {
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt"]
	)
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const recipient = await crypto.subtle.importKey(
		"jwk",
		keys.encryption,
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["encrypt"]
	)
	const payload = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(JSON.stringify(value))
	)
	const sealed = await crypto.subtle.encrypt(
		{ name: "RSA-OAEP" },
		recipient,
		await crypto.subtle.exportKey("raw", key)
	)
	return {
		version: 1,
		algorithm: "RSA-OAEP-SHA256+AES-256-GCM",
		key: base64(sealed),
		iv: base64(iv.buffer),
		ciphertext: base64(payload)
	}
}
async function boundedBody(request: Request) {
	const reader = request.body?.getReader()
	if (!reader) throw Error("Missing body")
	let size = 0
	const chunks: Uint8Array[] = []
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		size += value.byteLength
		if (size > 4096) {
			await reader.cancel()
			throw Error("Oversized body")
		}
		chunks.push(value)
	}
	const all = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		all.set(chunk, offset)
		offset += chunk.length
	}
	return new TextDecoder().decode(all)
}
async function discord(env: HermitEnv, path: string, method = "GET") {
	const response = await fetch(`https://discord.com/api/v10${path}`, {
		method,
		headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
		redirect: "error",
		signal: AbortSignal.timeout(15000)
	})
	if (method === "DELETE" && [204, 404].includes(response.status)) return null
	if (!response.ok) throw Error(`Discord ${response.status}`)
	return response.json()
}
async function retireCommand(env: HermitEnv) {
	if (env.DISCORD_CLIENT_ID !== applicationId)
		throw Error("Application mismatch")
	const me = (await discord(env, "/users/@me")) as {
		id?: string
		bot?: boolean
	}
	if (me.id !== applicationId || me.bot !== true)
		throw Error("Bot identity mismatch")
	let removed = 0
	for (const path of [
		`/applications/${applicationId}/commands`,
		`/applications/${applicationId}/guilds/${guildId}/commands`
	]) {
		const rows = await discord(env, path)
		if (
			!Array.isArray(rows) ||
			rows.some(
				(c) =>
					!c ||
					typeof c.id !== "string" ||
					!/^\d+$/.test(c.id) ||
					typeof c.name !== "string" ||
					!Number.isInteger(c.type)
			)
		)
			throw Error("Malformed command inventory")
		for (const command of rows)
			if (command.name === "nominate" && command.type === 1) {
				await discord(env, `${path}/${command.id}`, "DELETE")
				removed++
			}
		const after = await discord(env, path)
		if (
			!Array.isArray(after) ||
			after.some((c) => c.name === "nominate" && c.type === 1)
		)
			throw Error("Command retirement readback failed")
	}
	return removed
}

export async function handleSocietyHandoff(
	request: Request,
	env: HermitEnv,
	keys: PublicKeys = publicKeys
): Promise<Response | null> {
	if (new URL(request.url).pathname !== societyHandoffPath) return null
	if (request.method !== "POST")
		return json({ error: "method_not_allowed" }, 405)
	let raw: string,
		body: { action: "inspect" | "freeze" | "export"; at: number; nonce: string }
	try {
		if (keys.expiresAt <= Date.now())
			return json({ error: "migration_window_closed" }, 410)
		raw = await boundedBody(request)
		body = JSON.parse(raw)
		if (
			!body ||
			!["inspect", "freeze", "export"].includes(body.action) ||
			!Number.isSafeInteger(body.at) ||
			Math.abs(Date.now() - body.at) > 120000 ||
			!/^[a-f0-9]{32}$/.test(body.nonce)
		)
			throw Error("Invalid request")
		const key = await crypto.subtle.importKey(
			"jwk",
			keys.signing,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"]
		)
		if (
			!(await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				key,
				bytes(request.headers.get("x-society-signature") ?? ""),
				new TextEncoder().encode(`POST\n${societyHandoffPath}\n${raw}`)
			))
		)
			throw Error("Invalid signature")
	} catch {
		return json({ error: "unauthorized" }, 401)
	}
	if (env.DISCORD_CLIENT_ID !== applicationId)
		return json({ error: "wrong_application" }, 409)
	try {
		const db = primary(env),
			now = Date.now()
		const claim = await db
			.prepare(
				"INSERT INTO keyValue(key,value,createdAt,updatedAt) VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING RETURNING key"
			)
			.bind(`society-handoff-nonce:${body.nonce}`, "used", now, now)
			.all()
		if (!claim.results.length) return json({ error: "replayed_request" }, 409)
		if (body.action === "freeze") {
			await db
				.prepare(
					"INSERT INTO keyValue(key,value,createdAt,updatedAt) VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING"
				)
				.bind(
					ownershipKey,
					JSON.stringify({ mode: "frozen", frozenAt: now }),
					now,
					now
				)
				.run()
			const removed = await retireCommand(env)
			return json({
				frozen: true,
				removed,
				ownership: await societyOwnership(db)
			})
		}
		if (body.action === "export") {
			const owner = await societyOwnership(db)
			if (!owner) return json({ error: "freeze_required" }, 409)
			const retired = {
				...owner,
				mode: "retired",
				retiredAt: owner.retiredAt ?? now
			}
			await db
				.prepare(
					`UPDATE keyValue SET value=?,updatedAt=? WHERE key=?
				AND NOT EXISTS(SELECT 1 FROM nominations WHERE status IN ('submitted','granting'))
				AND NOT EXISTS(SELECT 1 FROM nominations WHERE message_id IS NOT NULL AND desired_card_revision>synced_card_revision)`
				)
				.bind(JSON.stringify(retired), now, ownershipKey)
				.run()
		}
		const results = await db.batch([
			db.prepare("SELECT value FROM keyValue WHERE key=?").bind(ownershipKey),
			db.prepare("SELECT * FROM nominations ORDER BY id"),
			db.prepare(
				"SELECT * FROM nomination_approvals ORDER BY nomination_id,approver_id"
			)
		])
		const ownerRow = results[0].results[0] as { value?: string } | undefined
		const ownership = ownerRow?.value
			? (JSON.parse(ownerRow.value) as Ownership)
			: null
		const nominations = results[1].results as Record<string, unknown>[],
			votes = results[2].results
		const summary = {
			mode: ownership?.mode ?? "active",
			nominations: nominations.length,
			votes: votes.length,
			active: nominations.filter((n) => n.status === "submitted").length,
			granting: nominations.filter((n) => n.status === "granting").length,
			pendingCards: nominations.filter(
				(n) =>
					n.message_id !== null &&
					Number(n.desired_card_revision) > Number(n.synced_card_revision)
			).length
		}
		if (body.action === "inspect") return json(summary)
		if (
			ownership?.mode !== "retired" ||
			summary.active ||
			summary.granting ||
			summary.pendingCards
		)
			return json({ error: "source_work_pending", ...summary }, 409)
		return json(
			await encrypted(
				{
					schemaVersion: 1,
					source: "hermit",
					applicationId,
					guildId,
					exportedAt: now,
					sourceRetiredAt: ownership.retiredAt,
					nominations,
					votes
				},
				keys
			)
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : ""
		const detail = /^(Discord \d{3}|Application mismatch|Bot identity mismatch|Malformed command inventory|Command retirement readback failed)$/.test(message) ? message : "internal"
		return json({ error: "handoff_failed", detail }, 502)
	}
}
