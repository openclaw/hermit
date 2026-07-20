import { Client } from "@buape/carbon"
import { createHandler } from "@buape/carbon/adapters/fetch"
import AdminCommand from "./commands/admin.js"
import BetaPingsCommand from "./commands/betaPings.js"
import ClaimCommand from "./commands/claim.js"
import GithubCommand from "./commands/github.js"
import MaintainerCommand from "./commands/maintainer.js"
import HelperRootCommand from "./commands/helper.js"
import NominateCommand from "./commands/nominate.js"
import RoleCommand from "./commands/role.js"
import SayRootCommand from "./commands/say.js"
import LobsterCommand, {
	ReleaseLobsterContextCommand
} from "./commands/lobster.js"
import SlapCommand, { FishSlapContextCommand } from "./commands/slap.js"
import SolvedModCommand from "./commands/solvedMod.js"
import AutoModerationActionExecution from "./events/autoModerationActionExecution.js"
import AutoPublishMessageCreate from "./events/autoPublishMessageCreate.js"
import GifRepostMessageCreate from "./events/gifRepostMessageCreate.js"
import GithubLinkSuppressMessageCreate from "./events/githubLinkSuppressMessageCreate.js"
import GithubSummaryReactionAdd from "./events/githubSummaryReactionAdd.js"
import Ready from "./events/ready.js"
import ThreadCreateWelcome from "./events/threadCreateWelcome.js"
import {
	formReviewComponents,
	formReviewModals
} from "./forms/reviewButtons.js"
import { fscRequestComponents } from "./components/fscRequestButtons.js"
import { betaPingsComponents } from "./components/betaPingsButton.js"
import { nominationComponents } from "./components/nominationButtons.js"
import { lobsterComponents } from "./components/lobsterButtons.js"
import { slapComponents } from "./components/slapButtons.js"
import { whoisDeleteComponents } from "./components/whoisDeleteButton.js"
import { hydrateRuntimeEnv, type HermitEnv } from "./runtime/env.js"
import { createCommandDeploymentTracker } from "./runtime/commandDeployment.js"
import {
	claimReviewComponents,
	claimReviewModals,
	registerClaimRoutes
} from "./server/claimServer.js"
import { handleFormsRequest } from "./forms/server.js"
import { registerHelperLogsRoutes } from "./server/helperLogsServer.js"
import {
	runNominationExpiry,
	runNominationGrantRecovery
} from "./services/nominationExpiry.js"
import { runNominationCardSyncRecovery } from "./services/nominationCardSync.js"
import { runThreadLengthMonitor } from "./services/threadLengthMonitor.js"
import { handleContentRightsApiRequest } from "./clawhubContentRights/api.js"
import { handlePublisherAbuseDigestApiRequest } from "./clawhubPublisherAbuse/api.js"

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
		autoDeploy: false,
		devGuilds: process.env.DISCORD_DEV_GUILDS?.split(",")
	},
	{
		commands: [
			new GithubCommand(),
			new SolvedModCommand(),
			new SayRootCommand(),
			new RoleCommand(),
			new BetaPingsCommand(),
			new HelperRootCommand(),
			new ClaimCommand(),
			new NominateCommand(),
			new LobsterCommand(),
			new ReleaseLobsterContextCommand(),
			new SlapCommand(),
			new FishSlapContextCommand(),
			new MaintainerCommand(),
			new AdminCommand()
		],
		listeners: [
			new AutoModerationActionExecution(),
			new AutoPublishMessageCreate(),
			new GifRepostMessageCreate(),
			new GithubLinkSuppressMessageCreate(),
			new GithubSummaryReactionAdd(),
			new ThreadCreateWelcome(),
			new Ready()
		],
		components: [
			...claimReviewComponents,
			...formReviewComponents,
			...fscRequestComponents,
			...betaPingsComponents,
			...nominationComponents,
			...lobsterComponents,
			...slapComponents,
			...whoisDeleteComponents
		],
		modals: [...claimReviewModals, ...formReviewModals]
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
const trackCommandDeployment = createCommandDeploymentTracker(() =>
	client.deployCommands()
)

export default {
	async fetch(request: Request, env: HermitEnv, ctx: ExecutionContext) {
		hydrateRuntimeEnv(env)
		trackCommandDeployment(ctx)
		const contentRightsApiResponse = await handleContentRightsApiRequest(request)
		if (contentRightsApiResponse) {
			return contentRightsApiResponse
		}
		const publisherAbuseDigestResponse = await handlePublisherAbuseDigestApiRequest(request, client)
		if (publisherAbuseDigestResponse) {
			return publisherAbuseDigestResponse
		}
		const formsResponse = await handleFormsRequest(request, client)
		if (formsResponse) {
			return formsResponse
		}
		return handler(request, {
			env,
			waitUntil: ctx.waitUntil.bind(ctx)
		})
	},
	scheduled(controller: ScheduledController, env: HermitEnv, ctx: ExecutionContext) {
		hydrateRuntimeEnv(env)
		trackCommandDeployment(ctx)
		ctx.waitUntil(runNominationExpiry(client))
		ctx.waitUntil(runNominationGrantRecovery(client))
		ctx.waitUntil(runNominationCardSyncRecovery(client))
		if (!controller.cron || controller.cron === "0 */2 * * *") {
			ctx.waitUntil(runThreadLengthMonitor(client))
		}
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
			GITHUB_OAUTH_CLIENT_ID?: string;
			GITHUB_OAUTH_CLIENT_SECRET?: string;
			FORMS_BASE_URL?: string;
			FORMS_DEV?: string;
			REDDIT_OAUTH_CLIENT_ID?: string;
			REDDIT_OAUTH_CLIENT_SECRET?: string;
			DEVVIT_REDDIT_BRIDGE_SECRET?: string;
			DEVVIT_REDDIT_ACTION_URL?: string;
			RESEND_API_KEY?: string;
			CLAWHUB_NOREPLY_FROM?: string;
			CLAWHUB_HERMIT_TOKEN?: string;
			CLAWHUB_SITE_URL?: string;
		}
	}
}
