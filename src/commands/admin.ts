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
	ChannelType,
	Command
} from "@buape/carbon"
import BaseCommand from "./base.js"

const shadow = "439223656200273932"
const trialModRoleId = "1474489940279820339"
const trialModChannel = "1474490215807713301"
const teamLeadsRoleId = "1469028608293998723"

const teamLead = (team: string) => {
	switch (team) {
		case "discord":
			return "439223656200273932"
		case "voice-chat":
			return "405240788143046656"
		case "helper":
			return "1255431768199135254"
		case "configurator":
			return "957289026195435520"
		default:
			return null
	}
}

const isShadow = (interaction: CommandInteraction) => {
	return interaction.user?.id === shadow
}

export default class AdminCommand extends CommandWithSubcommandGroups {
	name = "admin"
	description = "Admin commands"
	permission = PermissionFlagsBits.Administrator
	subcommandGroups = [
		new TrialMod(),
	]
	subcommands = [
		new Say(),
		new AutomodBypassToggle()
	]
}

export class Say extends BaseCommand {
	name = "say"
	description = "Make the bot say something"

	options = [
		{
			type: ApplicationCommandOptionType.String as const,
			name: "message",
			description: "The message to say",
			required: true
		},
		{
			type: ApplicationCommandOptionType.Channel as const,
			name: "channel",
			description: "The channel to say the message in (optional)",
			required: false,
		}
	]

	async run(interaction: CommandInteraction) {
		const message = interaction.options.getString("message", true)
		const channel = await interaction.options.getChannel("channel") || interaction.channel
		if (!channel || !("send" in channel)) {
			await interaction.reply({
				content: "Invalid channel provided.",
				ephemeral: true
			})
			return
		}
		await channel.send(message)
		await interaction.reply({
			content: `Sent message in ${channel.toString()}`,
			ephemeral: true
		})
	}
}

export class TrialMod extends CommandWithSubcommands {
	name = "trial-mod"
	description = "Manage trial mods"
	subcommands = [
		new TrialModAdd()
	]
}

export class TrialModAdd extends BaseCommand {
	name = "add"
	description = "Add a trial mod"

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to toggle trial mod for",
			required: true
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "team",
			description: "The team the trial mod is applying for (optional)",
			required: false,
			choices: [
				{
					name: "Discord Moderator",
					value: "discord"
				},
				{
					name: "Voice Chat",
					value: "voice-chat"
				},
				{
					name: "Helper",
					value: "helper"
				},
				{
					name: "Configurator",
					value: "configurator"
				}
			]
		}
	]

	async run(interaction: CommandInteraction) {
		if (!interaction.guild) {
			await interaction.reply({
				content: "This command can only be used in a server.",
				ephemeral: true
			})
			return
		}
		if (!isShadow(interaction)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				ephemeral: true
			})
			return
		}

		const user = interaction.options.getMember("user", true)

		if (!user) {
			await interaction.reply({
				content: "User not found in this server.",
				ephemeral: true
			})
			return
		}

		// add role to user
		// create private thread in channel
		// send welcome message
		// ping team leads role

		user.addRole(trialModRoleId, "Added trial mod role").catch(() => { })

		const trialModChannelObj = await interaction.client.fetchChannel(trialModChannel)
		if (!(trialModChannelObj?.type === ChannelType.GuildText)) {
			await interaction.reply({
				content: "Trial mod channel not found.",
				ephemeral: true
			})
			return
		}
		const thread = await trialModChannelObj.startThread({
			name: `${user.user.username}`,
		})
		const team = interaction.options.getString("team")
		await thread.send(`Welcome <@${user.user.id}>! Thanks for applying to join our Community Staff team!
You've been added here in this channel for our <@&${teamLeadsRoleId}>s to work with you in getting your onboarded to our team, as well as have final discussions to make sure you're a good fit for the team.

While we do so, please make sure that you've read over our Community Policies, these are linked in <#1461234034872025202> for you to access, and if you have any questions, please send those here!${team && teamLead(team) ? ` Your main point of contact for your application will be <@${teamLead(team)}> as the lead for your requested team, so feel free to ping them here if you have any specific questions or concerns for that team!` : ""

			}`)

		await interaction.reply({
			content: `Successfully added trial mod role to <@${user.user.id}> and created thread for them in <#${trialModChannel}>.`,
			ephemeral: true
		})
	}


}


export class AutomodBypassToggle extends BaseCommand {
	name = "automod-bypass-toggle"
	description = "Toggle automod bypass for a user"

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to toggle automod bypass for",
			required: true
		},
	]

	async run(interaction: CommandInteraction) {
		if (!interaction.guild) {
			await interaction.reply({
				content: "This command can only be used in a server.",
				ephemeral: true
			})
			return
		}
		if (!isShadow(interaction)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				ephemeral: true
			})
			return
		}

		const user = interaction.options.getMember("user", true)
		if (!user) {
			await interaction.reply({
				content: "User not found in this server.",
				ephemeral: true
			})
			return
		}

		if (user.roles.find(x => x.id === "1469051644024193126")) {
			user.removeRole("1469051644024193126", "Removed automod bypass role").catch(() => { })
			await interaction.reply({
				content: `Removed automod bypass role from <@${user.user.id}>.`,
				ephemeral: true
			})
		} else {
			user.addRole("1469051644024193126", "Added automod bypass role").catch(() => { })
			await interaction.reply({
				content: `Added automod bypass role to <@${user.user.id}>.`,
				ephemeral: true
			})
		}
	}
}
