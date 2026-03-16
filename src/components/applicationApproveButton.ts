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
import { writeAuditLog } from "../lib/auditLogger.js"
import { TEAM_DISPLAY_NAMES } from "../types/onboarding.js"
import type { TeamSlug } from "../types/onboarding.js"

export default class ApplicationApproveButton extends Button {
	customId = "onboarding-app-approve"
	label = "Approve"
	style = ButtonStyle.Success
	defer = true

	constructor(applicationId?: string) {
		super()
		if (applicationId) {
			this.customId = `onboarding-app-approve:applicationId=${applicationId}`
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

		// 3. Check: caller must be a full team member OR team lead for the application's team
		const guild = interaction.guild
		const callerIsLead = await isTeamLead(callerId, team)
		const callerMember = guild ? await guild.fetchMember(callerId) : null
		const callerRoles = callerMember?.roles ?? []
		const callerIsFullMember = await isFullTeamMember(callerRoles, team)

		if (!callerIsLead && !callerIsFullMember) {
			await interaction.reply({
				content: `You must be a full member or Team Lead of the **${teamDisplayName}** team to approve applications.`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 4. Check: caller not already in approvedBy array
		const currentApprovedBy: string[] = application.approvedBy ?? []
		if (currentApprovedBy.includes(callerId)) {
			await interaction.reply({
				content: "You have already approved this application.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 5. Add caller to approvedBy
		const updatedApprovedBy = [...currentApprovedBy, callerId]

		// 6. Check if approval threshold is met
		const shouldTransition =
			callerIsLead || updatedApprovedBy.length >= 2

		if (!shouldTransition) {
			// Partial approval — save and acknowledge
			await db
				.update(applications)
				.set({ approvedBy: updatedApprovedBy })
				.where(eq(applications.id, applicationId))

			await writeAuditLog({
				actorId: callerId,
				action: "APPLICATION_PARTIAL_APPROVE",
				applicationId,
				details: {
					team,
					approvedBy: updatedApprovedBy,
					approvalCount: updatedApprovedBy.length,
				},
			})

			await interaction.reply({
				content: `Approval recorded (${updatedApprovedBy.length}/2). One more full member approval is needed, or a Team Lead can approve immediately.`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 7. Transition to TRIAL_ACTIVE
		const teamConfig = await getTeamConfig(team)

		await db
			.update(applications)
			.set({
				status: "TRIAL_ACTIVE",
				approvedBy: updatedApprovedBy,
				reviewedAt: new Date(),
			})
			.where(eq(applications.id, applicationId))

		// Grant the team's trialRoleId to the user via REST
		const userId = application.userId
		const guildId = application.guildId
		if (teamConfig.trialRoleId) {
			try {
				await interaction.client.rest.put(
					`/guilds/${guildId}/members/${userId}/roles/${teamConfig.trialRoleId}`,
					{ body: {} },
				)
			} catch (err) {
				console.error(
					`[applicationApproveButton] Failed to grant trial role to ${userId}:`,
					err,
				)
			}
		}

		// DM the user: congratulations
		await dmUser(
			interaction.client,
			userId,
			`Congratulations! Your application for the **${teamDisplayName}** team has been approved. You're now a Trial ${teamDisplayName}! Welcome aboard — a Team Lead will be in touch with next steps.`,
		)

		// Post to mod log
		await postToModLog(interaction.client, {
			content: `**Application approved** — <@${userId}> is now a Trial **${teamDisplayName}**. Approved by <@${callerId}>${callerIsLead ? " (Team Lead)" : ""}.`,
			allowed_mentions: { parse: [] },
		})

		// Write audit log
		await writeAuditLog({
			actorId: callerId,
			action: "APPLICATION_APPROVED",
			applicationId,
			details: {
				userId,
				team,
				approvedBy: updatedApprovedBy,
				approvedByLead: callerIsLead,
				trialRoleId: teamConfig.trialRoleId,
			},
		})

		// Edit the review message in the team channel to show approved status
		if (application.reviewMessageId && teamConfig.channelId) {
			await editMessage(
				interaction.client,
				teamConfig.channelId,
				application.reviewMessageId,
				{
					content: `**Application APPROVED — ${teamDisplayName}**\n\n<@${userId}> has been approved as Trial **${teamDisplayName}**.\n\nApproved by <@${callerId}>${callerIsLead ? " (Team Lead)" : ` and ${updatedApprovedBy.length - 1} other(s)`}.\n\n~~Pending review~~ ✅`,
					components: [],
					allowed_mentions: { parse: [] },
				},
			)
		}

		await interaction.reply({
			content: `<@${userId}>'s application has been approved. They've been granted the Trial ${teamDisplayName} role and notified via DM.`,
			allowedMentions: { parse: [] },
		})
	}
}
