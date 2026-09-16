import { formSettings } from "../../forms.config.js"
import type { FormConfig } from "./types.js"
import { getRuntimeEnv } from "../runtime/env.js"
import { getGitHubHeaders } from "../utils/githubAuth.js"
import { getRedditModerationContext, normalizeRedditUsername } from "./redditContext.js"

const discordApiBase = "https://discord.com/api/v10"
const githubApiBase = "https://api.github.com"
const noListedReason = "No listed reason found."
const notAvailable = "Not available"
const discordAuditBanAdd = 22
const discordAuditMemberUpdate = 24

const getDiscordHeaders = () => ({
	Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`,
	"content-type": "application/json"
})

const fetchDiscord = async <T>(path: string) => {
	const response = await fetch(`${discordApiBase}${path}`, {
		headers: getDiscordHeaders()
	})
	return response.ok ? { status: response.status, data: await response.json() as T } : { status: response.status, data: null }
}

const parseBarnacleReason = (reason?: string | null) => {
	if (!reason) {
		return {}
	}
	const ban = reason.match(/^\[(?<caseId>[^\]]+)]\s+(?<timestamp>\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2})\s+@(?<moderator>\S+)\s+\((?<duration>[^)]+)\):\s*(?<moderationReason>[\s\S]+)$/)
	if (ban?.groups) {
		return {
			caseId: ban.groups.caseId,
			timestamp: ban.groups.timestamp,
			moderator: ban.groups.moderator,
			duration: ban.groups.duration,
			banReason: ban.groups.moderationReason.trim(),
			moderationReason: ban.groups.moderationReason.trim()
		}
	}
	const mute = reason.match(/^(?<moderationReason>[\s\S]*?)\s*\((?<caseId>[A-Za-z0-9_-]+)\)$/)
	if (mute?.groups) {
		return {
			caseId: mute.groups.caseId,
			banReason: mute.groups.moderationReason.trim(),
			moderationReason: mute.groups.moderationReason.trim()
		}
	}
	return {
		banReason: reason,
		moderationReason: reason
	}
}

type DiscordAuditLog = {
	audit_log_entries?: Array<{
		action_type?: number
		target_id?: string | null
		user_id?: string | null
		reason?: string | null
		changes?: Array<{ key?: string; old_value?: unknown; new_value?: unknown }>
	}>
	users?: Array<{ id: string; username?: string; global_name?: string | null }>
}

const latestDiscordAuditEntry = async (input: { guildId: string; userId: string; actionType: number; timeoutOnly?: boolean }) => {
	const audit = await fetchDiscord<DiscordAuditLog>(
		`/guilds/${input.guildId}/audit-logs?action_type=${input.actionType}&limit=25`
	)
	const entry = audit.data?.audit_log_entries?.find((item) => {
		if (item.target_id !== input.userId) {
			return false
		}
		if (!input.timeoutOnly) {
			return true
		}
		return item.changes?.some((change) => change.key === "communication_disabled_until" && Boolean(change.new_value))
	})
	const moderator = entry?.user_id
		? audit.data?.users?.find((user) => user.id === entry.user_id)
		: null
	return entry ? {
		...parseBarnacleReason(entry.reason),
		moderator: moderator?.global_name ?? moderator?.username ?? entry.user_id ?? notAvailable
	} : null
}

const latestDiscordBan = async (userId: string) => {
	const guildId = formSettings.discordGuildId
	if (!guildId) {
		return null
	}
	const ban = await fetchDiscord<{
		reason?: string | null
		user?: { id?: string; username?: string; global_name?: string | null }
	}>(`/guilds/${guildId}/bans/${userId}`)
	if (!ban.data) {
		return null
	}
	const audit = await latestDiscordAuditEntry({ guildId, userId, actionType: discordAuditBanAdd })
	return {
		action: "banned",
		unaction: "unbanned",
		punishment: "Ban",
		duration: audit?.duration ?? "Permanent",
		banReason: audit?.banReason || ban.data.reason || noListedReason,
		moderationReason: audit?.moderationReason || ban.data.reason || noListedReason,
		caseId: audit?.caseId ?? notAvailable,
		moderator: audit?.moderator ?? notAvailable,
		...(audit?.timestamp ? { timestamp: audit.timestamp } : {}),
		account: ban.data.user?.global_name ?? ban.data.user?.username ?? userId
	}
}

const latestDiscordTimeout = async (userId: string) => {
	const guildId = formSettings.discordGuildId
	if (!guildId) {
		return null
	}
	const member = await fetchDiscord<{
		communication_disabled_until?: string | null
		user?: { id?: string; username?: string; global_name?: string | null }
	}>(`/guilds/${guildId}/members/${userId}`)
	if (!member.data?.communication_disabled_until) {
		return null
	}
	const audit = await latestDiscordAuditEntry({ guildId, userId, actionType: discordAuditMemberUpdate, timeoutOnly: true })
	return {
		action: "muted",
		unaction: "unmuted",
		punishment: "Mute",
		duration: `Until ${member.data.communication_disabled_until}`,
		banReason: audit?.banReason || noListedReason,
		moderationReason: audit?.moderationReason || noListedReason,
		caseId: audit?.caseId ?? notAvailable,
		moderator: audit?.moderator ?? notAvailable,
		account: member.data.user?.global_name ?? member.data.user?.username ?? userId
	}
}

const emptyDiscordContext = (user: { username: string }, message: string) => ({
	action: "moderated",
	unaction: "reviewed",
	punishment: "Unknown",
	duration: notAvailable,
	banReason: noListedReason,
	moderationReason: message,
	caseId: notAvailable,
	moderator: notAvailable,
	account: user.username
})

type GitHubAuditEvent = {
	action?: string
	actor?: string
	user?: string
	blocked_user?: string
	created_at?: string | number
	"@timestamp"?: string | number
}

const auditTimestamp = (event: GitHubAuditEvent) => {
	const value = event.created_at ?? event["@timestamp"]
	if (typeof value === "number") {
		return new Date(value).toISOString()
	}
	return value
}

const latestGitHubBlockAudit = async (org: string, username: string, headers: Record<string, string>) => {
	const url = new URL(`${githubApiBase}/orgs/${encodeURIComponent(org)}/audit-log`)
	url.searchParams.set("phrase", "action:org.block_user")
	url.searchParams.set("per_page", "100")
	const response = await fetch(url, { headers })
	const events = response.ok ? await response.json() as GitHubAuditEvent[] : []
	const event = events.find((item) => {
		const target = item.blocked_user ?? item.user
		return item.action === "org.block_user" && target?.toLowerCase() === username.toLowerCase()
	})
	return event ? {
		moderator: event.actor ?? notAvailable,
		timestamp: auditTimestamp(event) ?? notAvailable
	} : null
}

const latestGitHubContext = async (username: string) => {
	const org = formSettings.githubOrg
	const headers = await getGitHubHeaders()
	const response = await fetch(`${githubApiBase}/orgs/${encodeURIComponent(org)}/blocks/${encodeURIComponent(username)}`, {
		headers
	})
	const isBlocked = response.status === 204
	const audit = isBlocked ? await latestGitHubBlockAudit(org, username, headers).catch(() => null) : null
	return {
		action: isBlocked ? "banned" : "moderated",
		unaction: isBlocked ? "unbanned" : "reviewed",
		githubUser: username,
		banReason: isBlocked ? `Blocked by ${org}.` : noListedReason,
		moderator: audit?.moderator ?? notAvailable,
		timestamp: audit?.timestamp ?? notAvailable,
		scope: `${org} organization`,
		links: `https://github.com/${username}`
	}
}

type ClawHubBanAppealContext = {
	action?: "banned" | "moderated"
	userId?: string | null
	handle?: string | null
	displayName?: string | null
	banReason?: string | null
	bannedAt?: number | null
	auditAction?: string | null
	auditActorUserId?: string | null
}

const clawHubApiBase = () => (process.env["CLAWHUB_API_BASE"] || "https://clawhub.ai").replace(/\/$/, "")

const getClawHubHeaders = () => {
	const token = process.env["CLAWHUB_BAN_APPEALS_TOKEN"]
	if (!token) {
		throw new Error("CLAWHUB_BAN_APPEALS_TOKEN is not configured.")
	}
	return { Authorization: `Bearer ${token}` }
}

export const latestClawHubContext = async (providerAccountId: string) => {
	const url = new URL(`${clawHubApiBase()}/api/v1/users/ban-appeal-context`)
	url.searchParams.set("githubProviderAccountId", providerAccountId)
	const response = await fetch(url, { headers: getClawHubHeaders() })
	if (!response.ok) {
		throw new Error(`ClawHub ${response.status}: ${await response.text()}`)
	}
	const context = await response.json() as ClawHubBanAppealContext
	return {
		action: context.action ?? "moderated",
		unaction: context.action === "banned" ? "unbanned" : "reviewed",
		clawhubUserId: context.userId ?? "",
		clawhubHandle: context.handle ? `@${context.handle}` : notAvailable,
		account: context.displayName ?? context.handle ?? notAvailable,
		banReason: context.banReason || noListedReason,
		moderationReason: context.banReason || noListedReason,
		date: context.bannedAt ? new Date(context.bannedAt).toISOString() : notAvailable,
		scope: "ClawHub account",
		auditAction: context.auditAction ?? notAvailable,
		auditActorUserId: context.auditActorUserId ?? notAvailable,
		links: context.handle ? `${clawHubApiBase()}/${context.handle}` : clawHubApiBase()
	}
}

const latestRedditContext = async (username: string) => {
	const subreddit = formSettings.redditSubreddit
	const normalized = normalizeRedditUsername(username)
	const context = await getRedditModerationContext({ subreddit, username: normalized })
	return {
		action: context?.action ?? "moderated",
		unaction: context?.unaction ?? "reviewed",
		redditUser: `u/${normalized}`,
		banReason: context?.banReason || noListedReason,
		moderator: context?.moderator || notAvailable,
		scope: `r/${subreddit}`,
		links: `https://reddit.com/u/${normalized}`,
		...(context?.bannedAt ? { date: context.bannedAt } : {}),
		...(context?.expiresAt ? { expiresAt: context.expiresAt } : {})
	}
}

export const fetchFormContext = async (
	form: FormConfig,
	user: { id: string; username: string }
) => {
	if (form.id === "discord-ban") {
		return await latestDiscordBan(user.id) ?? emptyDiscordContext(user, "No active Discord ban found.")
	}
	if (form.id === "discord-mute") {
		return await latestDiscordTimeout(user.id) ?? emptyDiscordContext(user, "No active Discord mute found.")
	}
	if (form.id === "github") {
		return latestGitHubContext(user.username)
	}
	if (form.id === "clawhub") {
		return latestClawHubContext(user.id)
	}
	if (form.id === "reddit") {
		return latestRedditContext(user.username)
	}
	return {}
}
