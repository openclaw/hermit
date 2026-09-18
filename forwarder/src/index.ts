import { Client } from "@buape/carbon"
import {
	GatewayForwarderPlugin,
	GatewayIntents
} from "@buape/carbon/gateway-forwarder"
import { startDiscrawlServer } from "./discrawlServer.js"

const {
	BASE_URL,
	DEPLOY_SECRET,
	DISCORD_CLIENT_ID,
	DISCORD_PUBLIC_KEY,
	DISCORD_BOT_TOKEN,
	FORWARDER_PRIVATE_KEY,
	DISCRAWL_EXPORT_PATH,
	DISCRAWL_SERVER_PORT,
	DISCRAWL_SECRET
} = Bun.env

if (
	!BASE_URL ||
	!DEPLOY_SECRET ||
	!DISCORD_CLIENT_ID ||
	!DISCORD_PUBLIC_KEY ||
	!DISCORD_BOT_TOKEN ||
	!FORWARDER_PRIVATE_KEY
) {
	throw new Error("Missing required forwarder env vars")
}

const client = new Client(
	{
		baseUrl: BASE_URL,
		deploySecret: DEPLOY_SECRET,
		clientId: DISCORD_CLIENT_ID,
		publicKey: DISCORD_PUBLIC_KEY,
		token: DISCORD_BOT_TOKEN
	},
	{},
	[
		new GatewayForwarderPlugin({
			intents:
				GatewayIntents.Guilds |
				GatewayIntents.GuildMessages |
				GatewayIntents.GuildMessageReactions |
				GatewayIntents.MessageContent,
			webhookUrl: `${BASE_URL}/events`,
			privateKey: FORWARDER_PRIVATE_KEY
		})
	]
)

console.log(`Gateway forwarder ready to forward events to ${BASE_URL}/events`)

if (DISCRAWL_EXPORT_PATH) {
	const port = Number(DISCRAWL_SERVER_PORT || 3002)
	const secret = DISCRAWL_SECRET || DEPLOY_SECRET
	startDiscrawlServer({
		exportPath: DISCRAWL_EXPORT_PATH,
		secret,
		port
	})
	console.log(`Discrawl export server listening on port ${port}`)
}
