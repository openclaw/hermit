import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	type APIMessage,
	type CommandInteraction,
	InteractionContextType,
	Routes,
	serializePayload
} from "@buape/carbon"
import {
	buildNominationContainer,
	buildNominationNoticeContainer
} from "../components/nominationButtons.js"
import { nominationConfig } from "../config/nominations.js"
import {
	createNomination,
	deleteNomination,
	getActiveNominationForNominee,
	markExpiredSubmittedNominationForNominee,
	markNominationSubmissionFailed,
	setNominationMessageId
} from "../data/nominations.js"
import { editNominationMessageExpired } from "../services/nominationExpiry.js"
import BaseCommand from "./base.js"

const getNominationExpiresAt = () =>
	new Date(
		Date.now() + nominationConfig.expirationHours * 60 * 60 * 1000
	).toISOString()

export default class NominateCommand extends BaseCommand {
	name = nominationConfig.commandName
	description = "Nominate a user for Shell Society"
	defer = false
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
			required: true,
			max_length: nominationConfig.maxReasonLength
		}
	]

	private async replyWithNotice(
		interaction: CommandInteraction,
		body: string,
		accentColor = "#f1c40f"
	) {
		await interaction.reply({
			components: [buildNominationNoticeContainer(body, accentColor)],
			ephemeral: true,
			allowedMentions: { parse: [] }
		})
	}

	async run(interaction: CommandInteraction) {
		const channelId = interaction.rawData.channel_id ?? interaction.channel?.id
		if (channelId !== nominationConfig.nominationChannelId) {
			await this.replyWithNotice(interaction, nominationConfig.copy.wrongChannel)
			return
		}

		if (!interaction.guild || !interaction.user?.id) {
			return
		}

		const target = interaction.options.getUser("user", true)
		let reasonOption: string | undefined
		try {
			reasonOption = interaction.options.getString("reason")
		} catch {
			await this.replyWithNotice(interaction, nominationConfig.copy.reasonTooLong)
			return
		}
		const reason = reasonOption?.trim() ?? ""
		if (reason.length === 0) {
			await this.replyWithNotice(interaction, nominationConfig.copy.reasonRequired)
			return
		}

		if (reason.length > nominationConfig.maxReasonLength) {
			await this.replyWithNotice(interaction, nominationConfig.copy.reasonTooLong)
			return
		}

		if (target.id === interaction.user.id) {
			await this.replyWithNotice(interaction, nominationConfig.copy.selfNomination)
			return
		}

		if (target.bot) {
			await this.replyWithNotice(interaction, nominationConfig.copy.botNomination)
			return
		}

		await interaction.defer({ ephemeral: true })

		const expiredNomination = await markExpiredSubmittedNominationForNominee(
			nominationConfig.guildId,
			target.id,
			nominationConfig.targetRoleId
		)
		if (expiredNomination) {
			await editNominationMessageExpired(
				interaction.client,
				expiredNomination
			).catch(() => null)
		}

		const targetMember = await interaction.guild.fetchMember(target.id).catch(() => null)
		if (!targetMember) {
			await this.replyWithNotice(
				interaction,
				nominationConfig.copy.userNotFound,
				"#f85149"
			)
			return
		}

		if (targetMember.roles.some((role) => role.id === nominationConfig.targetRoleId)) {
			await this.replyWithNotice(interaction, nominationConfig.copy.alreadyHasRole)
			return
		}

		const existingNomination = await getActiveNominationForNominee(
			nominationConfig.guildId,
			target.id,
			nominationConfig.targetRoleId
		)
		if (existingNomination) {
			await this.replyWithNotice(interaction, nominationConfig.copy.alreadyPending)
			return
		}

		const nomination = await createNomination({
			guildId: nominationConfig.guildId,
			channelId: nominationConfig.reviewChannelId,
			nomineeId: target.id,
			nominatorId: interaction.user.id,
			reason,
			expiresAt: getNominationExpiresAt(),
			targetRoleId: nominationConfig.targetRoleId,
			requiredApprovals: nominationConfig.requiredApprovals
		})
		if (!nomination) {
			await this.replyWithNotice(interaction, nominationConfig.copy.alreadyPending)
			return
		}

		let postedMessage: APIMessage | null = null
		try {
			postedMessage = await interaction.client.rest.post(
				Routes.channelMessages(nominationConfig.reviewChannelId),
				{
					body: serializePayload({
						components: [
							buildNominationContainer(nomination, {
								approvals: 0,
								declines: 0
							})
						],
						allowedMentions: { parse: [] }
					})
				}
			) as APIMessage
			await setNominationMessageId(nomination.id, postedMessage.id)
		} catch {
			if (postedMessage) {
				await interaction.client.rest.delete(
					Routes.channelMessage(
						nominationConfig.reviewChannelId,
						postedMessage.id
					)
				).catch(() => null)
			}
			await deleteNomination(nomination.id).catch(async () => {
				await markNominationSubmissionFailed(nomination.id).catch(() => null)
			})
			await this.replyWithNotice(
				interaction,
				nominationConfig.copy.nominationPostFailed,
				"#f85149"
			).catch(() => null)
			return
		}

		await this.replyWithNotice(
			interaction,
			nominationConfig.copy.nominationPosted,
			"#3fb950"
		)
	}
}
