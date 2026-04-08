import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	CommandWithSubcommands,
	Permission,
	ApplicationCommandOptionType,
	CommandWithSubcommandGroups,
	ArrayOrSingle,
	PermissionFlagsBits,
	ChannelType
} from "@buape/carbon"
import BaseCommand from "./base.js"

const teamLeadsRoleId = "1469028608293998723"
const shadow = "439223656200273932"

export default class TeamLeadCommand extends CommandWithSubcommandGroups {
	name = "team-lead"
	description = "Team lead commands"
	subcommandGroups = [
		new TrialMod()
	]
}

export class TrialMod extends CommandWithSubcommands {
	name = "trial-mod"
	description = "Manage trial mods"
	subcommands = [
		new TrialModApprove()
	]
}

export class TrialModApprove extends BaseCommand {
	name = "approve"
	description = "Approve a trial mod"

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to approve trial mod for",
			required: true
		},
	]

	async run(interaction: CommandInteraction) {
		const teamLeadChannel = await interaction.guild?.fetchChannel("1477357550025576540")
		if (teamLeadChannel?.type !== ChannelType.GuildText) {
			await interaction.reply({
				content: "Team lead channel not found.",
				ephemeral: true
			})
			return
		}
		const user = interaction.options.getUser("user", true)
		teamLeadChannel.send(`<@${shadow}>, <@${user.id}> has been requested to be approved by <@${interaction.user?.id}> as a trial mod, please review their application and approve or deny them as soon as possible!`)
		await interaction.reply({
			content: `Requested approval for <@${user.id}> as a trial mod.`,
			ephemeral: true
		})
	}
}

export class TrialModDecline extends BaseCommand {
	name = "decline"
	description = "Decline a trial mod"

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to decline trial mod for",
			required: true
		},
	]

	async run(interaction: CommandInteraction) {
		const teamLeadChannel = await interaction.guild?.fetchChannel("1477357550025576540")
		if (teamLeadChannel?.type !== ChannelType.GuildText) {
			await interaction.reply({
				content: "Team lead channel not found.",
				ephemeral: true
			})
			return
		}
		const user = interaction.options.getUser("user", true)
		teamLeadChannel.send(`<@${shadow}>, <@${user.id}> has been requested to be declined by <@${interaction.user?.id}> as a trial mod, please review their application and approve or deny them as soon as possible!`)
		await interaction.reply({
			content: `Requested decline for <@${user.id}> as a trial mod.`,
			ephemeral: true
		})
	}
}
