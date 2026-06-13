import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	CommandWithSubcommands,
	Permission,
	ApplicationCommandOptionType,
	Button,
	ButtonStyle,
	Container,
	Row,
	Separator,
	TextDisplay
} from "@buape/carbon"
import BaseCommand from "./base.js"

const communityStaff = "1477360613125787678"
const openclawFoundation = "1509063061598769333"

class RoleToggle extends BaseCommand {
	name: string
	roleId: string

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to toggle the role on",
			required: true
		}
	]

	constructor(name: string, roleId: string) {
		super()
		this.name = name
		this.roleId = roleId
		this.description = `Toggle the ${this.name} role on someone`
		this.contexts = [InteractionContextType.Guild]
		this.integrationTypes = [ApplicationIntegrationType.GuildInstall]
	}

	async run(interaction: CommandInteraction) {
		if (!interaction.guild || !interaction.member) {
			return
		}

		const member = interaction.member
		const memberRoles = member.roles ?? []
		const hasAccess = memberRoles.some(
			(role) => role.id === communityStaff
		)

		if (!hasAccess) {
			await interaction.reply({
				content: "no.",
				allowedMentions: { parse: [] }
			})
			return
		}

		const target = interaction.options.getUser("user", true)
		const targetMember = await interaction.guild.fetchMember(target.id)

		if (!targetMember) {
			await interaction.reply({
				content: "User not found in the server.",
				allowedMentions: { parse: [] }
			})
			return
		}

		const hasRole = targetMember.roles.some((role) => role.id === this.roleId)
		const verb = hasRole ? "Removed" : "Added"

		if (hasRole) {
			await targetMember.removeRole(this.roleId)
		} else {
			await targetMember.addRole(this.roleId)
		}

		await interaction.reply({
			content: `${verb} <@&${this.roleId}> ${hasRole ? "from" : "to"} ${targetMember.nickname ?? targetMember.user.globalName ?? targetMember.user.username}.`,
			allowedMentions: { parse: [] }
		})
	}
}

class AcknowledgeButton extends Button {
	customId: string
	label: string
	style: ButtonStyle

	constructor(customId: string, label: string, style: ButtonStyle) {
		super()
		this.customId = customId
		this.label = label
		this.style = style
	}

	run() { }
}

class RoleToggleWithAck extends BaseCommand {
	name: string
	roleId: string
	requiredRoleId: string
	ackMessage: string

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to toggle the role on",
			required: true
		}
	]

	constructor(name: string, roleId: string, requiredRoleId: string, ackMessage: string) {
		super()
		this.name = name
		this.roleId = roleId
		this.requiredRoleId = requiredRoleId
		this.ackMessage = ackMessage
		this.description = `Toggle the ${this.name} role on someone`
		this.contexts = [InteractionContextType.Guild]
		this.integrationTypes = [ApplicationIntegrationType.GuildInstall]
	}

	async run(interaction: CommandInteraction) {
		if (!interaction.guild || !interaction.member) {
			return
		}

		const member = interaction.member
		const memberRoles = member.roles ?? []
		const hasAccess = memberRoles.some(
			(role) => role.id === this.requiredRoleId
		)

		if (!hasAccess) {
			await interaction.reply({
				content: "no.",
				allowedMentions: { parse: [] }
			})
			return
		}

		const target = interaction.options.getUser("user", true)
		const targetMember = await interaction.guild.fetchMember(target.id)

		if (!targetMember) {
			await interaction.reply({
				content: "User not found in the server.",
				allowedMentions: { parse: [] }
			})
			return
		}

		const hasRole = targetMember.roles.some((role) => role.id === this.roleId)

		if (hasRole) {
			await targetMember.removeRole(this.roleId)
			await interaction.reply({
				content: `Removed <@&${this.roleId}> from ${targetMember.nickname ?? targetMember.user.globalName ?? targetMember.user.username}.`,
				allowedMentions: { parse: [] }
			})
			return
		}

		const result = await interaction.replyAndWaitForComponent({
			components: [
				new Container(
					[
						new TextDisplay("### Privileged channel access"),
						new TextDisplay(this.ackMessage),
						new Separator({ divider: true, spacing: "small" }),
						new Row([
							new AcknowledgeButton("role-ack-yes", "I understand", ButtonStyle.Success),
							new AcknowledgeButton("role-ack-no", "Cancel", ButtonStyle.Danger)
						])
					],
					{ accentColor: "#f1c40f" }
				)
			],
			ephemeral: true,
			allowedMentions: { parse: [] }
		}, 5 * 60 * 1000)

		if (!result.success) {
			await result.message.edit({
				components: [
					new Container([new TextDisplay("Confirmation timed out. No roles were changed.")], { accentColor: "#f85149" })
				]
			}).catch(() => null)
			return
		}

		if (result.customId !== "role-ack-yes") {
			await result.message.edit({
				components: [
					new Container([new TextDisplay("Cancelled. No roles were changed.")], { accentColor: "#f85149" })
				]
			}).catch(() => null)
			return
		}

		await targetMember.addRole(this.roleId)
		await result.message.edit({
			components: [
				new Container(
					[new TextDisplay(`Added <@&${this.roleId}> to <@${target.id}>.`)],
					{ accentColor: "#3fb950" }
				)
			],
			allowedMentions: { parse: [] }
		}).catch(() => null)
	}
}

export default class RoleCommand extends CommandWithSubcommands {
	name = "role"
	description = "Toggle server roles"
	permission = Permission.ManageRoles
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	subcommands = [
		new RoleToggle("showcase-ban", "123456789012345678"), 
		new RoleToggle("clawtributor", "1458375944111915051"),
		new RoleToggleWithAck(
			"maintainer-guest",
			"1503268035908075590",
			openclawFoundation,
			"You are adding someone to **Maintainer Guest**, which grants access to privileged Fake Slack Connect channels.\n\nMake sure the person you're adding is aware that they'll be gaining access to private channels, and that they understand the responsibility that comes with that access."
		)
	]
}
