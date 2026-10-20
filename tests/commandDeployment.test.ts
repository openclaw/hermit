import { expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

it("registers commands explicitly, without writing to Discord on Worker requests", async () => {
	const settings = {
		BASE_URL: "https://example.test",
		DEPLOY_SECRET: "test-secret",
		DISCORD_CLIENT_ID: "1",
		DISCORD_PUBLIC_KEY: "00",
		DISCORD_BOT_TOKEN: "test-token"
	}
	const previousEnv = Object.fromEntries(
		Object.keys(settings).map((key) => [key, process.env[key]])
	)
	const previousFetch = globalThis.fetch
	const calls: { method: string; path: string }[] = []
	const registeredNames = new Set<string>()
	const database = new SqliteD1Database()
	const migrations = readdirSync("drizzle")
		.filter((path) => /^000[4-9]_.*\.sql$/.test(path))
		.sort()
	for (const path of migrations) {
		database.database.exec(readFileSync(`drizzle/${path}`, "utf8"))
	}
	Object.assign(process.env, settings)
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input))
		if (url.hostname !== "discord.com") throw new Error("Unexpected request")
		const method = init?.method ?? "GET"
		calls.push({ method, path: url.pathname })
		if (method === "GET") return Response.json([])
		const body = JSON.parse(String(init?.body))
		for (const command of Array.isArray(body) ? body : [body]) if (typeof command.name === "string") registeredNames.add(command.name)
		return Response.json(
			Array.isArray(body)
				? body.map((command, index) => ({ ...command, id: String(index + 1) }))
				: { ...body, id: String(calls.length) }
		)
	}
	try {
		const { default: worker } = await import("../src/index.js")
		const pending: Promise<unknown>[] = []
		const context = {
			waitUntil: (promise: Promise<unknown>) => {
				pending.push(promise)
			}
		} as ExecutionContext
		const request = () => worker.fetch(
			new Request("https://example.test/__registration_test__"),
			settings as unknown as Env,
			context
		)
		expect((await request()).status).toBe(404)
		await Promise.all(pending)
		expect(calls).toEqual([])
		// Retired Society cron must not touch D1 or attempt a role/card operation.
		worker.scheduled(
			{ cron: "*/15 * * * *" } as ScheduledController,
			{ ...settings, DB: { withSession: () => { throw new Error("Retired Society accessed D1") } } } as unknown as Env,
			context
		)
		await Promise.all(pending)
		expect(calls).toEqual([])
		worker.scheduled(
			{ cron: "*/5 * * * *" } as ScheduledController,
			{ ...settings, DB: database } as unknown as Env,
			context
		)
		await Promise.all(pending)
		expect(calls).toEqual([])

		// Exercise the actual operator script and Carbon's pinned HTTP contract.
		await import("../scripts/deploy-commands.ts")
		expect(registeredNames.has("nominate")).toBe(false)
		for (const name of ["lobster", "slap", "role", "claim", "helper", "github"]) expect(registeredNames.has(name)).toBe(true)
		expect(calls.some(({ method, path }) =>
			method === "PUT" && path.includes("/guilds/")
		)).toBe(true)
		expect(calls.some(({ method, path }) =>
			method === "GET" && path === "/api/applications/1/commands"
		)).toBe(true)
		const registrationCalls = calls.length
		expect((await request()).status).toBe(404)
		expect(calls.length).toBe(registrationCalls)
	} finally {
		database.close()
		globalThis.fetch = previousFetch
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
	}
})
