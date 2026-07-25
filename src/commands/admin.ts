import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	ApplicationCommandOptionType,
	CommandWithSubcommands,
	PermissionFlagsBits,
	ChannelType
} from "@buape/carbon"
import BaseCommand from "./base.js"

const shadow = "439223656200273932"
const inactivityWarnChannel = "1477357508833185954"

const isShadow = (interaction: CommandInteraction) => {
	return interaction.user?.id === shadow
}

export default class AdminCommand extends CommandWithSubcommands {
	name = "admin"
	description = "Admin commands"
	permission = PermissionFlagsBits.Administrator
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [
		new Say(),
		new InactivityWarn(),
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

export class InactivityWarn extends BaseCommand {
	name = "inactivity-warn"
	description = "Send a one-time inactivity warning in a private thread"
	ephemeral = true

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to warn",
			required: true
		},
		{
			type: ApplicationCommandOptionType.Mentionable as const,
			name: "lead",
			description: "Optional lead to ping in the message",
			required: false
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

		const user = interaction.options.getUser("user", true)
		const lead = interaction.options.getMentionable("lead")
		const leadLine = lead ? `ping your lead: ${lead}.` : "ping your lead."

		const inactivityWarnChannelObj = await interaction.client.fetchChannel(inactivityWarnChannel)
		if (!(inactivityWarnChannelObj?.type === ChannelType.GuildText)) {
			await interaction.reply({
				content: "Inactivity warn channel not found.",
				ephemeral: true
			})
			return
		}

		const thread = await inactivityWarnChannelObj.startThread({
			name: `${user.username}`,
			type: ChannelType.PrivateThread
		})
		await thread.addMember(shadow).catch(() => { })

		const deadline = Math.floor((Date.now() + 2 * 24 * 60 * 60 * 1000) / 1000)
		await thread.send(`Hey <@${user.id}> — this is your one activity warning.

You’ve been inactive lately, and we need a clear response to keep your staff role active.

As a reminder, per [Activity Expectations](<https://github.com/openclaw/community/blob/main/moderation.md#activity-expectations>) and [Inactivity / Leave of Absence (LOA)](<https://github.com/openclaw/community/blob/main/moderation.md#inactivity--leave-of-absence-loa>), staff are expected to stay reasonably active and post LOA/inactivity notices in their team channel when away.

Please reply in this channel by <t:${deadline}:F> (<t:${deadline}:R>) and confirm:
- whether you can stay active right now
- what your availability looks like this week
- if anything is blocking you

If you need time away, post an LOA in your team channel (dates) and ${leadLine}

If there’s no response by that deadline, we’ll move forward with role removal.`)

		await interaction.reply({
			content: `Created inactivity warning thread for <@${user.id}> in <#${inactivityWarnChannel}>.`,
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
