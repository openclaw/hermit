import { Client } from "@buape/carbon"
import { createHandler } from "@buape/carbon/adapters/fetch"
import AdminCommand from "./commands/admin.js"
import ClaimCommand from "./commands/claim.js"
import GithubCommand from "./commands/github.js"
import MaintainerCommand from "./commands/maintainer.js"
import HelperRootCommand from "./commands/helper.js"
import RoleCommand from "./commands/role.js"
import SayRootCommand from "./commands/say.js"
import SolvedModCommand from "./commands/solvedMod.js"
import AutoModerationActionExecution from "./events/autoModerationActionExecution.js"
import AutoPublishMessageCreate from "./events/autoPublishMessageCreate.js"
import GifRepostMessageCreate from "./events/gifRepostMessageCreate.js"
import GithubSummaryReactionAdd from "./events/githubSummaryReactionAdd.js"
import Ready from "./events/ready.js"
import ThreadCreateWelcome from "./events/threadCreateWelcome.js"
import { fscRequestComponents } from "./components/fscRequestButtons.js"
import { whoisDeleteComponents } from "./components/whoisDeleteButton.js"
import { hydrateRuntimeEnv, type HermitEnv } from "./runtime/env.js"
import {
	claimReviewComponents,
	claimReviewModals,
	registerClaimRoutes
} from "./server/claimServer.js"
import { registerHelperLogsRoutes } from "./server/helperLogsServer.js"
import { runThreadLengthMonitor } from "./services/threadLengthMonitor.js"

export const client = new Client(
	{
		baseUrl: process.env.BASE_URL,
		deploySecret: process.env.DEPLOY_SECRET,
		clientId: process.env.DISCORD_CLIENT_ID,
		publicKey: process.env.FORWARDER_PUBLIC_KEY
			? [process.env.DISCORD_PUBLIC_KEY, process.env.FORWARDER_PUBLIC_KEY]
			: process.env.DISCORD_PUBLIC_KEY,
		token: process.env.DISCORD_BOT_TOKEN,
		requestOptions: { queueRequests: false },
		autoDeploy: true,
		devGuilds: process.env.DISCORD_DEV_GUILDS?.split(",")
	},
	{
		commands: [
			new GithubCommand(),
			new SolvedModCommand(),
			new SayRootCommand(),
			new RoleCommand(),
			new HelperRootCommand(),
			new ClaimCommand(),
			new MaintainerCommand(),
			new AdminCommand()
		],
		listeners: [
			new AutoModerationActionExecution(),
			new AutoPublishMessageCreate(),
			new GifRepostMessageCreate(),
			new GithubSummaryReactionAdd(),
			new ThreadCreateWelcome(),
			new Ready()
		],
		components: [
			...claimReviewComponents,
			...fscRequestComponents,
			...whoisDeleteComponents
		],
		modals: claimReviewModals
	}
)

registerClaimRoutes(client)
registerHelperLogsRoutes(client)

const eventsRoute = client.routes.find(
	(route) => route.method === "POST" && route.path === "/events"
)
if (eventsRoute) {
	const handleEvents = eventsRoute.handler
	eventsRoute.handler = async (request, context) => {
		const response = await handleEvents(request, context)
		context?.waitUntil?.(
			(async () => {
				for (let attempts = 0; attempts < 80; attempts += 1) {
					const metrics = client.eventHandler.getMetrics()
					if (
						metrics.queueSize === 0 &&
						metrics.processingByLane.critical === 0 &&
						metrics.processingByLane.standard === 0 &&
						metrics.processingByLane.background === 0
					) {
						return
					}
					await new Promise((resolve) => setTimeout(resolve, 100))
				}
			})()
		)
		return response
	}
}

const handler = createHandler(client)

export default {
	fetch(request: Request, env: HermitEnv, ctx: ExecutionContext) {
		hydrateRuntimeEnv(env)
		return handler(request, {
			env,
			waitUntil: ctx.waitUntil.bind(ctx)
		})
	},
	scheduled(_controller: ScheduledController, env: HermitEnv, ctx: ExecutionContext) {
		hydrateRuntimeEnv(env)
		ctx.waitUntil(runThreadLengthMonitor(client))
	}
} satisfies ExportedHandler<Env>

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			BASE_URL: string;
			DEPLOY_SECRET: string;
			DISCORD_CLIENT_ID: string;
			DISCORD_PUBLIC_KEY: string;
			DISCORD_BOT_TOKEN: string;
			DISCORD_DEV_GUILDS?: string;
			ANSWER_OVERFLOW_API_KEY?: string;
			HELPER_THREAD_WELCOME_PARENT_ID?: string;
			HELPER_THREAD_WELCOME_TEMPLATE?: string;
			THREAD_LENGTH_CHECK_INTERVAL_HOURS?: string;
			DISCORD_CLIENT_SECRET?: string;
			FORWARDER_PUBLIC_KEY?: string;
			OPENAI_API_KEY?: string;
			GITHUB_APP_ID?: string;
			GITHUB_APP_INSTALLATION_ID?: string;
			GITHUB_APP_PRIVATE_KEY?: string;
			GITHUB_APP_SLUG?: string;
		}
	}
}
