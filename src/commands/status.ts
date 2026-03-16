import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	Container,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { and, eq, notInArray } from "drizzle-orm"
import BaseCommand from "./base.js"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { TERMINAL_STATUSES, TEAM_DISPLAY_NAMES } from "../types/onboarding.js"
import { getTeamConfig } from "../lib/configStore.js"

const STATUS_LABELS: Record<string, string> = {
	FORM_SENT: "Form Sent",
	APPLICATION_PENDING_REVIEW: "Application Pending Review",
	APPLICATION_DENIED: "Application Denied",
	TRIAL_ACTIVE: "Trial Active",
	TRIAL_FAILED: "Trial Failed",
	AWAITING_TEAM_VOTE: "Awaiting Team Vote",
	VOTE_FAILED: "Vote Failed",
	AWAITING_LEAD_APPROVAL: "Awaiting Lead Approval",
	PROMOTED_BY_LEAD: "Promoted",
	PROMOTED_BY_LEAD_INACTION: "Promoted (Auto)",
	DENIED_BY_LEAD: "Denied by Lead",
}

const NEXT_STEPS: Record<string, string> = {
	FORM_SENT: "Your application form has been sent. Please complete it to proceed.",
	APPLICATION_PENDING_REVIEW:
		"Your application is waiting for a team lead to review it. Hang tight!",
	TRIAL_ACTIVE:
		"Your trial is active! Do your best and a team vote will be initiated when the trial period ends.",
	AWAITING_TEAM_VOTE:
		"The team is voting on your promotion. Results will be shared soon.",
	AWAITING_LEAD_APPROVAL:
		"The team vote passed! Your team lead will make the final call.",
}

export default class StatusCommand extends BaseCommand {
	name = "status"
	description = "Check your onboarding status"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = []

	async run(interaction: CommandInteraction) {
		const userId = interaction.user?.id
		if (!userId) {
			await interaction.reply({
				components: [
					new Container(
						[new TextDisplay("Could not determine your user ID.")],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const application = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.userId, userId),
					notInArray(applications.status, TERMINAL_STATUSES)
				)
			)
			.get()

		if (!application) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("You don't have an active onboarding application."),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const teamConfig = await getTeamConfig(application.team)
		const teamName = TEAM_DISPLAY_NAMES[application.team]
		const statusLabel = STATUS_LABELS[application.status] ?? application.status
		const nextStep = NEXT_STEPS[application.status] ?? "No further action required from you at this time."

		let trialInfo = ""
		if (application.status === "TRIAL_ACTIVE" && teamConfig.trialDurationDays) {
			const startMs = application.createdAt?.getTime() ?? Date.now()
			const endMs = startMs + teamConfig.trialDurationDays * 24 * 60 * 60 * 1000
			const daysRemaining = Math.max(
				0,
				Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000))
			)
			trialInfo = `\n**Days Remaining:** ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`
		}

		if (application.status === "AWAITING_LEAD_APPROVAL" && application.leadApprovalDeadline) {
			const daysRemaining = Math.max(
				0,
				Math.ceil(
					(application.leadApprovalDeadline.getTime() - Date.now()) /
						(24 * 60 * 60 * 1000)
				)
			)
			trialInfo = `\n**Lead Decision Deadline:** ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`
		}

		const container = new Container(
			[
				new TextDisplay("### Your Onboarding Status"),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Team:** ${teamName}`,
						`**Status:** ${statusLabel}${trialInfo}`,
						`**Applied:** <t:${Math.floor((application.createdAt?.getTime() ?? Date.now()) / 1000)}:R>`,
					].join("\n")
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(`**Next Steps:** ${nextStep}`),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}
