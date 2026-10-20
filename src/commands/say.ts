import {
	ApplicationIntegrationType,
	CommandWithSubcommands,
	InteractionContextType
} from "@buape/carbon"
import SayCommand from "./sayCommand.js"

const supportLink = "https://community.openclaw.ai/"
const faqLink = "https://docs.openclaw.ai/help/faq"
const contributingLink =
	"https://github.com/openclaw/openclaw/blob/main/CONTRIBUTING.md"

class SayHelpCommand extends SayCommand {
	name = "help"
	description = "Share help instructions"
	protected message = `[Get support](${supportLink}) is the official OpenClaw support pathway for setup, usage questions, and troubleshooting. Find or create a relevant topic there. Include your operating system, OpenClaw version, what you expected, what happened, and relevant redacted logs. Check the troubleshooting FAQ first: <${faqLink}>.`
}

class SayPrReviewCommand extends SayCommand {
	name = "pr-review"
	description = "Share expectations for posting PRs for review"
	protected message = `When posting a PR for review, include the PR link and keep its description current with **What Problem This Solves**, **Why This Change Was Made**, **User Impact**, and **Evidence**.

Before asking for review, test the change locally, make sure CI passes, resolve merge conflicts, address bot review threads, and leave **Allow edits by maintainers** enabled. Full contributor guidance: <${contributingLink}>.`
}

class SayClawtributorCommand extends SayCommand {
	name = "clawtributor"
	description = "Share Clawtributor role request instructions"
	protected message = `To request the Clawtributor role, connect your GitHub account under **Discord Settings -> Connections -> GitHub**.

Then run \`/claim\` in this server and follow the private authorization link. Hermit checks your linked GitHub account for a merged pull request in \`openclaw/openclaw\` and sends eligible claims to the team for review.`
}

class SayImpersonationCommand extends SayCommand {
	name = "impersonation"
	description = "Warn about fake Krill and support impersonation"
	protected message = `⚠️ **PSA: impersonation and fake support accounts**

Be cautious with unsolicited DMs from accounts claiming to be Krill, moderators, maintainers, or official OpenClaw support.

- Do not run commands or install anything from unverified accounts.
- Do not share tokens, API keys, auth codes, or config files.
- Verify the person's identity in the server before acting.

Report impersonators or suspicious messages to the moderators.`
}

export default class SayRootCommand extends CommandWithSubcommands {
	name = "say"
	description = "Share common resources"
	integrationTypes = [
		ApplicationIntegrationType.GuildInstall,
		ApplicationIntegrationType.UserInstall
	]
	contexts = [InteractionContextType.Guild, InteractionContextType.BotDM]
	subcommands = [
		new SayHelpCommand(),
		new SayPrReviewCommand(),
		new SayClawtributorCommand(),
		new SayImpersonationCommand()
	]
}
