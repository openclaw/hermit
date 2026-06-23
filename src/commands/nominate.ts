import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType
} from "@buape/carbon"
import { buildNominationContainer } from "../components/nominationButtons.js"
import { nominationConfig } from "../config/nominations.js"
import {
	createNomination,
	getActiveNominationForNominee,
	getNominationApproverIds
} from "../data/nominations.js"
import BaseCommand from "./base.js"

export default class NominateCommand extends BaseCommand {
	name = nominationConfig.commandName
	description = "Nominate a user for Shell Society"
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to nominate",
			required: true
		},
		{
			type: ApplicationCommandOptionType.String as const,
			name: "reason",
			description: "Why this user should join Shell Society",
			required: true
		}
	]

	async run(interaction: CommandInteraction) {
		const channelId = interaction.rawData.channel_id ?? interaction.channel?.id
		if (!channelId || !nominationConfig.nominationChannelIds.includes(channelId)) {
			await interaction.reply({
				content: nominationConfig.copy.wrongChannel,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (!interaction.guild || !interaction.user?.id) {
			return
		}

		const target = interaction.options.getUser("user", true)
		const reason = interaction.options.getString("reason", true).trim()
		if (reason.length === 0) {
			await interaction.reply({
				content: nominationConfig.copy.reasonRequired,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (target.id === interaction.user.id) {
			await interaction.reply({
				content: nominationConfig.copy.selfNomination,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (target.bot) {
			await interaction.reply({
				content: nominationConfig.copy.botNomination,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const targetMember = await interaction.guild.fetchMember(target.id).catch(() => null)
		if (!targetMember) {
			await interaction.reply({
				content: "User not found in the server.",
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (targetMember.roles.some((role) => role.id === nominationConfig.targetRoleId)) {
			await interaction.reply({
				content: nominationConfig.copy.alreadyHasRole,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const existingNomination = await getActiveNominationForNominee(
			nominationConfig.guildId,
			target.id,
			nominationConfig.targetRoleId
		)
		if (existingNomination) {
			await interaction.reply({
				content: nominationConfig.copy.alreadyPending,
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const nomination = await createNomination({
			guildId: nominationConfig.guildId,
			channelId,
			nomineeId: target.id,
			nominatorId: interaction.user.id,
			reason,
			targetRoleId: nominationConfig.targetRoleId,
			requiredApprovals: nominationConfig.requiredApprovals
		})
		const approverIds = await getNominationApproverIds(nomination.id)

		await interaction.reply({
			components: [buildNominationContainer(nomination, approverIds)],
			allowedMentions: { parse: [] }
		})
	}
}
