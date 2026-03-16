import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	Command,
	CommandWithSubcommands,
	Container,
	Row,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { TEAM_DISPLAY_NAMES, type TeamSlug } from "../types/onboarding.js"
import { getLeadTeams } from "../lib/permissions.js"
import VoteApproveButton from "../components/voteApproveButton.js"
import VoteDenyButton from "../components/voteDenyButton.js"

class ApplicationsListCommand extends Command {
	name = "applications"
	description = "List pending applications awaiting your review"
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

		const pendingApps = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.status, "APPLICATION_PENDING_REVIEW"),
					inArray(applications.team, leadTeams)
				)
			)
			.all()

		if (pendingApps.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"No applications are pending review for your team(s)."
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const lines = pendingApps.map((app) => {
			const teamName = TEAM_DISPLAY_NAMES[app.team as TeamSlug]
			const appliedTimestamp = Math.floor(
				(app.createdAt?.getTime() ?? Date.now()) / 1000
			)
			return `- **ID:** \`${app.id}\` — <@${app.userId}> — **${teamName}** — Applied <t:${appliedTimestamp}:R>`
		})

		const container = new Container(
			[
				new TextDisplay(
					`### Pending Applications (${pendingApps.length})`
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(lines.join("\n")),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					"Use `/review application-id:<id>` to view full details and take action."
				),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

class ReviewApplicationCommand extends Command {
	name = "review"
	description = "Review a specific application and approve or deny it"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			type: ApplicationCommandOptionType.String as const,
			name: "application-id",
			description: "The application ID to review",
			required: true,
		},
	]

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

		const applicationId = interaction.options.getString("application-id", true)

		const application = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId))
			.get()

		if (!application) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`No application found with ID \`${applicationId}\`.`
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const appTeam = application.team as TeamSlug
		const leadTeams = await getLeadTeams(userId)

		if (!leadTeams.includes(appTeam)) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You are not the team lead for this application's team."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		if (application.status !== "APPLICATION_PENDING_REVIEW") {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`This application is not pending review. Current status: **${application.status}**.`
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const teamName = TEAM_DISPLAY_NAMES[appTeam]
		const appliedTimestamp = Math.floor(
			(application.createdAt?.getTime() ?? Date.now()) / 1000
		)

		const approveButton = new VoteApproveButton(applicationId)
		approveButton.label = "Approve Application"
		const denyButton = new VoteDenyButton(applicationId)
		denyButton.label = "Deny Application"

		const container = new Container(
			[
				new TextDisplay(`### Application Review`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Applicant:** <@${application.userId}>`,
						`**Team:** ${teamName}`,
						`**Applied:** <t:${appliedTimestamp}:F>`,
						`**Application ID:** \`${application.id}\``,
					].join("\n")
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Timezone:** ${application.timezone || "_not provided_"}`,
						`**Availability:** ${application.availability || "_not provided_"}`,
						`**Motivation:**\n${application.motivation || "_not provided_"}`,
					].join("\n")
				),
				new Separator({ divider: true, spacing: "small" }),
				new Row([approveButton, denyButton]),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

export default class ApplicationsCommand extends CommandWithSubcommands {
	name = "applications"
	description = "Manage and review staff applications"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [
		new ApplicationsListCommand(),
		new ReviewApplicationCommand(),
	]
}
