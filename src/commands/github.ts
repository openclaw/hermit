import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	Container,
	type CommandInteraction,
	InteractionContextType,
	LinkButton,
	Section,
	Separator,
	TextDisplay,
	Thumbnail
} from "@buape/carbon"
import BaseCommand from "./base.js"

type GitHubIssue = {
	html_url: string
	number: number
	title?: string
	state?: string
	body?: string | null
	comments?: number
	comments_url?: string
	user?: {
		login?: string
		avatar_url?: string
	}
	labels?: Array<{ name?: string }>
	pull_request?: {
		url: string
	}
}

type GitHubComment = {
	user?: {
		login?: string
	}
	body?: string | null
}

type GitHubPull = {
	additions?: number
	deletions?: number
	changed_files?: number
}

class GitHubLinkButton extends LinkButton {
	label = "Open on GitHub"
	url: string

	constructor(url: string) {
		super()
		this.url = url
	}
}

const requestHeaders = {
	Accept: "application/vnd.github+json",
	"User-Agent": "hermit"
}

const truncateText = (text: string, limit: number) =>
	text.length > limit ? `${text.slice(0, limit - 1)}…` : text

const fetchJson = async (url: string): Promise<unknown | null> => {
	try {
		const response = await fetch(url, { headers: requestHeaders })
		if (!response.ok) {
			return null
		}
		return (await response.json()) as unknown
	} catch {
		return null
	}
}

export default class GithubCommand extends BaseCommand {
	name = "github"
	description = "Find a GitHub issue or pull request"
	integrationTypes = [
		ApplicationIntegrationType.GuildInstall,
		ApplicationIntegrationType.UserInstall
	]
	contexts = [InteractionContextType.Guild, InteractionContextType.BotDM]
	options = [
		{
			name: "number",
			description: "Issue or pull request number",
			type: ApplicationCommandOptionType.Integer as const,
			required: true
		},
		{
			name: "user",
			description: "Repository owner (default: openclaw)",
			type: ApplicationCommandOptionType.String as const
		},
		{
			name: "repo",
			description: "Repository name (default: hermit)",
			type: ApplicationCommandOptionType.String as const
		}
	]

	async run(interaction: CommandInteraction) {
		const number = interaction.options.getInteger("number", true)
		const owner = interaction.options.getString("user") ?? "openclaw"
		const repo = interaction.options.getString("repo") ?? "hermit"
		const repoName = `${owner}/${repo}`
		const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`

		let response: Response

		try {
			response = await fetch(apiUrl, { headers: requestHeaders })
		} catch (error) {
			await interaction.reply({
				components: [
					new Container(
						[new TextDisplay(`Couldn’t reach GitHub for ${repoName}.`)],
						{ accentColor: "#f85149" }
					)
				]
			})
			return
		}

		if (!response.ok) {
			const message =
				response.status === 404
					? `No issue or pull request #${number} found in ${repoName}.`
					: `GitHub returned ${response.status} for ${repoName}.`

			await interaction.reply({
				components: [
					new Container([new TextDisplay(message)], { accentColor: "#f85149" })
				]
			})
			return
		}

		const issue = (await response.json()) as GitHubIssue
		const isPullRequest = Boolean(issue.pull_request)
		const typeLabel = isPullRequest ? "Pull Request" : "Issue"
		const title = issue.title ?? "Untitled"
		const state = issue.state ?? "unknown"
		const author = issue.user?.login ?? "unknown"
		const labels = issue.labels?.map((label) => label.name).filter(Boolean) ?? []
		const avatarUrl =
			issue.user?.avatar_url ??
			"https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
		const accentColor = isPullRequest
			? "#a371f7"
			: state === "open"
				? "#3fb950"
				: "#f85149"
		const labelsDisplay = labels.length > 0 ? labels.join(", ") : "None"
		const commentsCount = issue.comments ?? 0
		const bodyContent = issue.body?.replace(/\s+/g, " ").trim()
		const bodySummary = bodyContent
			? truncateText(bodyContent, 280)
			: "No description provided."

		let prStatsText = "Changes: unavailable"
		if (isPullRequest) {
			const prData = (await fetchJson(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`
			)) as GitHubPull | null
			if (prData) {
				const additions = prData.additions ?? 0
				const deletions = prData.deletions ?? 0
				const files = prData.changed_files ?? 0
				prStatsText = `+${additions} / -${deletions} • ${files} files`
			}
		}

		const commentsUrl = issue.comments_url
			? `${issue.comments_url}?per_page=3`
			: `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=3`
		const commentData = (await fetchJson(commentsUrl)) as GitHubComment[] | null
		const commentLines = (commentData ?? []).map((comment) => {
			const commentAuthor = comment.user?.login ?? "unknown"
			const commentBody = comment.body?.replace(/\s+/g, " ").trim() ?? ""
			const snippet = commentBody
				? truncateText(commentBody, 120)
				: "No comment text."
			return `- **${commentAuthor}**: ${snippet}`
		})
		const commentsDisplay =
			commentLines.length > 0 ? commentLines.join("\n") : "No comments yet."

		const container = new Container(
			[
				new Section(
					[
						new TextDisplay(`### ${typeLabel} #${issue.number}`),
						new TextDisplay(`**${title}**`),
						new TextDisplay(`Repo: ${repoName}`)
					],
					new Thumbnail(avatarUrl)
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay("### Summary"),
				new TextDisplay(bodySummary),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay("### Details"),
				new TextDisplay(`State: **${state}**`),
				new TextDisplay(`Author: **${author}**`),
				new TextDisplay(`Labels: ${labelsDisplay}`),
				new TextDisplay(`Comments: **${commentsCount}**`)
			],
			{ accentColor }
		)

		if (isPullRequest) {
			container.components.push(
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay("### PR Changes"),
				new TextDisplay(prStatsText)
			)
		}

		container.components.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(`### Recent Comments (${commentsCount})`),
			new TextDisplay(commentsDisplay),
			new Separator({ divider: true, spacing: "small" }),
			new Section(
				[new TextDisplay("**Open on GitHub**")],
				new GitHubLinkButton(issue.html_url)
			)
		)

		await interaction.reply({
			components: [container]
		})
	}
}
