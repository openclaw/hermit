import { Client } from "@buape/carbon"
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway"
import GithubCommand from "./commands/github.js"
import SayRootCommand from "./commands/say.js"
import RoleCommand from "./commands/role.js"
import OnboardStartCommand from "./commands/onboardStart.js"
import StatusCommand from "./commands/status.js"
import TrialsCommand from "./commands/trials.js"
import ApplicationsCommand from "./commands/applications.js"
import OnboardingStatsCommand from "./commands/onboardingStats.js"
import PromoteCommand from "./commands/promote.js"
import DenyCommand from "./commands/deny.js"
import OnboardingConfigCommand from "./commands/admin/onboardingConfig.js"
import TeamConfigCommand from "./commands/admin/teamConfig.js"
import OnboardingSetupCommand from "./commands/admin/onboardingSetup.js"
import OpenApplicationFormButton from "./components/openApplicationFormButton.js"
import ApplicationApproveButton from "./components/applicationApproveButton.js"
import ApplicationDenyButton from "./components/applicationDenyButton.js"
import VoteApproveButton from "./components/voteApproveButton.js"
import VoteDenyButton from "./components/voteDenyButton.js"
import ApplicationModal from "./modals/applicationModal.js"
import AutoModerationActionExecution from "./events/autoModerationActionExecution.js"
import AutoPublishMessageCreate from "./events/autoPublishMessageCreate.js"
import Ready from "./events/ready.js"
import GuildMemberRemove from "./events/guildMemberRemove.js"

const gateway = new GatewayPlugin({
	intents:
		GatewayIntents.Guilds |
		GatewayIntents.GuildMessages |
		GatewayIntents.MessageContent |
		GatewayIntents.AutoModerationExecution |
		GatewayIntents.GuildMembers,
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
			new OnboardStartCommand(),
			new StatusCommand(),
			new TrialsCommand(),
			new ApplicationsCommand(),
			new OnboardingStatsCommand(),
			new PromoteCommand(),
			new DenyCommand(),
			new OnboardingConfigCommand(),
			new TeamConfigCommand(),
			new OnboardingSetupCommand(),
		],
		components: [
			new OpenApplicationFormButton(),
			new ApplicationApproveButton(),
			new ApplicationDenyButton(),
			new VoteApproveButton(),
			new VoteDenyButton(),
		],
		modals: [
			new ApplicationModal("placeholder"),
		],
		listeners: [
			new AutoModerationActionExecution(),
			new AutoPublishMessageCreate(),
			new Ready(),
			new GuildMemberRemove(),
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