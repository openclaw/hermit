import { Client } from "@buape/carbon"
import {
	GatewayForwarderPlugin,
	GatewayIntents
} from "@buape/carbon/gateway-forwarder"

const {
	BASE_URL,
	DEPLOY_SECRET,
	DISCORD_CLIENT_ID,
	DISCORD_PUBLIC_KEY,
	DISCORD_BOT_TOKEN,
	FORWARDER_PRIVATE_KEY
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
				GatewayIntents.MessageContent,
			webhookUrl: `${BASE_URL}/events`,
			privateKey: FORWARDER_PRIVATE_KEY
		})
	]
)

console.log(`Gateway forwarder ready to forward events to ${BASE_URL}/events`)
