import { afterEach, expect, it } from "bun:test"
import { type Client, Routes } from "@buape/carbon"
import NominateCommand from "../src/commands/nominate.js"
import { nominationConfig } from "../src/config/nominations.js"
import {
	nominationCommandCheckIntervalMs,
	runNominationCommandRecovery
} from "../src/services/nominationCommandRecovery.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

type RegisteredCommand = { id: string; name: string; type: number }
const databases: SqliteD1Database[] = []
afterEach(() => {
	for (const database of databases.splice(0)) database.close()
})

const fixture = () => {
	const database = new SqliteD1Database()
	databases.push(database)
	database.database.exec(`CREATE TABLE keyValue (
		key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL,
		createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
	)`)
	const applicationId = "123456789"
	const globalRoute = Routes.applicationCommands(applicationId)
	const guildRoute = Routes.applicationGuildCommands(applicationId, nominationConfig.guildId)
	let time = 1_800_000_000_000
	const globalCommands: RegisteredCommand[] = []
	const guildCommands: RegisteredCommand[] = []
	const calls: { method: string; path: string; body?: unknown }[] = []
	const command = new NominateCommand()
	const client = {
		options: { clientId: applicationId },
		commands: [command],
		rest: {
			get: async (path: string): Promise<unknown> => {
				calls.push({ method: "GET", path })
				if (path === globalRoute) return [...globalCommands]
				if (path === guildRoute) return [...guildCommands]
				throw new Error("Unexpected route")
			},
			post: async (path: string, options: { body: object }) => {
				calls.push({ method: "POST", path, body: options.body })
				const result = { ...options.body, id: "111" } as RegisteredCommand
				globalCommands.push(result)
				return result
			}
		}
	}
	const env = {
		DB: database as unknown as D1Database,
		DISCORD_CLIENT_ID: applicationId
	}
	return {
		database, client, env, calls, globalCommands, guildCommands,
		command, globalRoute, guildRoute,
		advance: (milliseconds: number) => { time += milliseconds },
		run: () => runNominationCommandRecovery(client as unknown as Client, env, { now: () => time })
	}
}

it("creates only missing nominate with the real command payload, never bulk-overwriting", async () => {
	const f = fixture()
	expect(await f.run()).toBe("created")
	expect(f.calls).toEqual([
		{ method: "GET", path: f.globalRoute },
		{ method: "GET", path: f.guildRoute },
		{ method: "POST", path: f.globalRoute, body: f.command.serialize() }
	])
	expect(f.command.serialize()).toMatchObject({
		name: "nominate", type: 1, contexts: [0], integration_types: [0],
		options: [
			{ name: "user", type: 6, required: true },
			{ name: "reason", type: 3, required: true, max_length: 500 }
		]
	})
})

it("does not modify an existing global command or other application commands", async () => {
	const f = fixture()
	f.globalCommands.push({ id: "existing", name: "nominate", type: 1 })
	expect(await f.run()).toBe("present")
	expect(f.calls).toEqual([{ method: "GET", path: f.globalRoute }])
})

it("does not create a global duplicate when a guild slash command exists", async () => {
	const f = fixture()
	f.guildCommands.push({ id: "existing-guild", name: "nominate", type: 1 })
	expect(await f.run()).toBe("present")
	expect(f.calls.map((call) => call.method)).toEqual(["GET", "GET"])
})

it("does not confuse a context-menu command with the slash command", async () => {
	const f = fixture()
	f.globalCommands.push({ id: "menu", name: "nominate", type: 2 })
	expect(await f.run()).toBe("created")
	expect(f.globalCommands).toHaveLength(2)
})

it("uses a durable claim across concurrent cold Worker instances", async () => {
	const f = fixture()
	const results = await Promise.all(Array.from({ length: 20 }, () => f.run()))
	expect(results.filter((result) => result === "created")).toHaveLength(1)
	expect(results.filter((result) => result === "skipped")).toHaveLength(19)
	expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1)
})

it("checks at most hourly and re-reads Discord before any later repair", async () => {
	const f = fixture()
	expect(await f.run()).toBe("created")
	f.advance(nominationCommandCheckIntervalMs - 1)
	expect(await f.run()).toBe("skipped")
	f.advance(1)
	expect(await f.run()).toBe("present")
	expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1)
	// A subsequently removed command can be repaired on the next bounded check.
	f.globalCommands.length = 0
	f.advance(nominationCommandCheckIntervalMs)
	expect(await f.run()).toBe("created")
})

it("fails closed on unreadable or malformed inventories", async () => {
	for (const inventory of [null, {}, [{ name: "nominate" }]]) {
		const f = fixture()
		f.client.rest.get = async (path) => {
			f.calls.push({ method: "GET", path })
			return inventory
		}
		expect(await f.run()).toBe("failed")
		expect(f.calls).toEqual([{ method: "GET", path: f.globalRoute }])
		expect(await f.run()).toBe("skipped")
	}
})

it("never registers when the guild inventory lookup fails", async () => {
	const f = fixture()
	const get = f.client.rest.get
	f.client.rest.get = async (path) => {
		if (path === f.guildRoute) throw { status: 403 }
		return get(path)
	}
	expect(await f.run()).toBe("failed")
	expect(f.calls.some((call) => call.method === "POST")).toBe(false)
	expect(await f.run()).toBe("skipped")
})

it("reconciles an uncertain create against inventory instead of repeating it blindly", async () => {
	const f = fixture()
	const post = f.client.rest.post
	f.client.rest.post = async (path, options) => {
		await post(path, options)
		throw new Error("Response lost after creation")
	}
	expect(await f.run()).toBe("failed")
	expect(await f.run()).toBe("skipped")
	f.advance(nominationCommandCheckIntervalMs)
	expect(await f.run()).toBe("present")
	expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1)
})

it("honors Discord retry-after longer than its normal cooldown", async () => {
	const f = fixture()
	const get = f.client.rest.get
	f.client.rest.get = async () => { throw { status: 429, retryAfter: 7200 } }
	expect(await f.run()).toBe("failed")
	f.client.rest.get = get
	f.advance(nominationCommandCheckIntervalMs)
	expect(await f.run()).toBe("skipped")
	f.advance(nominationCommandCheckIntervalMs)
	expect(await f.run()).toBe("created")
})

it("does not call Discord when durable coordination is unavailable", async () => {
	const f = fixture()
	f.database.database.exec("DROP TABLE keyValue")
	expect(await f.run()).toBe("failed")
	expect(f.calls).toEqual([])
})

it("skips dev-guild mode and mismatched applications", async () => {
	const f = fixture()
	Object.assign(f.client.options, { devGuilds: ["development"] })
	expect(await f.run()).toBe("skipped")
	Object.assign(f.client.options, { devGuilds: undefined, clientId: "different" })
	expect(await f.run()).toBe("skipped")
	expect(f.calls).toEqual([])
})

it("fails closed on corrupt durable cooldown values", async () => {
	for (const value of ["garbage", "", "0garbage", "01", "-1", "1.5", "1e3", "9007199254740992"]) {
		const f = fixture()
		f.database.database.query(
			"INSERT INTO keyValue (key, value, createdAt, updatedAt) VALUES (?, ?, 0, 0)"
		).run(`command-recovery:nominate:${f.env.DISCORD_CLIENT_ID}`, value)
		expect(await f.run()).toBe("failed")
		expect(f.calls).toEqual([])
	}
})

it("fails closed on malformed guild inventories after a valid empty global inventory", async () => {
	const f = fixture()
	const get = f.client.rest.get
	f.client.rest.get = async (path) => {
		if (path === f.guildRoute) {
			f.calls.push({ method: "GET", path })
			return { error: "not an inventory" }
		}
		return get(path)
	}
	expect(await f.run()).toBe("failed")
	expect(f.calls.map((call) => call.method)).toEqual(["GET", "GET"])
})

it("does not report success without a confirmed registration response", async () => {
	const f = fixture()
	f.client.rest.post = async () => ({ id: "", name: "nominate", type: 1 })
	expect(await f.run()).toBe("failed")
	expect(await f.run()).toBe("skipped")
})
