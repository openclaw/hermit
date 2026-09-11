import type { FormAction, FormConfig, FormTarget } from "./types.js"
import type { FormSubmission } from "../db/schema.js"
import { getRuntimeEnv } from "../runtime/env.js"
import { getGitHubHeaders } from "../utils/githubAuth.js"
import { parseSubmissionPayload } from "./submissions.js"
import { normalizeRedditUsername, upsertRedditModerationContext } from "./redditContext.js"

const discordApiBase = "https://discord.com/api/v10"

export const resolveTarget = (target: FormTarget, submission: FormSubmission) => {
	if (target === "authUser") {
		return submission.applicantId ?? ""
	}
	if (target === "authUsername") {
		return submission.applicantUsername ?? ""
	}
	if (target === "clawhubUserId") {
		return parseSubmissionPayload(submission).clawhubUserId ?? ""
	}
	return parseSubmissionPayload(submission)[target] ?? target
}

const requireValue = (value: string, name: string) => {
	if (!value) {
		throw new Error(`${name} is not configured.`)
	}
	return value
}

const discordRequest = async (path: string, init: RequestInit = {}, okStatuses = [200, 201, 204]) => {
	const response = await fetch(`${discordApiBase}${path}`, {
		...init,
		headers: {
			Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`,
			"content-type": "application/json",
			...init.headers
		}
	})
	if (!okStatuses.includes(response.status)) {
		throw new Error(`Discord ${response.status}: ${await response.text()}`)
	}
	return response
}

const resolveDiscordAppeal = async (action: Extract<FormAction, { type: "discord.resolveAppeal" }>, submission: FormSubmission) => {
	const payload = parseSubmissionPayload(submission)
	const guildId = requireValue(action.guildId, "Discord guild ID")
	const target = resolveTarget(action.target, submission)
	if (payload.action === "muted") {
		await discordRequest(
			`/guilds/${guildId}/members/${target}`,
			{
				method: "PATCH",
				body: JSON.stringify({
					communication_disabled_until: null,
					reason: action.reason ?? `Form ${submission.id}`
				})
			}
		)
		return "discord.removeTimeout"
	}
	if (payload.action === "banned") {
		await discordRequest(
			`/guilds/${guildId}/bans/${target}`,
			{ method: "DELETE", body: JSON.stringify({ reason: action.reason ?? `Form ${submission.id}` }) }
		)
		return "discord.unban"
	}
	return "No active Discord punishment found."
}

const clawHubApiBase = () => (process.env["CLAWHUB_API_BASE"] || "https://clawhub.ai").replace(/\/$/, "")

const getClawHubHeaders = () => {
	const token = process.env["CLAWHUB_BAN_APPEALS_TOKEN"]
	if (!token) {
		throw new Error("CLAWHUB_BAN_APPEALS_TOKEN is not configured.")
	}
	return {
		Authorization: `Bearer ${token}`,
		"content-type": "application/json"
	}
}

export const clawHubUnbanRequest = async (
	action: Extract<FormAction, { type: "clawhub.unbanUser" }>,
	submission: FormSubmission,
	options: { reviewerDiscordId?: string }
) => {
	const target = resolveTarget("clawhubUserId", submission)
	if (!target) {
		throw new Error("ClawHub user ID is missing from submission context.")
	}
	if (!options.reviewerDiscordId) {
		throw new Error("Reviewer Discord ID is missing.")
	}
	const response = await fetch(`${clawHubApiBase()}/api/v1/users/ban-appeal-unban`, {
		method: "POST",
		headers: getClawHubHeaders(),
		body: JSON.stringify({
			userId: target,
			reason: action.reason ?? `Form ${submission.id}`,
			reviewerDiscordId: options.reviewerDiscordId
		})
	})
	if (!response.ok) {
		throw new Error(`ClawHub ${response.status}: ${await response.text()}`)
	}
	return "clawhub.unbanUser"
}

const redditRequest = async (action: Extract<FormAction, { type: "reddit.unbanSubredditUser" }>, submission: FormSubmission) => {
	const url = requireValue(process.env.DEVVIT_REDDIT_ACTION_URL ?? "", "DEVVIT_REDDIT_ACTION_URL")
	const secret = requireValue(process.env.DEVVIT_REDDIT_BRIDGE_SECRET ?? "", "DEVVIT_REDDIT_BRIDGE_SECRET")
	const username = normalizeRedditUsername(resolveTarget(action.target, submission))
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			action: "unban",
			subreddit: action.subreddit,
			username,
			reason: action.reason ?? `Form ${submission.id}`
		})
	})
	if (!response.ok) {
		throw new Error(`Devvit Reddit action ${response.status}: ${await response.text()}`)
	}
	await upsertRedditModerationContext({
		subreddit: action.subreddit,
		username,
		action: "moderated",
		unaction: "reviewed",
		banReason: null,
		rawPayload: JSON.stringify({ source: "form-action", formSubmissionId: submission.id })
	})
	return "reddit.unbanSubredditUser"
}

const runAction = async (
	action: FormAction,
	submission: FormSubmission,
	options: { reviewerDiscordId?: string }
) => {
	if (action.type === "discord.resolveAppeal") {
		return resolveDiscordAppeal(action, submission)
	}
	if (action.type === "reddit.unbanSubredditUser") {
		return redditRequest(action, submission)
	}
	if (action.type === "clawhub.unbanUser") {
		return clawHubUnbanRequest(action, submission, options)
	}
	if (action.type === "discord.addRole" || action.type === "discord.removeRole") {
		const method = action.type === "discord.addRole" ? "PUT" : "DELETE"
		await discordRequest(
			`/guilds/${requireValue(action.guildId, "Discord guild ID")}/members/${resolveTarget(action.target, submission)}/roles/${action.roleId}`,
			{ method }
		)
		return action.type
	}
	if (action.type === "discord.ban" || action.type === "discord.unban") {
		const method = action.type === "discord.ban" ? "PUT" : "DELETE"
		await discordRequest(
			`/guilds/${requireValue(action.guildId, "Discord guild ID")}/bans/${resolveTarget(action.target, submission)}`,
			{ method, body: JSON.stringify({ reason: action.reason ?? `Form ${submission.id}` }) }
		)
		return action.type
	}
	if (action.type === "discord.timeout" || action.type === "discord.removeTimeout") {
		const until = action.type === "discord.timeout"
			? new Date(Date.now() + action.seconds * 1000).toISOString()
			: null
		await discordRequest(
			`/guilds/${requireValue(action.guildId, "Discord guild ID")}/members/${resolveTarget(action.target, submission)}`,
			{
				method: "PATCH",
				body: JSON.stringify({
					communication_disabled_until: until,
					reason: action.reason ?? `Form ${submission.id}`
				})
			}
		)
		return action.type
	}

	const target = resolveTarget(action.target, submission)
	const method = action.type === "github.blockOrgUser" ? "PUT" : "DELETE"
	const response = await fetch(
		`https://api.github.com/orgs/${action.org}/blocks/${target}`,
		{ method, headers: await getGitHubHeaders() }
	)
	if (!response.ok && response.status !== 204) {
		throw new Error(`GitHub ${response.status}: ${await response.text()}`)
	}
	return action.type
}

export const runFormActions = async (
	form: FormConfig,
	submission: FormSubmission,
	decision: "accept" | "deny",
	options: { reviewerDiscordId?: string } = {}
) => {
	const actions: readonly FormAction[] = form.actions[decision]
	const results: string[] = []
	for (const action of actions) {
		results.push(await runAction(action, submission, options))
	}
	return results.length > 0 ? results.join(", ") : "No external action required."
}
