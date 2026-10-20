import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { ChannelType, Client, Webhook } from "@buape/carbon"
import ThreadCreateWelcome from "../src/events/threadCreateWelcome.js"
import AutoModerationActionExecution from "../src/events/autoModerationActionExecution.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { getOrCreateChannelWebhook } from "../src/utils/channelWebhook.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const supportLink = "[Get support](https://community.openclaw.ai/)"
const clientFor = () => {
	const calls: Array<{ path: string; body: Record<string, unknown> }> = []
	const client = new Client({
		baseUrl: "https://example.invalid",
		clientId: "app-test",
		publicKey: "test-only",
		token: "test-only",
		disableDeployRoute: true,
		autoDeploy: false
	}, {})
	client.rest = {
		get: async () => [{ id: "webhook-test", token: "test-only" }],
		post: async (path: string, options: { body: Record<string, unknown> }) => {
			calls.push({ path, body: options.body })
			return { id: "message-test", channel_id: "thread-test" }
		}
	} as unknown as Client["rest"]
	return { client, calls }
}

const withWelcomeEnv = async (template: string | undefined, run: () => Promise<void>) => {
	const parent = process.env.HELPER_THREAD_WELCOME_PARENT_ID
	const previous = process.env.HELPER_THREAD_WELCOME_TEMPLATE
	process.env.HELPER_THREAD_WELCOME_PARENT_ID = "help-parent-test"
	if (template === undefined) delete process.env.HELPER_THREAD_WELCOME_TEMPLATE
	else process.env.HELPER_THREAD_WELCOME_TEMPLATE = template
	try {
		await run()
	} finally {
		if (parent === undefined) delete process.env.HELPER_THREAD_WELCOME_PARENT_ID
		else process.env.HELPER_THREAD_WELCOME_PARENT_ID = parent
		if (previous === undefined) delete process.env.HELPER_THREAD_WELCOME_TEMPLATE
		else process.env.HELPER_THREAD_WELCOME_TEMPLATE = previous
	}
}

const threadData = (listener: ThreadCreateWelcome, client: Client, overrides = {}) =>
	listener.parseRawData({
		id: "thread-test",
		guild_id: "guild-test",
		parent_id: "help-parent-test",
		type: ChannelType.PublicThread,
		message_count: 1,
		total_message_sent: 1,
		thread_metadata: {
			archived: false,
			auto_archive_duration: 60,
			archive_timestamp: "2026-10-20T00:00:00.000Z",
			create_timestamp: "2026-10-20T00:00:00.000Z"
		},
		...overrides
	} as Parameters<ThreadCreateWelcome["parseRawData"]>[0], client)

const textFrom = (body: Record<string, unknown>) => {
	const containers = body.components as Array<{ components: Array<{ content: string }> }>
	return containers.flatMap((container) => container.components.map((component) => component.content)).join("\n")
}

describe("official support routing", () => {
	for (const template of [undefined, "", "   ", "Welcome, helpers are still here!"]) {
		it(`includes official support in the sent welcome with ${JSON.stringify(template)} override`, async () => {
			await withWelcomeEnv(template, async () => {
				const db = new SqliteD1Database()
				for (const statement of readFileSync("drizzle/0000_productive_tinkerer.sql", "utf8").split("--> statement-breakpoint")) {
					if (statement.trim()) db.database.run(statement)
				}
				setRuntimeEnv({ DB: db as unknown as D1Database } as Env)
				try {
					const { client, calls } = clientFor()
					const listener = new ThreadCreateWelcome()
					await listener.handle(threadData(listener, client), client)
					expect(calls).toHaveLength(1)
					expect(calls[0]?.path).toBe("/channels/thread-test/messages")
					const message = textFrom(calls[0]!.body)
					expect(message).toContain(supportLink)
					expect(message).toContain("official OpenClaw support")
					expect(message).toContain("redact tokens and secrets")
					if (template?.trim()) expect(message).toStartWith(template)
					else {
						expect(message).toContain("Welcome to the help channel!")
						expect(message).toContain("<@1457407575476801641>")
						expect(message).toContain("social conversation and collaboration")
					}
					expect(db.database.query("select count(*) as count from tracked_threads").get()).toEqual({ count: 1 })
				} finally {
					db.database.close()
				}
			})
		})
	}

	it("does not welcome archived threads or unrelated parent channels", async () => {
		await withWelcomeEnv(undefined, async () => {
			const { client, calls } = clientFor()
			const listener = new ThreadCreateWelcome()
			await listener.handle(threadData(listener, client, { parent_id: "social-parent" }), client)
			const archived = threadData(listener, client)
			archived.thread.rawData.thread_metadata!.archived = true
			await listener.handle(archived, client)
			expect(calls).toHaveLength(0)
		})
	})

	it("sends the official support automod response while preserving PR and Discord-report routes", async () => {
		const { client, calls } = clientFor()
		const channelId = "support-routing-automod-test"
		const webhook = await getOrCreateChannelWebhook(client, channelId)
		const reposts: unknown[] = []
		// Exercise the real template loader and listener, replacing only the external webhook transport.
		webhook.rest = {
			post: async (_path: string, options: { body: unknown }) => {
				reposts.push(options.body)
			}
		} as unknown as Webhook["rest"]
		const listener = new AutoModerationActionExecution()
		await listener.handle({
			channel_id: channelId,
			rule_id: "1464411068632797274",
			matched_keyword: "<@387380367612706819>",
			user_id: "member-test",
			content: "<@387380367612706819> I need setup help"
		} as Parameters<AutoModerationActionExecution["handle"]>[0], client)
		expect(reposts).toHaveLength(1)
		expect(calls).toHaveLength(1)
		const message = calls[0]!.body.content as string
		expect(message).toContain(supportLink)
		expect(message).toContain("official OpenClaw support")
		expect(message).toContain("<#1458141495701012561>")
		expect(message).toContain("<#1465158042675843142>")
		expect(message).not.toContain("<#1459642797895319552>")
		expect(message).not.toContain("<#1459007081603403828>")
	})
})
