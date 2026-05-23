import type { FormConfig, FormField } from "./src/forms/types.js"

const reviewChannelId = "1467242758183059536"
const shadowChannelId = "1464886408090226902"
const discordGuildId = "1456350064065904867"
const githubOrg = "openclaw"
const redditSubreddit = "openclaw"

/*

{ACTION} = banned, muted, etc
{UNACTION} = unbanned, unmuted, etc

*/

const appealFields = [
	{
		id: "banReason",
		label: "Listed reason",
		type: "autofill",
		contextKey: "banReason"
	},
	{
		id: "appealReason",
		label: "Why should you be {UNACTION}?",
		type: "text",
		required: true
	},
	{
		id: "changedSince",
		label: "What will change if you are {UNACTION}?",
		type: "text",
		required: true
	},
	{
		id: "extraContext",
		label: "Anything else?",
		type: "text",
		required: false
	}
] satisfies FormField[]

export const formConfigs = [
	{
		id: "discord-ban",
		title: "Discord Ban Appeal",
		description: "Request a Discord ban review.",
		auth: "discord",
		requiredAction: "banned",
		reviewChannelId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "discord.resolveAppeal",
					guildId: discordGuildId,
					target: "authUser",
					reason: "Appeal accepted."
				}
			],
			deny: []
		}
	},
	{
		id: "discord-mute",
		title: "Discord Mute Appeal",
		description: "Request a Discord mute review.",
		auth: "discord",
		requiredAction: "muted",
		reviewChannelId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "discord.resolveAppeal",
					guildId: discordGuildId,
					target: "authUser",
					reason: "Appeal accepted."
				}
			],
			deny: []
		}
	},
	{
		id: "github",
		title: "GitHub Ban Appeal",
		description: "Request a GitHub ban review.",
		auth: "github",
		requiredAction: "banned",
		reviewChannelId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "github.unblockOrgUser",
					org: githubOrg,
					target: "authUsername"
				}
			],
			deny: []
		}
	},
	{
		id: "reddit",
		title: "Reddit Ban Appeal",
		description: "Request a Reddit ban review.",
		auth: "reddit",
		requiredAction: "banned",
		reviewChannelId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "reddit.unbanSubredditUser",
					subreddit: redditSubreddit,
					target: "authUsername",
					reason: "Appeal accepted."
				}
			],
			deny: []
		}
	},
	{
		id: "report-mod",
		title: "Report a Moderator",
		description: "Report moderator misconduct.",
		auth: ["discord", "github", "reddit"],
		reviewChannelId: shadowChannelId,
		successMessage: "Submitted.",
		fields: [
			{
				id: "moderator",
				label: "Who are you reporting?",
				type: "text",
				required: true
			},
			{
				id: "reason",
				label: "Why are you reporting them?",
				type: "textarea",
				required: true
			},
			{
				id: "falseReportAcknowledgement",
				label: "I understand that a false report will result in punishment.",
				type: "checkbox",
				required: true,
				value: "yes"
			}
		],
		actions: { accept: [], deny: [] }
	}
] satisfies FormConfig[]
