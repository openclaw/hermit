import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType
} from "@buape/carbon"
import {
	buildSlapIncidentContainer,
	buildSlapNoticeContainer
} from "../components/slapButtons.js"
import { slapConfig } from "../config/slap.js"
import {
	bindSlapMessage,
	createSlapEvent,
	type SlapCooldownKind
} from "../data/slapEvents.js"
import {
	generateSlapResult,
	type SlapSubject
} from "../services/slapEngine.js"
import { hasCommunityTeamRole } from "../services/slapInteractions.js"
import BaseCommand from "./base.js"

type SlapTarget = SlapSubject

const cooldownLabels: Record<SlapCooldownKind, string> = {
	actor: "your fish requisition",
	target: "that target's towel-observation period",
	channel: "this channel's splash zone"
}

abstract class BaseSlapCommand extends BaseCommand {
	defer = false
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	guildIds = [slapConfig.guildId]

	private async replyWithNotice(
		interaction: CommandInteraction,
		body: string,
		accentColor = "#f1c40f"
	) {
		await interaction.reply({
			components: [buildSlapNoticeContainer(body, accentColor)],
			ephemeral: true,
			allowedMentions: { parse: [] }
		})
	}

	protected async runWithTarget(
		interaction: CommandInteraction,
		target: SlapTarget | null
	) {
		if (!hasCommunityTeamRole(
			interaction.member?.roles.map((role) => role.id) ?? []
		)) {
			await this.replyWithNotice(
				interaction,
				"Community Team only. The fish cage remains locked.",
				"#f85149"
			)
			return
		}

		const actorId = interaction.user?.id ?? interaction.userId
		const guildId = interaction.rawData.guild_id
		const channelId =
			interaction.rawData.channel_id ?? interaction.channel?.id
		const interactionId = interaction.rawData.id
		if (
			!actorId ||
			!target ||
			!guildId ||
			!channelId ||
			!interactionId ||
			guildId !== slapConfig.guildId
		) {
			await this.replyWithNotice(
				interaction,
				"Could not establish fishery jurisdiction for this request.",
				"#f85149"
			)
			return
		}

		const result = generateSlapResult({
			seed: `initial:${interactionId}`,
			actor: { id: actorId, bot: false },
			target
		})

		let creation
		try {
			creation = await createSlapEvent({
				interactionId,
				guildId,
				channelId,
				actorId,
				targetId: target.id,
				targetIsBot: target.bot,
				result
			})
		} catch (error) {
			console.error("Failed to create slap event:", error)
			await this.replyWithNotice(
				interaction,
				"The fishery ledger is temporarily unavailable.",
				"#f85149"
			)
			return
		}

		if (creation.kind === "cooldown") {
			const longest = Math.max(
				...creation.cooldowns.map((cooldown) => cooldown.remainingSeconds)
			)
			const blocked = creation.cooldowns
				.map((cooldown) => cooldownLabels[cooldown.kind])
				.join(", ")
			await this.replyWithNotice(
				interaction,
				`Please allow ${blocked} to settle. Retry in ${longest} second${longest === 1 ? "" : "s"}.`
			)
			return
		}

		await interaction.defer()
		const event = creation.event
		const message = await interaction.reply({
			components: [buildSlapIncidentContainer(event)],
			allowedMentions: {
				users: [...new Set([event.actorId, event.targetId])]
			}
		})
		await bindSlapMessage(event.id, message.id).catch((error) => {
			console.error(`Failed to bind slap event ${event.id} to its message:`, error)
		})
	}
}

export default class SlapCommand extends BaseSlapCommand {
	name = "slap"
	description = "File a corrective fish contact against a user"
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user receiving the fish",
			required: true
		}
	]

	async run(interaction: CommandInteraction) {
		const target = interaction.options.getUser("user", true)
		await this.runWithTarget(interaction, {
			id: target.id,
			bot: target.bot
		})
	}
}

export class FishSlapContextCommand extends BaseSlapCommand {
	name = "Fish Slap"
	type = ApplicationCommandType.User

	async run(interaction: CommandInteraction) {
		const target = interaction.targetUser
		await this.runWithTarget(
			interaction,
			target
				? {
					id: target.id,
					bot: target.bot
				}
				: null
		)
	}
}
