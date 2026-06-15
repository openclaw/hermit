import type { FormConfig, FormField } from "./src/forms/types.js"

export const formSettings = {
	reviewChannelId: "1467242758183059536",
	reviewRoleId: "1477360613125787678",
	clawhubAppealReviewChannelId: "1498032057337647295",
	clawhubAppealReviewRoleId: "1509967254870298794",
	shadowChannelId: "1464886408090226902",
	shadowReviewRoleId: "1477504469473427497",
	discordGuildId: "1456350064065904867",
	githubOrg: "openclaw",
	redditSubreddit: "openclaw"
}

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
		reviewChannelId: formSettings.reviewChannelId,
		reviewRoleId: formSettings.reviewRoleId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "discord.resolveAppeal",
					guildId: formSettings.discordGuildId,
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
		reviewChannelId: formSettings.reviewChannelId,
		reviewRoleId: formSettings.reviewRoleId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "discord.resolveAppeal",
					guildId: formSettings.discordGuildId,
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
		reviewChannelId: formSettings.reviewChannelId,
		reviewRoleId: formSettings.reviewRoleId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "github.unblockOrgUser",
					org: formSettings.githubOrg,
					target: "authUsername"
				}
			],
			deny: []
		}
	},
	{
		id: "clawhub",
		title: "ClawHub Ban Appeal",
		description: "Request a ClawHub account ban review.",
		auth: "github",
		requiredAction: "banned",
		reviewChannelId: formSettings.clawhubAppealReviewChannelId,
		reviewRoleId: formSettings.clawhubAppealReviewRoleId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "clawhub.unbanUser",
					target: "clawhubUserId",
					reason: "Appeal accepted."
				}
			],
			deny: []
		}
	},
	{
		id: "clawhub-content-rights",
		title: "ClawHub Content Rights Request",
		description: "Report rights concerns involving content published on ClawHub.",
		auth: null,
		reviewChannelId: formSettings.clawhubAppealReviewChannelId,
		reviewRoleId: formSettings.clawhubAppealReviewRoleId,
		successMessage: "Submitted. We sent a receipt to the email address you provided.",
		fields: [
			{
				id: "requesterName",
				label: "Your name",
				type: "text",
				required: true
			},
			{
				id: "organization",
				label: "Organization",
				type: "text",
				required: true
			},
			{
				id: "email",
				label: "Email address",
				type: "text",
				required: true
			},
			{
				id: "clawhubUrls",
				label: "ClawHub URLs",
				type: "textarea",
				required: true,
				placeholder: "One https://clawhub.ai/... URL per line"
			},
			{
				id: "explanation",
				label: "Explain the rights concern",
				type: "textarea",
				required: true
			},
			{
				id: "attachments",
				label: "Supporting evidence",
				type: "file",
				required: false,
				accept: ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.doc,.docx",
				multiple: true
			}
		],
		actions: { accept: [], deny: [] }
	},
	{
		id: "reddit",
		title: "Reddit Ban Appeal",
		description: "Request a Reddit ban review.",
		auth: "reddit",
		requiredAction: "banned",
		reviewChannelId: formSettings.reviewChannelId,
		reviewRoleId: formSettings.reviewRoleId,
		successMessage: "Submitted.",
		fields: appealFields,
		actions: {
			accept: [
				{
					type: "reddit.unbanSubredditUser",
					subreddit: formSettings.redditSubreddit,
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
		reviewChannelId: formSettings.shadowChannelId,
		reviewRoleId: formSettings.shadowReviewRoleId,
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
