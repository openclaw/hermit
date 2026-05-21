import {
	Container,
	LinkButton,
	Section,
	TextDisplay
} from "@buape/carbon"
import { getGitHubHeaders } from "./githubAuth.js"

const importantClawsweeperLabels = new Set([
	"clawsweeper:current-main-repro",
	"clawsweeper:source-repro",
	"clawsweeper:not-repro-on-main",
	"clawsweeper:fix-shape-clear",
	"clawsweeper:queueable-fix",
	"clawsweeper:no-new-fix-pr",
	"clawsweeper:needs-info",
	"clawsweeper:needs-live-repro",
	"clawsweeper:needs-maintainer-review",
	"clawsweeper:needs-product-decision",
	"clawsweeper:human-review",
	"clawsweeper:merge-ready",
	"clawsweeper:automerge"
])

const githubIssueUrlRegex =
	/https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/gi

export type GitHubSummaryData = {
	repoName: string
	number: number
	url: string
	title: string
	state: string
	isPullRequest: boolean
	summary: string
	labels: string[]
}

type GitHubIssue = {
	html_url: string
	number: number
	title?: string
	state?: string
	body?: string | null
	labels?: Array<{ name?: string }>
	pull_request?: { url: string }
}

class GitHubLinkButton extends LinkButton {
	label = "Open"
	url: string

	constructor(url: string) {
		super()
		this.url = url
	}
}

const truncateText = (text: string, limit: number) =>
	text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

const formatState = (state: string) => state.toUpperCase()

const formatLabel = (label: string) => {
	if (label.startsWith("issue-rating: ")) {
		return `Issue rating: ${label.slice("issue-rating: ".length)}`
	}
	if (label.startsWith("rating: ")) {
		return `PR rating: ${label.slice("rating: ".length)}`
	}
	if (label.startsWith("proof: ")) {
		return `Proof: ${label.slice("proof: ".length)}`
	}
	if (label.startsWith("status: ")) {
		return `Status: ${label.slice("status: ".length)}`
	}
	if (label.startsWith("size: ")) {
		return `Size: ${label.slice("size: ".length)}`
	}
	if (label.startsWith("clawsweeper:")) {
		return `ClawSweeper: ${label.slice("clawsweeper:".length).replaceAll("-", " ")}`
	}
	return label
}

const formatLabels = (labels: string[]) => {
	if (labels.length === 0) {
		return "No important ClawSweeper labels"
	}

	const shown = labels.slice(0, 8).map((label) => `- ${formatLabel(label)}`)
	if (labels.length > shown.length) {
		shown.push(`- +${labels.length - shown.length} more`)
	}
	return shown.join("\n")
}

const stripMarkdown = (text: string) =>
	text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/[#>*_~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()

const openAiSummary = async (title: string, body: string | null | undefined) => {
	const apiKey = process.env.OPENAI_API_KEY
	if (!apiKey) {
		return null
	}

	try {
		const response = await fetch("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: "gpt-4.1-mini",
				input: [
					{
						role: "system",
						content: "Summarize GitHub issues or pull requests in 1-2 concise sentences, <=220 characters. No markdown."
					},
					{
						role: "user",
						content: `Title: ${title}\n\nBody: ${stripMarkdown(body ?? "").slice(0, 4000)}`
					}
				],
				max_output_tokens: 90
			})
		})

		if (!response.ok) {
			return null
		}

		const data = await response.json() as {
			output_text?: string
			output?: Array<{ content?: Array<{ text?: string }> }>
		}
		return data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean) ?? null
	} catch {
		return null
	}
}

export const parseGitHubIssueUrl = (content: string) => {
	const match = [...content.matchAll(githubIssueUrlRegex)][0]
	if (!match) {
		return null
	}
	return {
		owner: match[1],
		repo: match[2],
		number: Number(match[3])
	}
}

export const parseGitHubIssueUrls = (content: string) => {
	const seen = new Set<string>()
	return [...content.matchAll(githubIssueUrlRegex)]
		.map((match) => ({
			owner: match[1],
			repo: match[2],
			number: Number(match[3])
		}))
		.filter((match) => {
			const key = `${match.owner}/${match.repo}#${match.number}`.toLowerCase()
			if (seen.has(key)) {
				return false
			}
			seen.add(key)
			return true
		})
}

export const getImportantGitHubLabels = (labels: string[]) => {
	const important = labels.filter(
		(label) =>
			label.startsWith("size:") ||
			label.startsWith("rating:") ||
			label.startsWith("issue-rating:") ||
			label.startsWith("proof:") ||
			label.startsWith("status:") ||
			importantClawsweeperLabels.has(label)
	)

	return important.length > 0 ? important : labels.filter((label) => label === "clawsweeper")
}

export const fetchGitHubSummaryData = async (
	owner: string,
	repo: string,
	number: number
): Promise<GitHubSummaryData | null> => {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
		{ headers: await getGitHubHeaders() }
	)
	if (!response.ok) {
		return null
	}

	const issue = await response.json() as GitHubIssue
	const labels = issue.labels?.flatMap((label) => label.name ? [label.name] : []) ?? []
	const title = issue.title ?? "Untitled"
	const summaryText = (await openAiSummary(title, issue.body)) ?? stripMarkdown(title)
	const summary = truncateText(summaryText || "No summary.", 220)

	return {
		repoName: `${owner}/${repo}`,
		number: issue.number,
		url: issue.html_url,
		title,
		state: issue.state ?? "unknown",
		isPullRequest: Boolean(issue.pull_request),
		summary,
		labels: getImportantGitHubLabels(labels)
	}
}

export const buildGitHubSummaryContainer = (data: GitHubSummaryData) => {
	const type = data.isPullRequest ? "PR" : "Issue"
	return new Container(
		[
			new Section(
				[
					new TextDisplay(`### [${formatState(data.state)}] ${type} #${data.number}`),
					new TextDisplay(`**${data.title}**`),
					new TextDisplay(data.summary)
				],
				new GitHubLinkButton(data.url)
			),
			new TextDisplay(`**Signals**\n${formatLabels(data.labels)}`)
		],
		{ accentColor: data.isPullRequest ? "#a371f7" : data.state === "open" ? "#3fb950" : "#f85149" }
	)
}
