import {
	Modal,
	Label,
	TextInput,
	type ModalInteraction,
	type ComponentData,
} from "@buape/carbon"
import { TextInputStyle } from "discord-api-types/v10"
import { eq } from "drizzle-orm"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { runAutoChecks } from "../lib/autoChecks.js"
import {
	dmUser,
	postToTeamChannel,
	postToModLog,
} from "../lib/notifications.js"
import { writeAuditLog } from "../lib/auditLogger.js"
import { getGlobalConfig } from "../lib/configStore.js"
import { TEAM_DISPLAY_NAMES } from "../types/onboarding.js"
import type { TeamSlug } from "../types/onboarding.js"

// ─── TextInput components ────────────────────────────────────────────────────

class TimezoneInput extends TextInput {
	customId = "timezone"
	style = TextInputStyle.Short
	maxLength = 50
	required = true
	placeholder = "e.g. UTC+1, EST, PST"
}

class AvailabilityInput extends TextInput {
	customId = "availability"
	style = TextInputStyle.Paragraph
	maxLength = 500
	required = true
	placeholder = "e.g. Weekdays 6pm–10pm UTC, weekends flexible"
}

class MotivationInput extends TextInput {
	customId = "motivation"
	style = TextInputStyle.Paragraph
	maxLength = 1000
	required = true
	placeholder = "Tell us why you want to join this team."
}

// ─── Labels that wrap each input ────────────────────────────────────────────

class TimezoneLabel extends Label {
	label = "Your timezone (e.g. UTC+1, EST, PST)"
	constructor() {
		super(new TimezoneInput())
	}
}

class AvailabilityLabel extends Label {
	label = "Your general availability (days/times)"
	constructor() {
		super(new AvailabilityInput())
	}
}

class MotivationLabel extends Label {
	label = "Why do you want to join this team?"
	constructor() {
		super(new MotivationInput())
	}
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export default class ApplicationModal extends Modal {
	title = "Staff Application Form"
	customId: string
	components = [
		new TimezoneLabel(),
		new AvailabilityLabel(),
		new MotivationLabel(),
	]

	constructor(applicationId: string) {
		super()
		this.customId = `application-modal:applicationId=${applicationId}`
	}

	async run(interaction: ModalInteraction, data: ComponentData) {
		const applicationId = String(data.applicationId)

		// 1. Load the application from DB
		const application = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId))
			.get()

		if (!application) {
			await interaction.reply({
				content: "Application not found. Please contact a Team Lead.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 2. Verify status is FORM_SENT
		if (application.status !== "FORM_SENT") {
			await interaction.reply({
				content: "This application has already been submitted.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 3. Extract form values
		const timezone = interaction.fields.getText("timezone", true)
		const availability = interaction.fields.getText("availability", true)
		const motivation = interaction.fields.getText("motivation", true)

		// 4. Update application with form data and advance status
		await db
			.update(applications)
			.set({
				timezone,
				availability,
				motivation,
				status: "APPLICATION_PENDING_REVIEW",
			})
			.where(eq(applications.id, applicationId))

		const team = application.team as TeamSlug
		const teamDisplayName = TEAM_DISPLAY_NAMES[team]
		const guildId = application.guildId
		const userId = application.userId

		// 5. Run auto-checks
		const autoCheckResult = await runAutoChecks(userId, guildId, interaction.client)

		if (!autoCheckResult.passed) {
			// Auto-check FAILED → deny the application
			const reason = autoCheckResult.reason

			let rejectionMessage: string
			switch (reason.type) {
				case "SERVER_TENURE":
					rejectionMessage = `Your application was automatically reviewed and could not proceed at this time. You need at least **${reason.requiredDays} days** in the server (you have ${reason.tenureDays} days).`
					break
				case "HAS_BAN":
					rejectionMessage = `Your application was automatically reviewed and could not proceed at this time due to your account history in this server.`
					break
				case "PENDING_APPLICATION":
					rejectionMessage = `Your application was automatically reviewed and could not proceed. You already have an active or pending application for the **${TEAM_DISPLAY_NAMES[reason.team]}** team.`
					break
				case "IN_COOLDOWN": {
					const reapplyDate = reason.reapplyAt.toLocaleDateString("en-US", {
						year: "numeric",
						month: "long",
						day: "numeric",
					})
					rejectionMessage = `Your application was automatically reviewed and could not proceed at this time. You may reapply after **${reapplyDate}**.`
					break
				}
				default:
					rejectionMessage = `Your application was automatically reviewed and could not proceed at this time.`
			}

			await db
				.update(applications)
				.set({
					status: "APPLICATION_DENIED",
					deniedBy: "SYSTEM",
					reviewedAt: new Date(),
				})
				.where(eq(applications.id, applicationId))

			await writeAuditLog({
				actorId: "SYSTEM",
				action: "APPLICATION_AUTO_DENIED",
				applicationId,
				details: { userId, team, reason },
			})

			// DM the user with rejection reason
			await dmUser(interaction.client, userId, rejectionMessage)

			// Notify the initiator
			await dmUser(
				interaction.client,
				application.initiatedBy,
				`Application from <@${userId}> for **${teamDisplayName}** was automatically denied.\nReason: ${reason.type}`,
			)

			await interaction.reply({
				content: "Your application has been submitted and reviewed. Please check your DMs for the result.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 6. Auto-check PASSED → post review embed to team channel with Approve/Deny buttons
		const reviewContent = [
			`**New Application — ${teamDisplayName}**`,
			"",
			`<@${userId}> has applied to join the **${teamDisplayName}** team.`,
			"",
			`**Timezone:** ${timezone}`,
			`**Availability:** ${availability}`,
			`**Motivation:** ${motivation}`,
			"",
			`_Requires 2 full team member approvals, or 1 Team Lead approval. Any full member can deny._`,
		].join("\n")

		const reviewMessageId = await postToTeamChannel(interaction.client, team, {
			content: reviewContent,
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 3, // Success / green
							label: "Approve",
							custom_id: `onboarding-app-approve:applicationId=${applicationId}`,
						},
						{
							type: 2,
							style: 4, // Danger / red
							label: "Deny",
							custom_id: `onboarding-app-deny:applicationId=${applicationId}`,
						},
					],
				},
			],
		})

		// Save the returned message ID
		if (reviewMessageId) {
			await db
				.update(applications)
				.set({ reviewMessageId })
				.where(eq(applications.id, applicationId))
		}

		await writeAuditLog({
			actorId: userId,
			action: "APPLICATION_SUBMITTED",
			applicationId,
			details: { team, guildId },
		})

		await postToModLog(interaction.client, {
			content: `**Application submitted** — <@${userId}> applied for **${teamDisplayName}**. Pending review in the team channel.`,
			allowed_mentions: { parse: [] },
		})

		// Let the user know the form was received
		const globalConfig = await getGlobalConfig()
		await interaction.reply({
			content: `Your application for the **${teamDisplayName}** team has been submitted and is pending review. You'll be notified once a decision is made.\n\n_If approved, the reapply cooldown is **${globalConfig.reapplyCooldownDays} days** after any declined application._`,
			flags: 64,
			allowedMentions: { parse: [] },
		})
	}
}
