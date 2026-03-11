import {
	ApplicationIntegrationType,
	CommandWithSubcommands,
	InteractionContextType
} from "@buape/carbon"
import SayCommand from "./sayCommand.js"

const guideLink = "https://discord.com/channels/1456350064065904867/@home"
const stuckLink = "https://docs.openclaw.ai/help/faq#im-stuck-whats-the-fastest-way-to-get-unstuck"
const skillLink = "https://clawdhub.com/RhysSullivan/answeroverflow"
const communityLink = "https://www.answeroverflow.com/c/1456350064065904867"

class SayGuideCommand extends SayCommand {
	name = "guide"
	description = "Share the server guide"
	protected message = `## [Check the Server Guide here](<${guideLink}>)`
}

class SayServerFaqCommand extends SayCommand {
	name = "server-faq"
	description = "Point to the server FAQ"
	protected message = `Your question is answered in the server FAQ in our [Server Guide](<${guideLink}>)`
}

class SayHelpCommand extends SayCommand {
	name = "help"
	description = "Share help instructions"
	protected message = `Use <#1459642797895319552> for help. The fastest way to get your problem solved is to follow the instructions here: <${stuckLink}>`
}

class SayUserHelpCommand extends SayCommand {
	name = "user-help"
	description = "Share users-helping-users instructions"
	protected message = `Please move your conversation to <#1459007081603403828>. You can help others with OpenClaw there.`
}

class SayModelCommand extends SayCommand {
	name = "model"
	description = "Point to the model discussion channel"
	protected message = "Any discussion about various AI models should be taken to <#1478196963563409520>."
}

class SayStuckCommand extends SayCommand {
	name = "stuck"
	description = "Share the fastest way to get unstuck"
	protected message = `The fastest way to get your problem solved is to follow the instructions here: <${stuckLink}>`
}

class SayCiCommand extends SayCommand {
	name = "ci"
	description = "Share guidance about CI test failures"
	protected message = `Please don't make PRs for test failures on main.

The team is aware of those and will handle them directly on the codebase, not only fixing the tests but also investigating what the root cause is. Having to sift through test-fix-PRs (including some that have been out of date for weeks...) on top of that doesn't help. There are already way too many PRs for humans to manage; please don't make the flood worse.

Thank you.`
}

class SayAnswerOverflowCommand extends SayCommand {
	name = "answeroverflow"
	description = "Share the Answer Overflow skill and community links"
	protected message = `Point your agent to our Answer Overflow page with the Answer Overflow skill: <${skillLink}>. You can also browse the community here: <${communityLink}>.`
}

class SayPingingCommand extends SayCommand {
	name = "pinging"
	description = "Ask folks not to tag maintainers"
	protected message = `Please don't tag maintainers. There are thousands of open PRs, and tagging maintainers makes you look like a needy asshole.

Use <#1458141495701012561> to discuss instead, without pinging people.`
}

class SayDocsCommand extends SayCommand {
	name = "docs"
	description = "Share the docs link"
	protected message = "Docs are available at <https://docs.openclaw.ai>."
}

class SaySecurityCommand extends SayCommand {
	name = "security"
	description = "Share the security docs link"
	protected message = "Security docs are available at <https://docs.openclaw.ai/security>."
}

class SayInstallCommand extends SayCommand {
	name = "install"
	description = "Share the install script link"
	protected message = "You can find the one-liner install script at <https://openclaw.ai>."
}

class SayBlogRenameCommand extends SayCommand {
	name = "blog-rename"
	description = "Share the blog rename post link"
	protected message = "Read about our rebranding from Clawdbot -> Moltbot -> OpenClaw here: <https://openclaw.ai/blog/introducing-openclaw>."
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
		new SayModelCommand(),
		new SayHelpCommand(),
		new SayUserHelpCommand(),
		new SayServerFaqCommand(),
		new SayGuideCommand(),
		new SayStuckCommand(),
		new SayCiCommand(),
		new SayAnswerOverflowCommand(),
		new SayPingingCommand(),
		new SayDocsCommand(),
		new SaySecurityCommand(),
		new SayInstallCommand(),
		new SayBlogRenameCommand()
	]
}
