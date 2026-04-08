import { Client } from "@buape/carbon"
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway"
import GithubCommand from "./commands/github.js"
import SayRootCommand from "./commands/say.js"
import RoleCommand from "./commands/role.js"
import AdminCommand from "./commands/admin.js"
import AutoModerationActionExecution from "./events/autoModerationActionExecution.js"
import AutoPublishMessageCreate from "./events/autoPublishMessageCreate.js"
import Ready from "./events/ready.js"

const gateway = new GatewayPlugin({
	intents:
		GatewayIntents.Guilds |
		GatewayIntents.GuildMessages |
		GatewayIntents.MessageContent |
		GatewayIntents.AutoModerationExecution,
	autoInteractions: true
})

const client = new Client(
	{
		baseUrl: "http://localhost:3000",
		deploySecret: "unused",
		clientId: process.env.DISCORD_CLIENT_ID,
		publicKey: "unused",
		token: process.env.DISCORD_BOT_TOKEN,
		autoDeploy: true,
		disableDeployRoute: true,
		disableInteractionsRoute: true,
		disableEventsRoute: true,
		devGuilds: process.env.DISCORD_DEV_GUILDS?.split(","), // Optional: comma-separated list of dev guild IDs
	},
	{
		commands: [
			new GithubCommand(),
			new SayRootCommand(),
			new RoleCommand(),
			new AdminCommand()
		],
		listeners: [
			new AutoModerationActionExecution(),
			new AutoPublishMessageCreate(),
			new Ready()
		],
	},
	[gateway]
)

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			BASE_URL: string;
			DEPLOY_SECRET: string;
			DISCORD_CLIENT_ID: string;
			DISCORD_PUBLIC_KEY: string;
			DISCORD_BOT_TOKEN: string;
		}
	}
}