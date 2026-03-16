import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	Container,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { and, desc, eq, inArray, notInArray } from "drizzle-orm"
import BaseCommand from "./base.js"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import {
	TERMINAL_STATUSES,
	TEAM_DISPLAY_NAMES,
	type TeamSlug,
} from "../types/onboarding.js"
import { getLeadTeams } from "../lib/permissions.js"

const TERMINAL_STATUS_LABELS: Record<string, string> = {
	APPLICATION_DENIED: "Application Denied",
	TRIAL_FAILED: "Trial Failed",
	VOTE_FAILED: "Vote Failed",
	PROMOTED_BY_LEAD: "Promoted",
	PROMOTED_BY_LEAD_INACTION: "Promoted (Auto)",
	DENIED_BY_LEAD: "Denied by Lead",
}

export default class OnboardingStatsCommand extends BaseCommand {
	name = "onboarding-stats"
	description = "View onboarding dashboard stats for your team"
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
						[new TextDisplay("Could not determine your identity.")],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const leadTeams = await getLeadTeams(userId)

		if (leadTeams.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You are not a team lead for any team."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		// Fetch all applications for these teams in parallel
		const [activeTrials, pendingReviews, pendingVotes, recentTerminal] =
			await Promise.all([
				db
					.select()
					.from(applications)
					.where(
						and(
							eq(applications.status, "TRIAL_ACTIVE"),
							inArray(applications.team, leadTeams)
						)
					)
					.all(),
				db
					.select()
					.from(applications)
					.where(
						and(
							eq(applications.status, "APPLICATION_PENDING_REVIEW"),
							inArray(applications.team, leadTeams)
						)
					)
					.all(),
				db
					.select()
					.from(applications)
					.where(
						and(
							eq(applications.status, "AWAITING_TEAM_VOTE"),
							inArray(applications.team, leadTeams)
						)
					)
					.all(),
				db
					.select()
					.from(applications)
					.where(
						and(
							inArray(applications.status, TERMINAL_STATUSES),
							inArray(applications.team, leadTeams)
						)
					)
					.orderBy(desc(applications.updatedAt))
					.limit(5)
					.all(),
			])

		const teamNames = leadTeams
			.map((t) => TEAM_DISPLAY_NAMES[t as TeamSlug])
			.join(", ")

		const recentLines =
			recentTerminal.length > 0
				? recentTerminal.map((app) => {
						const statusLabel =
							TERMINAL_STATUS_LABELS[app.status] ?? app.status
						const teamName = TEAM_DISPLAY_NAMES[app.team as TeamSlug]
						const updatedTimestamp = Math.floor(
							(app.updatedAt?.getTime() ?? Date.now()) / 1000
						)
						return `- <@${app.userId}> — **${teamName}** — ${statusLabel} <t:${updatedTimestamp}:R>`
				  })
				: ["_No recent outcomes_"]

		// Also count awaiting lead approval
		const awaitingLeadApproval = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.status, "AWAITING_LEAD_APPROVAL"),
					inArray(applications.team, leadTeams)
				)
			)
			.all()

		const container = new Container(
			[
				new TextDisplay(`### Onboarding Dashboard — ${teamNames}`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Active Trials:** ${activeTrials.length}`,
						`**Pending Reviews:** ${pendingReviews.length}`,
						`**Pending Votes:** ${pendingVotes.length}`,
						`**Awaiting Lead Approval:** ${awaitingLeadApproval.length}`,
					].join("\n")
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					`**Recent Outcomes (last 5):**\n${recentLines.join("\n")}`
				),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}
