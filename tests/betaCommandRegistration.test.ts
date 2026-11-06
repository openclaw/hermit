import { afterEach, describe, expect, it } from "bun:test"
import { Client, type CommandInteraction, Permission, Routes, serializePayload } from "@buape/carbon"
import BetaCommand from "../src/commands/beta.js"
import BetaPingsCommand from "../src/commands/betaPings.js"
import { betaPingsConfig } from "../src/config/betaPings.js"
import { hydrateRuntimeEnv } from "../src/runtime/env.js"
import { createBetaCommandEnsurer } from "../src/utils/ensureBetaCommand.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const databases: SqliteD1Database[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
let nextId = 100
const expected = () => JSON.parse(JSON.stringify(new BetaCommand().serialize()))
const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>((done) => { resolve = done })
	return { promise, resolve }
}

function fixture() {
	const sqlite = new SqliteD1Database()
	databases.push(sqlite)
	sqlite.database.exec('CREATE TABLE keyValue (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)')
	const db = sqlite as unknown as D1Database
	const client = new Client({
		clientId: String(nextId++), token: "test-token", publicKey: "00",
		baseUrl: "https://example.test", deploySecret: "test-secret",
		requestOptions: { queueRequests: false }, autoDeploy: false, disableDeployRoute: true
	}, { commands: [new BetaPingsCommand()] })
	const route = Routes.applicationGuildCommands(client.options.clientId, betaPingsConfig.guildId)
	let commands: unknown[] = []
	const calls: { method: string; route: string; body?: unknown }[] = []
	let getError = false
	let postError = false
	let postBarrier: Promise<void> | undefined
	const postStarted = deferred()
	client.rest.get = async (path) => {
		calls.push({ method: "GET", route: path })
		if (getError) throw new Error("private upstream failure")
		return structuredClone(commands)
	}
	client.rest.post = async (path, data) => {
		calls.push({ method: "POST", route: path, body: data?.body })
		if (path === route) {
			postStarted.resolve()
			await postBarrier
			if (postError) throw new Error("private upstream failure")
			commands.push({ id: "456", ...data?.body as object })
		}
		return {}
	}
	client.rest.patch = async (path, data) => {
		calls.push({ method: "PATCH", route: path, body: data?.body })
		return { id: "789", channel_id: "123", author: { id: "1", username: "bot" } }
	}
	const raw = (permissions: unknown = String(Permission.ManageRoles), guildId = betaPingsConfig.guildId) => ({
		id: "111", application_id: client.options.clientId, token: "interaction-token", version: 1,
		type: 2, guild_id: guildId, channel_id: "another-channel",
		member: { ...(permissions === "missing" ? {} : { permissions }), roles: [], user: { id: "222", username: "staff" } },
		data: { id: "333", name: "beta-pings", type: 1 }
	})
	const invoke = async (permissions: unknown = String(Permission.ManageRoles), guildId = betaPingsConfig.guildId) => {
		hydrateRuntimeEnv({ DB: db } as Env)
		const replies: ReturnType<typeof serializePayload>[] = []
		const menus: ReturnType<typeof serializePayload>[] = []
		await new BetaPingsCommand().run({ client, rawData: raw(permissions, guildId),
			reply: async (payload: Parameters<typeof serializePayload>[0]) => { replies.push(serializePayload(payload)); },
			followUp: async (payload: Parameters<typeof serializePayload>[0]) => { menus.push(serializePayload(payload)); }
		} as unknown as CommandInteraction)
		return { replies, menus }
	}
	return { sqlite, db, client, route, calls, raw, invoke, postStarted,
		setCommands: (value: unknown[]) => { commands = value },
		setGetError: (value: boolean) => { getError = value },
		setPostError: (value: boolean) => { postError = value },
		setPostBarrier: (value: Promise<void>) => { postBarrier = value }
	}
}
const creates = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.method === "POST" && call.route === f.route)
const privateFailure = (result: Awaited<ReturnType<ReturnType<typeof fixture>["invoke"]>>) => {
	expect(result.menus).toHaveLength(0)
	expect(result.replies).toHaveLength(1)
	expect(Number(result.replies[0]?.flags) & 64).toBe(64)
}

describe("explicit /beta-pings registration", () => {
	it.each(["0", "missing", null, "invalid", "-1"])("rejects missing/invalid or ordinary permissions: %s", async (permissions) => {
		const f = fixture()
		const result = await f.invoke(permissions)
		privateFailure(result)
		expect(f.calls).toHaveLength(0)
	})
	it("rejects a wrong guild before network or database work", async () => {
		const f = fixture()
		privateFailure(await f.invoke(String(Permission.Administrator), "wrong"))
		expect(f.calls).toHaveLength(0)
	})
	it.each([Permission.ManageRoles, Permission.Administrator])("allows permission %s and creates only exact /beta", async (permission) => {
		const f = fixture()
		const unrelated = { name: "other", type: 1, id: "999", description: "Do not touch" }
		f.setCommands([unrelated])
		const result = await f.invoke(String(permission))
		expect(creates(f)).toEqual([{ method: "POST", route: f.route, body: new BetaCommand().serialize() }])
		expect(f.calls.every((call) => call.route === f.route)).toBe(true)
		expect(await f.client.rest.get(f.route)).toEqual([unrelated, { id: "456", ...expected() }])
		expect(Number(result.replies[0]?.flags) & 64).toBe(64)
		expect(Number(result.menus[0]?.flags)).toBe(32768)
		expect(JSON.stringify(result.menus)).toContain(betaPingsConfig.copy.title)
	})
	it("does not write when existing metadata is correct and rechecks every invocation", async () => {
		const f = fixture()
		f.setCommands([{ ...expected(), options: [], nsfw: false, name_localizations: null, description_localizations: null }])
		await f.invoke()
		await f.invoke()
		expect(f.calls.map((call) => call.method)).toEqual(["GET", "GET"])
		expect(f.sqlite.database.query('SELECT * FROM keyValue').all()).toHaveLength(0)
	})
	it("accepts guild API omission of global-only contexts and integration types", async () => {
		const f = fixture()
		const command = expected()
		delete command.contexts
		delete command.integration_types
		f.setCommands([command])
		expect((await f.invoke()).menus).toHaveLength(1)
		expect(creates(f)).toHaveLength(0)
	})
	it.each([
		{ description: "different" }, { options: [{ name: "target", type: 6 }] },
		{ default_member_permissions: "0" }, { contexts: [1] }, { integration_types: [1] },
		{ type: 2 }, { nsfw: true }, { name_localizations: { de: "test" } }
	])("refuses conflicting metadata without overwriting: %j", async (change) => {
		const f = fixture()
		f.setCommands([{ ...expected(), ...change }])
		privateFailure(await f.invoke())
		expect(creates(f)).toHaveLength(0)
	})
	it("fails privately on GET failure without disclosing upstream errors", async () => {
		const f = fixture()
		f.setGetError(true)
		const result = await f.invoke()
		privateFailure(result)
		expect(JSON.stringify(result.replies)).not.toContain("private upstream")
		f.setGetError(false)
		expect((await f.invoke()).menus).toHaveLength(1)
	})
	it("coalesces concurrent same-isolate commands into one create", async () => {
		const f = fixture()
		const barrier = deferred()
		f.setPostBarrier(barrier.promise)
		const first = f.invoke()
		await f.postStarted.promise
		const second = f.invoke()
		barrier.resolve()
		const results = await Promise.all([first, second])
		expect(creates(f)).toHaveLength(1)
		for (const result of results) expect(result.menus).toHaveLength(1)
	})
	it("uses D1 to exclude separate isolate runners without expiring the writer", async () => {
		const f = fixture()
		const barrier = deferred()
		f.setPostBarrier(barrier.promise)
		const first = createBetaCommandEnsurer()(f.client, f.db)
		await f.postStarted.promise
		await expect(createBetaCommandEnsurer()(f.client, f.db)).rejects.toThrow("pending or was already attempted")
		barrier.resolve()
		await first
		expect(creates(f)).toHaveLength(1)
	})
	it("rechecks after uncertain POST failure but never blindly retries, even in a new isolate", async () => {
		const f = fixture()
		f.setPostError(true)
		privateFailure(await f.invoke())
		f.setPostError(false)
		privateFailure(await f.invoke())
		await expect(createBetaCommandEnsurer()(f.client, f.db)).rejects.toThrow("pending or was already attempted")
		expect(creates(f)).toHaveLength(1)
		f.setCommands([expected()])
		expect((await f.invoke()).menus).toHaveLength(1)
		expect(creates(f)).toHaveLength(1)
	})
	it("fails closed if Carbon automatic retries become enabled", async () => {
		const f = fixture()
		f.client.rest.options.queueRequests = true
		privateFailure(await f.invoke())
		expect(f.calls).toHaveLength(0)
	})
	it("fails closed on database failure without creating a command", async () => {
		const f = fixture()
		f.db.prepare = () => { throw new Error("database unavailable") }
		privateFailure(await f.invoke())
		expect(creates(f)).toHaveLength(0)
	})
	it("does not create after an external conflict appears during the guarded recheck", async () => {
		const f = fixture()
		let reads = 0
		f.client.rest.get = async () => ++reads === 1 ? [] : [{ ...expected(), description: "external edit" }]
		privateFailure(await f.invoke())
		expect(creates(f)).toHaveLength(0)
	})
	it("requires successful readback before publishing a menu", async () => {
		const f = fixture()
		f.client.rest.get = async () => []
		privateFailure(await f.invoke())
		expect(creates(f)).toHaveLength(1)
		privateFailure(await f.invoke())
		expect(creates(f)).toHaveLength(1)
	})
	it("does not retry a rate-limited create", async () => {
		const f = fixture()
		let posts = 0
		f.client.rest.post = async () => { posts++; throw { status: 429, retry_after: 30 } }
		privateFailure(await f.invoke())
		privateFailure(await f.invoke())
		expect(posts).toBe(1)
	})
	it("rejects malformed command listings and duplicate beta names", async () => {
		for (const commands of [[null], [expected(), expected()]]) {
			const f = fixture()
			f.setCommands(commands)
			privateFailure(await f.invoke())
			expect(creates(f)).toHaveLength(0)
		}
	})
	it("scopes durable registration intent to the application and guild", async () => {
		const first = fixture()
		const second = fixture()
		const ensure = createBetaCommandEnsurer()
		await ensure(first.client, first.db)
		await ensure(second.client, first.db)
		expect(creates(first)).toHaveLength(1)
		expect(creates(second)).toHaveLength(1)
		const keys = first.sqlite.database.query('SELECT key FROM keyValue').all()
		expect(keys).toEqual([
			{ key: "beta-command-registration:v1:" + first.client.options.clientId + ":" + betaPingsConfig.guildId },
			{ key: "beta-command-registration:v1:" + second.client.options.clientId + ":" + betaPingsConfig.guildId }
		])
	})
	it("real Carbon dispatcher keeps authorization failures private without public followups", async () => {
		const f = fixture()
		hydrateRuntimeEnv({ DB: f.db } as Env)
		await f.client.commandHandler.handleCommandInteraction(f.raw("0") as never)
		expect(f.calls.map((call) => call.method)).toEqual(["POST", "PATCH"])
		expect((f.calls[0]?.body as { data: { flags: number } }).data.flags).toBe(64)
		expect((f.calls[1]?.body as { flags: number }).flags).toBe(32832)
	})
	it("real Carbon dispatcher defers privately, edits privately, then posts a public menu", async () => {
		const f = fixture()
		f.setCommands([expected()])
		hydrateRuntimeEnv({ DB: f.db } as Env)
		await f.client.commandHandler.handleCommandInteraction(f.raw() as never)
		const callback = f.calls.find((call) => call.route.includes("callback"))
		expect(callback?.body).toEqual({ type: 5, data: { flags: 64 } })
		const acknowledgement = f.calls.find((call) => call.method === "PATCH")
		expect(Number((acknowledgement?.body as { flags: number }).flags)).toBe(32832)
		const menu = f.calls.find((call) => call.method === "POST" && call.route.includes("/webhooks/"))
		expect(Number((menu?.body as { flags: number }).flags)).toBe(32768)
		expect(f.calls.indexOf(acknowledgement!)).toBeLessThan(f.calls.indexOf(menu!))
	})
})
