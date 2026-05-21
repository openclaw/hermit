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
	/https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/gi

export type GitHubSummaryData = {
	repoName: string
	number: number
	url: string
	title: string
	state: string
	isPullRequest: boolean
	merged: boolean
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
	pull_request?: { url: string; merged_at?: string | null }
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

const formatState = (data: GitHubSummaryData) =>
	data.merged ? "MERGED" : data.state.toUpperCase()

const accentColor = (data: GitHubSummaryData) => {
	if (data.merged) {
		return "#a371f7"
	}
	return data.state === "open" ? "#3fb950" : "#f85149"
}

const normalizeText = (text: string) =>
	text.trim().toLowerCase().replace(/\s+/g, " ")

const isDuplicateSummary = (title: string, summary: string) => {
	const normalizedTitle = normalizeText(title)
	const normalizedSummary = normalizeText(summary)
	return normalizedTitle === normalizedSummary ||
		normalizedTitle.includes(normalizedSummary) ||
		normalizedSummary.includes(normalizedTitle)
}

const formatLabel = (label: string) => {
	if (label.startsWith("issue-rating: ")) {
		return label.slice("issue-rating: ".length)
	}
	if (label.startsWith("rating: ")) {
		return label.slice("rating: ".length)
	}
	if (label.startsWith("proof: ")) {
		return `proof: ${label.slice("proof: ".length)}`
	}
	if (label.startsWith("status: ")) {
		return label.slice("status: ".length)
	}
	if (label.startsWith("size: ")) {
		return `size: ${label.slice("size: ".length)}`
	}
	if (/^P[0-3]$/.test(label)) {
		return label
	}
	if (label.startsWith("clawsweeper:")) {
		return label.slice("clawsweeper:".length).replaceAll("-", " ")
	}
	return label
}

const formatLabels = (labels: string[]) => {
	if (labels.length === 0) {
		return "No key signals"
	}

	return labels.map(formatLabel).join(" • ")
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
		type: match[3],
		number: Number(match[4])
	}
}

export const parseGitHubIssueUrls = (content: string) => {
	const seen = new Set<string>()
	return [...content.matchAll(githubIssueUrlRegex)]
		.map((match) => ({
			owner: match[1],
			repo: match[2],
			type: match[3],
			number: Number(match[4])
		}))
		.filter((match) => {
			const key = `${match.owner}/${match.repo}/${match.type}#${match.number}`.toLowerCase()
			if (seen.has(key)) {
				return false
			}
			seen.add(key)
			return true
		})
}

export const getImportantGitHubLabels = (labels: string[]) => {
	const groups = [
		labels.filter((label) => label.startsWith("size:")),
		labels.filter((label) => /^P[0-3]$/.test(label)),
		labels.filter((label) => label.startsWith("proof:")),
		labels.filter((label) => label.startsWith("status:")),
		labels.filter((label) => importantClawsweeperLabels.has(label)),
		labels.filter((label) => label.startsWith("rating:") || label.startsWith("issue-rating:"))
	]

	return groups.flat()
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
		merged: Boolean(issue.pull_request?.merged_at),
		summary,
		labels: getImportantGitHubLabels(labels)
	}
}

export const buildGitHubSummaryContainer = (data: GitHubSummaryData) => {
	const type = data.isPullRequest ? "PR" : "Issue"
	const details = isDuplicateSummary(data.title, data.summary)
		? `_${formatLabels(data.labels)}_`
		: `${truncateText(data.summary, 140)}\n_${formatLabels(data.labels)}_`

	return new Container(
		[
			new Section(
				[
					new TextDisplay(`### [${formatState(data)}] ${type} #${data.number}`),
					new TextDisplay(`**${truncateText(data.title, 90)}**`),
					new TextDisplay(details)
				],
				new GitHubLinkButton(data.url)
			)
		],
		{ accentColor: accentColor(data) }
	)
}
