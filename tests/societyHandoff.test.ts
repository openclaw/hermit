import { expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import {
	generateKeyPairSync,
	randomBytes,
	sign,
	privateDecrypt,
	createDecipheriv
} from "node:crypto"
import { SqliteD1Database } from "./helpers/sqliteD1.js"
import { setRuntimeEnv, type HermitEnv } from "../src/runtime/env.js"
import { createNomination } from "../src/data/nominations.js"
import {
	handleSocietyHandoff,
	societyHandoffPath,
	societyIsRetired
} from "../src/services/societyHandoff.js"

function fixture() {
	const owner = new SqliteD1Database()
	for (const file of readdirSync("drizzle")
		.filter((f) => /^000[4-9]_.*\.sql$/.test(f))
		.sort())
		owner.database.exec(readFileSync(`drizzle/${file}`, "utf8"))
	const signing = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
		encryption = generateKeyPairSync("rsa", { modulusLength: 2048 })
	const keys = {
		expiresAt: Date.now() + 3600000,
		signing: signing.publicKey.export({ format: "jwk" }),
		encryption: encryption.publicKey.export({ format: "jwk" })
	}
	const env = {
		DB: owner,
		DISCORD_CLIENT_ID: "986514866749702184",
		DISCORD_BOT_TOKEN: "test-token"
	} as unknown as HermitEnv
	const request = (action: string, extra: Record<string, unknown> = {}) => {
		const raw = JSON.stringify({
			action,
			at: Date.now(),
			nonce: randomBytes(16).toString("hex"),
			...extra
		})
		const signature = sign(
			"sha256",
			Buffer.from(`POST\n${societyHandoffPath}\n${raw}`),
			{ key: signing.privateKey, dsaEncoding: "ieee-p1363" }
		).toString("base64")
		return new Request(`https://example.test${societyHandoffPath}`, {
			method: "POST",
			headers: { "x-society-signature": signature },
			body: raw
		})
	}
	return {
		owner,
		env,
		keys,
		request,
		encryption,
		close() {
			owner.close()
		}
	}
}
it("rejects unsigned, expired, oversized and non-migration requests before touching D1 or Discord", async () => {
	const f = fixture(),
		trap = {
			DB: {
				withSession() {
					throw Error("Unauthorized DB access")
				}
			}
		} as unknown as HermitEnv
	expect(
		await handleSocietyHandoff(
			new Request("https://example.test/elsewhere"),
			trap,
			f.keys
		)
	).toBeNull()
	expect(
		(
			await handleSocietyHandoff(
				new Request(`https://example.test${societyHandoffPath}`),
				trap,
				f.keys
			)
		)?.status
	).toBe(405)
	expect(
		(
			await handleSocietyHandoff(
				new Request(`https://example.test${societyHandoffPath}`, {
					method: "POST",
					body: "{}"
				}),
				trap,
				f.keys
			)
		)?.status
	).toBe(401)
	expect(
		(
			await handleSocietyHandoff(
				f.request("inspect", { at: Date.now() - 130000 }),
				trap,
				f.keys
			)
		)?.status
	).toBe(401)
	expect(
		(await handleSocietyHandoff(f.request("arbitrary_sql"), trap, f.keys))
			?.status
	).toBe(401)
	expect(
		(
			await handleSocietyHandoff(f.request("inspect"), trap, {
				...f.keys,
				expiresAt: Date.now() - 1
			})
		)?.status
	).toBe(410)
	expect(
		(
			await handleSocietyHandoff(
				new Request(`https://example.test${societyHandoffPath}`, {
					method: "POST",
					body: "x".repeat(5000)
				}),
				trap,
				f.keys
			)
		)?.status
	).toBe(401)
	f.close()
})
it("freezes intake atomically, retires only nominate commands and preserves active review/history", async () => {
	const f = fixture(),
		previousFetch = globalThis.fetch
	setRuntimeEnv(f.env)
	const input = {
		guildId: "1456350064065904867",
		channelId: "1519064274561929328",
		nomineeId: "1456350064065904880",
		nominatorId: "1456350064065904881",
		reason: "Synthetic private reason",
		expiresAt: new Date(Date.now() + 86400000).toISOString(),
		targetRoleId: "1470356404706607227",
		requiredApprovals: 3
	}
	expect(await createNomination(input)).not.toBeNull()
	const global = [
			{ id: "123456789012345678", name: "nominate", type: 1 },
			{ id: "123456789012345679", name: "helper", type: 1 }
		],
		guild = [{ id: "123456789012345680", name: "slap", type: 1 }]
	const deleted: string[] = []
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input))
		if (url.hostname !== "discord.com") throw Error("Unexpected host")
		if (url.pathname.endsWith("/users/@me"))
			return Response.json({ id: "986514866749702184", bot: true })
		const rows = url.pathname.includes("/guilds/") ? guild : global
		if (init?.method === "DELETE") {
			const id = url.pathname.split("/").at(-1)!
			deleted.push(id)
			const index = rows.findIndex((c) => c.id === id)
			if (index >= 0) rows.splice(index, 1)
			return new Response(null, { status: 204 })
		}
		return Response.json(rows)
	}
	try {
		const freeze = f.request("freeze"),
			replay = freeze.clone()
		expect((await handleSocietyHandoff(freeze, f.env, f.keys))?.status).toBe(
			200
		)
		expect(deleted).toEqual(["123456789012345678"])
		expect(global.map((c) => c.name)).toEqual(["helper"])
		expect(guild.map((c) => c.name)).toEqual(["slap"])
		expect((await handleSocietyHandoff(replay, f.env, f.keys))?.status).toBe(
			409
		)
		expect(
			await createNomination({ ...input, nomineeId: "1456350064065904882" })
		).toBeNull()
		const active = await handleSocietyHandoff(
			f.request("export"),
			f.env,
			f.keys
		)
		expect(active?.status).toBe(409)
		expect(JSON.stringify(await active?.json())).not.toContain(input.reason)
		expect(await societyIsRetired(f.env)).toBe(false)
		expect(ownerCount(f)).toBe(1)
		f.owner.database.exec(
			"UPDATE nominations SET status='expired',completed_at=updated_at"
		)
		const exported = await handleSocietyHandoff(
			f.request("export"),
			f.env,
			f.keys
		)
		expect(exported?.status).toBe(200)
		const envelope = (await exported!.json()) as {
			key: string
			iv: string
			ciphertext: string
		}
		expect(JSON.stringify(envelope)).not.toContain(input.reason)
		const key = privateDecrypt(
				{ key: f.encryption.privateKey, oaepHash: "sha256" },
				Buffer.from(envelope.key, "base64")
			),
			ciphertext = Buffer.from(envelope.ciphertext, "base64")
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			Buffer.from(envelope.iv, "base64")
		)
		decipher.setAuthTag(ciphertext.subarray(-16))
		const data = JSON.parse(
			Buffer.concat([
				decipher.update(ciphertext.subarray(0, -16)),
				decipher.final()
			]).toString()
		)
		expect(data.nominations[0].reason).toBe(input.reason)
		expect(data.nominations[0].status).toBe("expired")
		expect(data.sourceRetiredAt).toBeLessThanOrEqual(data.exportedAt)
		expect(await societyIsRetired(f.env)).toBe(true)
		expect(ownerCount(f)).toBe(1)
	} finally {
		globalThis.fetch = previousFetch
		f.close()
	}
})
function ownerCount(f: ReturnType<typeof fixture>) {
	return (
		f.owner.database.query("SELECT count(*) n FROM nominations").get() as {
			n: number
		}
	).n
}
