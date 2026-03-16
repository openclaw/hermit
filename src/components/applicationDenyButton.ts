import {
	Button,
	ButtonStyle,
	type ButtonInteraction,
	type ComponentData,
} from "@buape/carbon"
import { eq } from "drizzle-orm"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { isTeamLead, isFullTeamMember } from "../lib/permissions.js"
import {
	dmUser,
	postToModLog,
	editMessage,
} from "../lib/notifications.js"
import { getTeamConfig } from "../lib/configStore.js"
import { getGlobalConfig } from "../lib/configStore.js"
import { writeAuditLog } from "../lib/auditLogger.js"
import { TEAM_DISPLAY_NAMES } from "../types/onboarding.js"
import type { TeamSlug } from "../types/onboarding.js"

export default class ApplicationDenyButton extends Button {
	customId = "onboarding-app-deny"
	label = "Deny"
	style = ButtonStyle.Danger
	defer = true

	constructor(applicationId?: string) {
		super()
		if (applicationId) {
			this.customId = `onboarding-app-deny:applicationId=${applicationId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const applicationId = String(data.applicationId)
		const callerId = interaction.user?.id
		if (!callerId) {
			await interaction.reply({
				content: "Could not determine your user ID.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 1. Load the application from DB
		const application = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId))
			.get()

		if (!application) {
			await interaction.reply({
				content: "Application not found.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		const team = application.team as TeamSlug
		const teamDisplayName = TEAM_DISPLAY_NAMES[team]

		// 2. Check: application status must be APPLICATION_PENDING_REVIEW
		if (application.status !== "APPLICATION_PENDING_REVIEW") {
			await interaction.reply({
				content: `This application is not in a reviewable state (current status: \`${application.status}\`).`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 3. Check: caller is full team member or team lead
		const guild = interaction.guild
		const callerIsLead = await isTeamLead(callerId, team)
		const callerMember = guild ? await guild.fetchMember(callerId) : null
		const callerRoles = callerMember?.roles ?? []
		const callerIsFullMember = await isFullTeamMember(callerRoles, team)

		if (!callerIsLead && !callerIsFullMember) {
			await interaction.reply({
				content: `You must be a full member or Team Lead of the **${teamDisplayName}** team to deny applications.`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 4. Transition to APPLICATION_DENIED
		await db
			.update(applications)
			.set({
				status: "APPLICATION_DENIED",
				deniedBy: callerId,
				reviewedAt: new Date(),
			})
			.where(eq(applications.id, applicationId))

		// DM the user with denial and cooldown information
		const globalConfig = await getGlobalConfig()
		const userId = application.userId
		const guildId = application.guildId

		await dmUser(
			interaction.client,
			userId,
			`Your application for the **${teamDisplayName}** team has been reviewed and was not approved at this time. You may reapply after **${globalConfig.reapplyCooldownDays} days**.`,
		)

		// Write audit log
		await writeAuditLog({
			actorId: callerId,
			action: "APPLICATION_DENIED",
			applicationId,
			details: {
				userId,
				team,
				guildId,
				deniedBy: callerId,
				callerIsLead,
			},
		})

		// Post to mod log
		await postToModLog(interaction.client, {
			content: `**Application denied** — <@${userId}>'s application for **${teamDisplayName}** was denied by <@${callerId}>${callerIsLead ? " (Team Lead)" : ""}.`,
			allowed_mentions: { parse: [] },
		})

		// Edit the review message to show denied status
		const teamConfig = await getTeamConfig(team)
		if (application.reviewMessageId && teamConfig.channelId) {
			await editMessage(
				interaction.client,
				teamConfig.channelId,
				application.reviewMessageId,
				{
					content: `**Application DENIED — ${teamDisplayName}**\n\n<@${userId}>'s application has been denied by <@${callerId}>${callerIsLead ? " (Team Lead)" : ""}.\n\n~~Pending review~~ ❌`,
					components: [],
					allowed_mentions: { parse: [] },
				},
			)
		}

		await interaction.reply({
			content: `<@${userId}>'s application has been denied. They've been notified via DM.`,
			allowedMentions: { parse: [] },
		})
	}
}
