import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	Command,
	CommandWithSubcommands,
	Container,
	type CommandInteraction,
	InteractionContextType,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { getTeamConfig, setTeamConfig } from "../../lib/configStore.js"
import type { OnboardingTeamConfig, TeamSlug } from "../../types/onboarding.js"
import { TEAM_DISPLAY_NAMES } from "../../types/onboarding.js"

const TEAM_OPTION = {
	type: ApplicationCommandOptionType.String as const,
	name: "team",
	description: "The team to configure",
	required: true,
	choices: [
		{ name: "Discord Mod", value: "discord_mod" },
		{ name: "VC Mod", value: "vc_mod" },
		{ name: "Helper", value: "helper" },
		{ name: "Configurator", value: "configurator" },
	],
}

class GetTeamConfigCommand extends Command {
	name = "get"
	description = "Show the current configuration for a team"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [TEAM_OPTION]

	async run(interaction: CommandInteraction) {
		const teamSlug = interaction.options.getString("team", true) as TeamSlug
		const config = await getTeamConfig(teamSlug)
		const displayName = TEAM_DISPLAY_NAMES[teamSlug]

		const container = new Container(
			[
				new TextDisplay(`### ${displayName} Team Configuration`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Channel:** ${config.channelId ? `<#${config.channelId}>` : "_not set_"}`,
						`**Lead User:** ${config.leadUserId ? `<@${config.leadUserId}>` : "_not set_"}`,
						`**Trial Role:** ${config.trialRoleId ? `<@&${config.trialRoleId}>` : "_not set_"}`,
						`**Full Role:** ${config.fullRoleId ? `<@&${config.fullRoleId}>` : "_not set_"}`,
						`**Trial Duration:** ${config.trialDurationDays} days`,
						`**Vote Window:** ${config.voteWindowHours} hours`,
						`**Lead Approval Timeout:** ${config.leadApprovalTimeoutDays} days`,
					].join("\n")
				),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

class SetTeamConfigCommand extends Command {
	name = "set"
	description = "Update configuration values for a team"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		TEAM_OPTION,
		{
			type: ApplicationCommandOptionType.String as const,
			name: "channel-id",
			description: "Channel ID for this team's onboarding channel",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "lead-user-id",
			description: "User ID of the team lead",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "trial-role-id",
			description: "Role ID for the trial role",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "full-role-id",
			description: "Role ID for the full member role",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.Integer as const,
			name: "trial-duration-days",
			description: "Number of days the trial period lasts",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.Integer as const,
			name: "vote-window-hours",
			description: "Number of hours the team vote window stays open",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.Integer as const,
			name: "lead-approval-timeout-days",
			description: "Days before the lead approval auto-times-out",
			required: false,
		},
	]

	async run(interaction: CommandInteraction) {
		const teamSlug = interaction.options.getString("team", true) as TeamSlug
		const displayName = TEAM_DISPLAY_NAMES[teamSlug]

		const updates: Partial<OnboardingTeamConfig> = {}
		const changed: string[] = []

		const channelId = interaction.options.getString("channel-id")
		if (channelId !== null) {
			updates.channelId = channelId
			changed.push(`**Channel ID:** ${channelId}`)
		}

		const leadUserId = interaction.options.getString("lead-user-id")
		if (leadUserId !== null) {
			updates.leadUserId = leadUserId
			changed.push(`**Lead User ID:** ${leadUserId}`)
		}

		const trialRoleId = interaction.options.getString("trial-role-id")
		if (trialRoleId !== null) {
			updates.trialRoleId = trialRoleId
			changed.push(`**Trial Role ID:** ${trialRoleId}`)
		}

		const fullRoleId = interaction.options.getString("full-role-id")
		if (fullRoleId !== null) {
			updates.fullRoleId = fullRoleId
			changed.push(`**Full Role ID:** ${fullRoleId}`)
		}

		const trialDurationDays = interaction.options.getInteger(
			"trial-duration-days"
		)
		if (trialDurationDays !== null) {
			updates.trialDurationDays = trialDurationDays
			changed.push(`**Trial Duration:** ${trialDurationDays} days`)
		}

		const voteWindowHours = interaction.options.getInteger("vote-window-hours")
		if (voteWindowHours !== null) {
			updates.voteWindowHours = voteWindowHours
			changed.push(`**Vote Window:** ${voteWindowHours} hours`)
		}

		const leadApprovalTimeoutDays = interaction.options.getInteger(
			"lead-approval-timeout-days"
		)
		if (leadApprovalTimeoutDays !== null) {
			updates.leadApprovalTimeoutDays = leadApprovalTimeoutDays
			changed.push(
				`**Lead Approval Timeout:** ${leadApprovalTimeoutDays} days`
			)
		}

		if (changed.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"No options were provided. Nothing was changed."
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		await setTeamConfig(teamSlug, updates)

		const container = new Container(
			[
				new TextDisplay(`### ${displayName} Team Config Updated`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(changed.join("\n")),
			],
			{ accentColor: "#3fb950" }
		)

		await interaction.reply({ components: [container] })
	}
}

export default class TeamConfigCommand extends CommandWithSubcommands {
	name = "team-config"
	description = "View or update per-team onboarding configuration"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [new GetTeamConfigCommand(), new SetTeamConfigCommand()]
}
