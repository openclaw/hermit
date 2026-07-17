import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType
} from "@buape/carbon"
import { buildLobsterNoticeContainer } from "../components/lobsterButtons.js"
import { lobsterConfig } from "../config/lobster.js"
import {
	bindLobsterMessage,
	createLobsterEncounter,
	markLobsterPublicationFailed
} from "../data/lobsterEncounters.js"
import type { ActionCooldownKind } from "../data/actionCooldowns.js"
import {
	generateLobsterEncounter,
	type LobsterSubject
} from "../services/lobsterEngine.js"
import { hasLobsterRole } from "../services/lobsterInteractions.js"
import { buildLobsterEncounterPayload } from "../services/lobsterMedia.js"
import BaseCommand from "./base.js"

const cooldownLabels: Record<ActionCooldownKind, string> = {
	actor: "your lobster release permit",
	target: "that target's encounter window",
	channel: "this channel's tide table"
}

abstract class BaseLobsterCommand extends BaseCommand {
	defer = false
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	guildIds = [lobsterConfig.guildId]

	private async replyWithNotice(
		interaction: CommandInteraction,
		body: string,
		accentColor: string = lobsterConfig.noticeColor
	) {
		await interaction.reply({
			components: [buildLobsterNoticeContainer(body, accentColor)],
			ephemeral: true,
			allowedMentions: { parse: [] }
		})
	}

	protected async runWithTarget(
		interaction: CommandInteraction,
		target: LobsterSubject | null
	) {
		if (
			!hasLobsterRole(
				interaction.member?.roles.map((role) => role.id) ?? []
			)
		) {
			await this.replyWithNotice(
				interaction,
				"Community Team, Maintainer, or Maintainer Guest roles only. The lobster gate remains closed.",
				lobsterConfig.errorColor
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
			guildId !== lobsterConfig.guildId
		) {
			await this.replyWithNotice(
				interaction,
				"Could not establish lobster jurisdiction for this request.",
				lobsterConfig.errorColor
			)
			return
		}

		let generated
		try {
			generated = generateLobsterEncounter({
				seed: `initial:${interactionId}`,
				actor: { id: actorId, bot: false },
				target,
				hermitUserId: lobsterConfig.hermitUserId,
				rockLobsterUserId: lobsterConfig.rockLobsterUserId
			})
		} catch (error) {
			console.error("Failed to generate lobster encounter:", error)
			await this.replyWithNotice(
				interaction,
				"The lobster catalog is temporarily unavailable.",
				lobsterConfig.errorColor
			)
			return
		}

		let creation
		try {
			creation = await createLobsterEncounter({
				interactionId,
				guildId,
				channelId,
				actorId,
				targetId: target.id,
				targetIsBot: target.bot,
				taxonomySnapshotId: generated.taxonomySnapshotId,
				speciesAphiaId: generated.speciesAphiaId,
				speciesAcceptedName: generated.speciesAcceptedName,
				speciesDisplayName: generated.speciesDisplayName,
				speciesFamily: generated.speciesFamily,
				sceneId: generated.sceneId,
				assetUrl: generated.assetUrl,
				assetChecksum: generated.assetChecksum,
				headline: generated.headline,
				narrative: generated.narrative,
				metrics: generated.metrics,
				accessibilityDescription: generated.accessibilityDescription
			})
		} catch (error) {
			console.error("Failed to create lobster encounter:", error)
			await this.replyWithNotice(
				interaction,
				"The lobster ledger is temporarily unavailable.",
				lobsterConfig.errorColor
			)
			return
		}

		if (creation.kind === "publication_failed") {
			await this.replyWithNotice(
				interaction,
				"This lobster release previously failed to publish. Please start a new request.",
				lobsterConfig.errorColor
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
				`Please allow ${blocked} to reset. Retry in ${longest} second${longest === 1 ? "" : "s"}.`
			)
			return
		}

		const encounter = creation.encounter
		let message
		try {
			await interaction.defer()
			const payload = await buildLobsterEncounterPayload(encounter)
			message = await interaction.reply({
				...payload,
				allowedMentions: {
					users: [...new Set([encounter.actorId, encounter.targetId])]
				}
			})
		} catch (error) {
			console.error(
				`Failed to publish lobster encounter ${encounter.id}:`,
				error
			)
			await markLobsterPublicationFailed(
				encounter.id,
				error instanceof Error ? error.message : "Unknown publication failure"
			).catch((markError) => {
				console.error(
					`Failed to mark lobster encounter ${encounter.id} publication failure:`,
					markError
				)
			})
			await this.replyWithNotice(
				interaction,
				"The lobster encounter could not be published.",
				lobsterConfig.errorColor
			).catch(() => null)
			return
		}

		try {
			const binding = await bindLobsterMessage(
				encounter.id,
				encounter.guildId,
				encounter.channelId,
				message.id
			)
			if (
				binding.kind !== "bound" &&
				binding.kind !== "already_bound"
			) {
				console.error(
					`Failed to bind lobster encounter ${encounter.id}: ${binding.kind}`
				)
			}
		} catch (error) {
			console.error(
				`Failed to bind published lobster encounter ${encounter.id}:`,
				error
			)
		}
	}
}

export default class LobsterCommand extends BaseLobsterCommand {
	name = "lobster"
	description = "Release a scientifically recognized lobster toward a user"
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user receiving the lobster encounter",
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

export class ReleaseLobsterContextCommand extends BaseLobsterCommand {
	name = "Release Lobster"
	type = ApplicationCommandType.User

	async run(interaction: CommandInteraction) {
		const target = interaction.targetUser
		await this.runWithTarget(
			interaction,
			target ? { id: target.id, bot: target.bot } : null
		)
	}
}
