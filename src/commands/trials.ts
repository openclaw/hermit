import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	Command,
	CommandWithSubcommands,
	Container,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../db.js"
import { applications, trials } from "../db/schema.js"
import { TEAM_DISPLAY_NAMES, type TeamSlug } from "../types/onboarding.js"
import {
	getFullMemberTeams,
	getLeadTeams,
	type MemberRoles,
} from "../lib/permissions.js"
import { getTeamConfig } from "../lib/configStore.js"

class TrialsListCommand extends Command {
	name = "trials"
	description = "List all active trials for your team(s)"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = []

	async run(interaction: CommandInteraction) {
		const userId = interaction.user?.id
		const member = interaction.member
		if (!userId || !member) {
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

		const memberRoles: MemberRoles = member.roles ?? []
		const [fullTeams, leadTeams] = await Promise.all([
			getFullMemberTeams(memberRoles),
			getLeadTeams(userId),
		])

		const authorizedTeams = Array.from(new Set([...fullTeams, ...leadTeams]))

		if (authorizedTeams.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You are not a full member or lead of any team."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const activeTrials = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.status, "TRIAL_ACTIVE"),
					inArray(applications.team, authorizedTeams)
				)
			)
			.all()

		if (activeTrials.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"No active trials found for your team(s)."
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const teamConfigs = Object.fromEntries(
			await Promise.all(
				authorizedTeams.map(async (team) => [team, await getTeamConfig(team)])
			)
		)

		const lines = await Promise.all(
			activeTrials.map((app) => {
				const teamName = TEAM_DISPLAY_NAMES[app.team as TeamSlug]
				const config = teamConfigs[app.team]
				const startMs = app.createdAt?.getTime() ?? Date.now()
				const endMs = startMs + (config?.trialDurationDays ?? 7) * 24 * 60 * 60 * 1000
				const daysRemaining = Math.max(
					0,
					Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000))
				)
				const startTimestamp = Math.floor(startMs / 1000)
				return `- <@${app.userId}> — **${teamName}** — Started <t:${startTimestamp}:R> — **${daysRemaining}** day${daysRemaining !== 1 ? "s" : ""} remaining`
			})
		)

		const container = new Container(
			[
				new TextDisplay(`### Active Trials (${activeTrials.length})`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(lines.join("\n")),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

class TrialStatusCommand extends Command {
	name = "trial-status"
	description = "View detailed trial progress for a specific member"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The trial member to inspect",
			required: true,
		},
	]

	async run(interaction: CommandInteraction) {
		const callerId = interaction.user?.id
		const member = interaction.member
		if (!callerId || !member) {
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

		const targetUser = interaction.options.getUser("user", true)
		const targetId = targetUser.id

		const application = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.userId, targetId),
					eq(applications.status, "TRIAL_ACTIVE")
				)
			)
			.get()

		if (!application) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`<@${targetId}> does not have an active trial.`
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const appTeam = application.team as TeamSlug
		const memberRoles: MemberRoles = member.roles ?? []
		const [isFullMember, isLead] = await Promise.all([
			(async () => {
				const fullTeams = await getFullMemberTeams(memberRoles)
				return fullTeams.includes(appTeam)
			})(),
			(async () => {
				const leadTeams = await getLeadTeams(callerId)
				return leadTeams.includes(appTeam)
			})(),
		])

		if (!isFullMember && !isLead) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You do not have permission to view this trial's status."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const trial = await db
			.select()
			.from(trials)
			.where(eq(trials.applicationId, application.id))
			.get()

		const teamConfig = await getTeamConfig(appTeam)
		const teamName = TEAM_DISPLAY_NAMES[appTeam]

		const startMs = trial?.startTime?.getTime() ?? application.createdAt?.getTime() ?? Date.now()
		const endMs = startMs + teamConfig.trialDurationDays * 24 * 60 * 60 * 1000
		const daysRemaining = Math.max(
			0,
			Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000))
		)
		const startTimestamp = Math.floor(startMs / 1000)
		const endTimestamp = Math.floor(endMs / 1000)

		const metricsText =
			trial?.metrics && Object.keys(trial.metrics).length > 0
				? Object.entries(trial.metrics)
						.map(([k, v]) => `  • **${k}:** ${v}`)
						.join("\n")
				: "  _No metrics recorded yet_"

		const container = new Container(
			[
				new TextDisplay(`### Trial Status: <@${targetId}>`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Team:** ${teamName}`,
						`**Status:** Active`,
						`**Started:** <t:${startTimestamp}:F>`,
						`**Ends:** <t:${endTimestamp}:F> (${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining)`,
					].join("\n")
				),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(`**Metrics:**\n${metricsText}`),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

export default class TrialsCommand extends CommandWithSubcommands {
	name = "trials"
	description = "Manage and view trial members"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [new TrialsListCommand(), new TrialStatusCommand()]
}
