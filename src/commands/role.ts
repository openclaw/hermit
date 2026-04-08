import {
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	CommandWithSubcommands,
	Permission,
	ApplicationCommandOptionType
} from "@buape/carbon"
import BaseCommand from "./base.js"

const communityStaff = "1477360613125787678"

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

export default class RoleCommand extends CommandWithSubcommands {
	name = "role"
	description = "Toggle server roles"
	permission = Permission.ManageRoles
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	subcommands = [
		new RoleToggle("showcase-ban", "123456789012345678"), 
		new RoleToggle("clawtributor", "1458375944111915051")
	]
}
