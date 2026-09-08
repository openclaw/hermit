/** Local Hermit + real Discord proof; never deploys or registers commands.
 * Prepare: bun scripts/proof-search-intelligence.ts --prepare /tmp/claw-768-hermit-proof
 * Send: bun scripts/proof-search-intelligence.ts --send /tmp/claw-768-hermit-proof /path/to/frozen-digest.json
 * Run --send only through the managed credential flow. Reuse the same proof directory.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client, Routes } from "@buape/carbon"
import { getPlatformProxy } from "wrangler"
import { formSettings } from "../forms.config.js"
import { handleSearchIntelligenceApiRequest } from "../src/clawhubSearchIntelligence/api.js"
import { setRuntimeEnv } from "../src/runtime/env.js"

const [mode, directoryArg, payloadPath] = process.argv.slice(2)
if (!["--prepare", "--send"].includes(mode ?? "") || !directoryArg)
	throw new Error(
		"Expected --prepare <proof-directory> or --send <same-proof-directory> <frozen-digest.json>"
	)
const directory = resolve(directoryArg)
await mkdir(directory, { recursive: true })
const configPath = resolve(directory, "wrangler.json")
await writeFile(
	configPath,
	JSON.stringify({
		name: "claw-768-hermit-local-proof",
		compatibility_date: "2026-09-08",
		compatibility_flags: ["nodejs_compat"],
		d1_databases: [
			{
				binding: "DB",
				database_name: "claw-768-local-proof",
				database_id: "00000000-0000-0000-0000-000000000768"
			}
		]
	})
)
const proxy = await getPlatformProxy<{ DB: D1Database }>({
	configPath,
	envFiles: [],
	remoteBindings: false,
	persist: { path: resolve(directory, "d1-state") }
})
let proofStep = "prepare-local-d1"
try {
	await proxy.env.DB.prepare(
		"CREATE TABLE IF NOT EXISTS keyValue (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)"
	).run()
	if (mode === "--prepare") {
		console.log(
			JSON.stringify({
				prepared: true,
				database: "local D1",
				directory,
				sent: false
			})
		)
	} else {
		proofStep = "read-frozen-payload-and-managed-token"
		if (!payloadPath || !process.env.DISCORD_BOT_TOKEN)
			throw new Error(
				"Frozen payload and managed DISCORD_BOT_TOKEN are required"
			)
		const digest = JSON.parse(await readFile(payloadPath, "utf8"))
		const origin = new URL(digest.dashboardUrl).origin
		if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
			throw new Error(
				"Proof requires a localhost dashboard origin so Discord is visibly labeled LOCAL PREVIEW"
			)
		const botId = "1501672484095660143"
		const client = new Client(
			{
				baseUrl: "http://localhost:4312",
				clientId: botId,
				publicKey: "0".repeat(64),
				token: process.env.DISCORD_BOT_TOKEN,
				autoDeploy: false,
				disableDeployRoute: true,
				requestOptions: { queueRequests: false }
			},
			{}
		)
		proofStep = "verify-approved-bot"
		const identity = (await client.rest.get(Routes.user("@me"))) as {
			id: string
		}
		if (identity.id !== botId)
			throw new Error("Configured token is not the approved proof bot")
		proofStep = "verify-maintainer-channel"
		const channel = (await client.rest.get(
			Routes.channel(formSettings.clawhubAppealReviewChannelId)
		)) as { id: string; name: string; guild_id: string }
		if (
			channel.name !== "maintainer-clawhub" ||
			channel.guild_id !== "1456350064065904867"
		)
			throw new Error("Unexpected proof channel")
		const localToken = crypto.randomUUID()
		setRuntimeEnv({
			DB: proxy.env.DB,
			CLAWHUB_HERMIT_TOKEN: localToken,
			CLAWHUB_SITE_URL: origin,
			DISCORD_CLIENT_ID: botId
		} as Env)
		const request = () =>
			new Request(
				"http://localhost:4312/api/clawhub-search-intelligence/weekly",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${localToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify(digest)
				}
			)
		proofStep = "deliver-and-check-duplicate"
		const first = await handleSearchIntelligenceApiRequest(request(), client)
		const replay = await handleSearchIntelligenceApiRequest(request(), client)
		const key = `clawhub-search-weekly:${origin}:${digest.weekStart}`
		const row = await proxy.env.DB.withSession("first-primary")
			.prepare("SELECT value FROM keyValue WHERE key = ?")
			.bind(key)
			.first<{ value: string }>()
		const receipt = row ? JSON.parse(row.value) : null
		proofStep = "read-confirmed-discord-message"
		const message = receipt?.messageId
			? ((await client.rest.get(
					Routes.channelMessage(channel.id, receipt.messageId)
				)) as {
					id: string
					author: { id: string }
					flags: number
					components: unknown[]
					mentions: unknown[]
					mention_roles: unknown[]
					mention_everyone: boolean
				})
			: null
		const evidence = {
			mode: "local Hermit production handler + local persistent D1 + real Discord test bot; NOT deployed production Hermit",
			first: { status: first?.status, body: await first?.json() },
			duplicate: { status: replay?.status, body: await replay?.json() },
			receipt,
			discord: message
				? {
						url: `https://discord.com/channels/${channel.guild_id}/${channel.id}/${message.id}`,
						botId: message.author.id,
						flags: message.flags,
						components: message.components,
						mentionCount: message.mentions.length,
						roleMentionCount: message.mention_roles.length,
						mentionEveryone: message.mention_everyone
					}
				: null
		}
		await writeFile(
			resolve(directory, "evidence.json"),
			JSON.stringify(evidence, null, 2)
		)
		console.log(
			JSON.stringify({
				firstStatus: first?.status,
				duplicateStatus: replay?.status,
				delivered: receipt?.status === "sent",
				discordUrl: evidence.discord?.url,
				evidencePath: resolve(directory, "evidence.json")
			})
		)
		if (
			first?.status !== 200 ||
			replay?.status !== 200 ||
			!message ||
			message.flags !== 32768 ||
			message.author.id !== botId ||
			message.mentions.length ||
			message.mention_roles.length ||
			message.mention_everyone
		)
			process.exitCode = 1
	}
} catch (error) {
	const status =
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: null
	// Never print the SDK error object, request, headers, or protected environment.
	console.error(
		JSON.stringify({ error: "Proof failed", step: proofStep, status })
	)
	process.exitCode = 1
} finally {
	await proxy.dispose()
}
