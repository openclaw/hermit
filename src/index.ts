import { Client } from "@buape/carbon"
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway"
import GithubCommand from "./commands/github.js"
import SolvedModCommand from "./commands/solvedMod.js"
import SayRootCommand from "./commands/say.js"
import RoleCommand from "./commands/role.js"
import HelperRootCommand from "./commands/helper.js"
import AutoModerationActionExecution from "./events/autoModerationActionExecution.js"
import AutoPublishMessageCreate from "./events/autoPublishMessageCreate.js"
import Ready from "./events/ready.js"
import ThreadCreateWelcome from "./events/threadCreateWelcome.js"
import { startHelperLogsServer } from "./server/helperLogsServer.js"

startHelperLogsServer()

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
			new SolvedModCommand(),
			new SayRootCommand(),
			new RoleCommand(),
			new HelperRootCommand()
		],
		listeners: [
			new AutoModerationActionExecution(),
			new AutoPublishMessageCreate(),
			new ThreadCreateWelcome(),
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
			ANSWER_OVERFLOW_API_KEY?: string;
			ANSWER_OVERFLOW_API_BASE_URL?: string;
			HELPER_THREAD_WELCOME_PARENT_ID?: string;
			HELPER_THREAD_WELCOME_TEMPLATE?: string;
			THREAD_LENGTH_CHECK_INTERVAL_HOURS?: string;
			HELPER_LOGS_HOST?: string;
			HELPER_LOGS_PORT?: string;
			DB_PATH?: string;
			DRIZZLE_MIGRATIONS?: string;
		}
	}
}
