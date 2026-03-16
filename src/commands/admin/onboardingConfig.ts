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
import { getGlobalConfig, setGlobalConfig } from "../../lib/configStore.js"
import type { OnboardingGlobalConfig } from "../../types/onboarding.js"

class GetOnboardingConfigCommand extends Command {
	name = "get"
	description = "Show the current global onboarding configuration"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = []

	async run(interaction: CommandInteraction) {
		const config = await getGlobalConfig()

		const container = new Container(
			[
				new TextDisplay("### Global Onboarding Configuration"),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`**Min Server Tenure:** ${config.minServerTenureDays} days`,
						`**Reapply Cooldown:** ${config.reapplyCooldownDays} days`,
						`**Community Staff Role:** ${config.communityStaffRoleId ? `<@&${config.communityStaffRoleId}>` : "_not set_"}`,
						`**Public Announcement Channel:** ${config.publicAnnouncementChannelId ? `<#${config.publicAnnouncementChannelId}>` : "_not set_"}`,
						`**Mod Log Channel:** ${config.modLogChannelId ? `<#${config.modLogChannelId}>` : "_not set_"}`,
						`**Docs Repo URL:** ${config.docsRepoUrl || "_not set_"}`,
					].join("\n")
				),
			],
			{ accentColor: "#5865f2" }
		)

		await interaction.reply({ components: [container] })
	}
}

class SetOnboardingConfigCommand extends Command {
	name = "set"
	description = "Update global onboarding configuration values"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			type: ApplicationCommandOptionType.Integer as const,
			name: "min-server-tenure-days",
			description: "Minimum days a user must have been in the server to apply",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.Integer as const,
			name: "reapply-cooldown-days",
			description: "Days a user must wait before reapplying after a rejection",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "community-staff-role-id",
			description: "Role ID for the Community Staff role",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "public-announcement-channel-id",
			description: "Channel ID for public onboarding announcements",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "mod-log-channel-id",
			description: "Channel ID for mod log messages",
			required: false,
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "docs-repo-url",
			description: "URL of the documentation repository",
			required: false,
		},
	]

	async run(interaction: CommandInteraction) {
		const updates: Partial<OnboardingGlobalConfig> = {}
		const changed: string[] = []

		const minServerTenureDays = interaction.options.getInteger(
			"min-server-tenure-days"
		)
		if (minServerTenureDays !== null) {
			updates.minServerTenureDays = minServerTenureDays
			changed.push(`**Min Server Tenure:** ${minServerTenureDays} days`)
		}

		const reapplyCooldownDays = interaction.options.getInteger(
			"reapply-cooldown-days"
		)
		if (reapplyCooldownDays !== null) {
			updates.reapplyCooldownDays = reapplyCooldownDays
			changed.push(`**Reapply Cooldown:** ${reapplyCooldownDays} days`)
		}

		const communityStaffRoleId = interaction.options.getString(
			"community-staff-role-id"
		)
		if (communityStaffRoleId !== null) {
			updates.communityStaffRoleId = communityStaffRoleId
			changed.push(`**Community Staff Role ID:** ${communityStaffRoleId}`)
		}

		const publicAnnouncementChannelId = interaction.options.getString(
			"public-announcement-channel-id"
		)
		if (publicAnnouncementChannelId !== null) {
			updates.publicAnnouncementChannelId = publicAnnouncementChannelId
			changed.push(
				`**Public Announcement Channel ID:** ${publicAnnouncementChannelId}`
			)
		}

		const modLogChannelId = interaction.options.getString("mod-log-channel-id")
		if (modLogChannelId !== null) {
			updates.modLogChannelId = modLogChannelId
			changed.push(`**Mod Log Channel ID:** ${modLogChannelId}`)
		}

		const docsRepoUrl = interaction.options.getString("docs-repo-url")
		if (docsRepoUrl !== null) {
			updates.docsRepoUrl = docsRepoUrl
			changed.push(`**Docs Repo URL:** ${docsRepoUrl}`)
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

		await setGlobalConfig(updates)

		const container = new Container(
			[
				new TextDisplay("### Global Config Updated"),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(changed.join("\n")),
			],
			{ accentColor: "#3fb950" }
		)

		await interaction.reply({ components: [container] })
	}
}

export default class OnboardingConfigCommand extends CommandWithSubcommands {
	name = "onboarding-config"
	description = "View or update global onboarding configuration"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [
		new GetOnboardingConfigCommand(),
		new SetOnboardingConfigCommand(),
	]
}
