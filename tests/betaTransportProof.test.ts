import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { Client, Permission, RequestClient, Routes } from "@buape/carbon"
import BetaCommand from "../src/commands/beta.js"
import BetaPingsCommand from "../src/commands/betaPings.js"
import { betaPingsConfig } from "../src/config/betaPings.js"
import { hydrateRuntimeEnv } from "../src/runtime/env.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const callerId = "900000000000000002"
const otherId = "900000000000000003"
const channelId = "900000000000000004"
const interactionId = "900000000000000005"
const unrelatedRoleId = "900000000000000006"
const token = "fixture-interaction-token"
let nextApplicationId = 900000000000000100n
const databases: SqliteD1Database[] = []
let networkGuard: ReturnType<typeof spyOn<typeof globalThis, "fetch">>
beforeEach(() => {
	// The pinned RequestClient must use only our injected fetch. No real network.
	const denyNetwork = () => { throw new Error("Unexpected real network access in transport proof") }
	networkGuard = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
		async () => denyNetwork(), { preconnect: denyNetwork }
	))
})
afterEach(() => {
	expect(networkGuard).not.toHaveBeenCalled()
	networkGuard.mockRestore()
	for (const database of databases.splice(0)) database.close()
})

type Effect = { method: string; path: string; body?: Record<string, unknown>; authorization: string | null }

function fixture(callerHasRole = false) {
	const applicationId = String(nextApplicationId++)
	const sqlite = new SqliteD1Database()
	databases.push(sqlite)
	sqlite.database.exec('CREATE TABLE keyValue (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)')
	hydrateRuntimeEnv({ DB: sqlite as unknown as D1Database } as Env)
	const commandRoute = Routes.applicationGuildCommands(applicationId, betaPingsConfig.guildId)
	const callbackRoute = Routes.interactionCallback(interactionId, token)
	const originalRoute = Routes.webhookMessage(applicationId, token, "@original")
	const followupRoute = Routes.webhook(applicationId, token)
	const memberRoute = Routes.guildMember(betaPingsConfig.guildId, callerId)
	const roleRoute = Routes.guildMemberRole(betaPingsConfig.guildId, callerId, betaPingsConfig.roleId)
	const roles = new Map([
		[callerId, [unrelatedRoleId, ...(callerHasRole ? [betaPingsConfig.roleId] : [])]],
		[otherId, callerHasRole ? [unrelatedRoleId] : [unrelatedRoleId, betaPingsConfig.roleId]]
	])
	const unrelatedCommand = { id: "900000000000000007", name: "unrelated", type: 1, description: "Leave untouched" }
	const commands: unknown[] = [unrelatedCommand]
	const effects: Effect[] = []
	const unexpected: Effect[] = []
	const json = (body: unknown) => new Response(JSON.stringify(body), {
		status: 200, headers: { "content-type": "application/json" }
	})
	const fetchBoundary = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
		expect(url.origin).toBe("https://discord.invalid")
		const effect: Effect = {
			method: init?.method ?? "GET", path: url.pathname,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			authorization: new Headers(init?.headers).get("authorization")
		}
		effects.push(effect)
		// Prove that real Carbon transport supplies the bot authority, without logging it.
		expect(effect.authorization).toBe("Bot fixture-bot-token")
		if (effect.method === "POST" && effect.path === callbackRoute) return new Response(null, { status: 204 })
		if (effect.method === "PATCH" && effect.path === originalRoute) {
			return json({ id: "900000000000000008", channel_id: channelId, author: { id: applicationId, username: "fixture-bot" } })
		}
		if (effect.method === "POST" && effect.path === followupRoute) return json({ id: "900000000000000009" })
		if (effect.method === "GET" && effect.path === commandRoute) return json(commands)
		if (effect.method === "POST" && effect.path === commandRoute) {
			commands.push({ id: "900000000000000010", ...effect.body })
			return json(commands.at(-1))
		}
		if (effect.method === "GET" && effect.path === memberRoute) {
			return json({ user: { id: callerId, username: "caller" }, roles: roles.get(callerId), joined_at: "2026-01-01T00:00:00Z" })
		}
		if (["PUT", "DELETE"].includes(effect.method) && effect.path === roleRoute) {
			roles.set(callerId, effect.method === "PUT"
				? [...roles.get(callerId)!, betaPingsConfig.roleId]
				: roles.get(callerId)!.filter((role) => role !== betaPingsConfig.roleId))
			return new Response(null, { status: 204 })
		}
		unexpected.push(effect)
		throw new Error("Unexpected transport effect: " + effect.method + " " + effect.path)
	}
	const client = new Client({
		clientId: applicationId, token: "fixture-bot-token", publicKey: "00",
		baseUrl: "https://fixture.invalid", deploySecret: "fixture-secret",
		requestOptions: { queueRequests: false, baseUrl: "https://discord.invalid", fetch: fetchBoundary },
		autoDeploy: false, disableDeployRoute: true
	}, { commands: [new BetaCommand(), new BetaPingsCommand()] })
	// Do not replace REST methods, dispatcher, fetchMember, GuildMember, or role service.
	expect(client.rest).toBeInstanceOf(RequestClient)
	expect(client.rest.get).toBe(RequestClient.prototype.get)
	expect(client.rest.post).toBe(RequestClient.prototype.post)
	expect(client.rest.put).toBe(RequestClient.prototype.put)
	expect(client.rest.delete).toBe(RequestClient.prototype.delete)
	expect(client.rest.patch).toBe(RequestClient.prototype.patch)
	const invoke = (name: string, permissions: bigint, guildId: string = betaPingsConfig.guildId) =>
		client.commandHandler.handleCommandInteraction({
			id: interactionId, application_id: applicationId, token, type: 2, version: 1,
			guild_id: guildId, channel_id: channelId,
			member: { user: { id: callerId, username: "caller" }, permissions: String(permissions),
				// Stale caller data deliberately disagrees with the fresh REST response.
				roles: callerHasRole ? [] : [betaPingsConfig.roleId] },
			data: { id: "900000000000000011", name, type: 1,
				// Adversarial unrelated user/role data must not become the mutation target.
				options: [{ name: "target", type: 6, value: otherId }],
				resolved: { users: { [otherId]: { id: otherId, username: "unrelated" } },
					members: { [otherId]: { roles: roles.get(otherId), permissions: String(Permission.Administrator) } } }
			}
		} as never)
	const trace = (scenario: string) => {
		expect(unexpected).toEqual([])
		if (process.env.BETA_TRANSPORT_TRACE !== "1") return
		let redacted = JSON.stringify(effects.map(({ authorization: _authority, ...effect }) => ({
			...effect, authorization: "Bot <redacted>"
		})))
		for (const [value, label] of [[applicationId, "<app>"], [betaPingsConfig.guildId, "<guild>"],
			[betaPingsConfig.roleId, "<beta-role>"], [callerId, "<caller>"], [otherId, "<other>"],
			[interactionId, "<interaction>"], [token, "<interaction-token>"]]) redacted = redacted.replaceAll(value!, label!)
		console.log("BETA_TRANSPORT_PROOF " + scenario + " " + redacted)
	}
	return { client, effects, commands, roles, unrelatedCommand, sqlite, invoke, trace,
		commandRoute, callbackRoute, originalRoute, followupRoute, memberRoute, roleRoute }
}

function expectPrivateOriginal(f: ReturnType<typeof fixture>) {
	expect(f.effects[0]).toMatchObject({ method: "POST", path: f.callbackRoute,
		body: { type: 5, data: { flags: 64 } } })
	const original = f.effects.find((effect) => effect.path === f.originalRoute)
	expect(original).toMatchObject({ method: "PATCH", body: { flags: 32832, allowed_mentions: { parse: [] } } })
}

describe("Beta authority proof through real Carbon dispatcher and RequestClient", () => {
	it.each([Permission.ManageRoles, Permission.Administrator])("authorized staff (%s) registers exact beta then posts public menu", async (permissions) => {
		const f = fixture()
		await f.invoke("beta-pings", permissions)
		expect(f.effects.map(({ method, path }) => [method, path])).toEqual([
			["POST", f.callbackRoute], ["GET", f.commandRoute], ["GET", f.commandRoute],
			["POST", f.commandRoute], ["GET", f.commandRoute],
			["PATCH", f.originalRoute], ["POST", f.followupRoute]
		])
		expect(f.effects[3]?.body).toEqual(JSON.parse(JSON.stringify(new BetaCommand().serialize())))
		expect(f.commands).toEqual([f.unrelatedCommand, { id: "900000000000000010", ...f.effects[3]?.body }])
		expectPrivateOriginal(f)
		expect(f.effects[6]?.body).toMatchObject({ flags: 32768, allowed_mentions: { parse: [] } })
		expect(JSON.stringify(f.effects[6]?.body)).toContain("beta-pings-toggle")
		expect(f.sqlite.database.query('SELECT key FROM keyValue').all()).toHaveLength(1)
		f.trace(permissions === Permission.Administrator ? "authorized-administrator" : "authorized-manage-roles")
	})
	it("a permission override allowing an ordinary member to invoke does not grant bot authority", async () => {
		const f = fixture()
		expect(new BetaPingsCommand().serialize().default_member_permissions).toBe(String(Permission.ManageRoles))
		// Discord's command override admits this incoming interaction; the runtime
		// member permission bitset still has neither Manage Roles nor Administrator.
		await f.invoke("beta-pings", 0n)
		expect(f.effects.map(({ method, path }) => [method, path])).toEqual([
			["POST", f.callbackRoute], ["PATCH", f.originalRoute]
		])
		expectPrivateOriginal(f)
		expect(JSON.stringify(f.effects[1]?.body)).toContain("Manage Roles or Administrator")
		expect(f.sqlite.database.query('SELECT key FROM keyValue').all()).toEqual([])
		expect(f.commands).toEqual([f.unrelatedCommand])
		f.trace("ordinary-member-command-override-denied")
	})
	it("wrong-guild administrator cannot register or post a public menu", async () => {
		const f = fixture()
		await f.invoke("beta-pings", Permission.Administrator, "900000000000000099")
		expect(f.effects.map(({ method, path }) => [method, path])).toEqual([
			["POST", f.callbackRoute], ["PATCH", f.originalRoute]
		])
		expectPrivateOriginal(f)
		expect(JSON.stringify(f.effects[1]?.body)).toContain("configured server")
		expect(f.commands).toEqual([f.unrelatedCommand])
		f.trace("wrong-guild-administrator-denied")
	})
	it.each([false, true])("public beta writes only its fresh caller's role (initially enabled: %s)", async (initiallyEnabled) => {
		const f = fixture(initiallyEnabled)
		const otherRoles = [...f.roles.get(otherId)!]
		await f.invoke("beta", 0n)
		expect(f.effects.map(({ method, path }) => [method, path])).toEqual([
			["POST", f.callbackRoute], ["GET", f.memberRoute],
			[initiallyEnabled ? "DELETE" : "PUT", f.roleRoute], ["PATCH", f.originalRoute]
		])
		expectPrivateOriginal(f)
		expect(f.roles.get(callerId)).toEqual(initiallyEnabled ? [unrelatedRoleId] : [unrelatedRoleId, betaPingsConfig.roleId])
		expect(f.effects[2]?.body).toBeUndefined()
		expect(f.roles.get(otherId)).toEqual(otherRoles)
		expect(f.commands).toEqual([f.unrelatedCommand])
		expect(JSON.stringify(f.effects[3]?.body)).toContain(initiallyEnabled ? betaPingsConfig.copy.disabled : betaPingsConfig.copy.enabled)
		f.trace(initiallyEnabled ? "caller-only-remove-role" : "caller-only-add-role")
	})
})
