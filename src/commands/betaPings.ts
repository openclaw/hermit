import {
	ApplicationIntegrationType,
	type CommandInteraction,
	Container,
	InteractionContextType,
	Permission,
	TextDisplay
} from "@buape/carbon"
import { buildBetaPingsContainer } from "../components/betaPingsButton.js"
import { betaPingsConfig } from "../config/betaPings.js"
import { isBetaPingsLocation } from "../services/betaPings.js"
import BaseCommand from "./base.js"

const isPublishLocation = (interaction: CommandInteraction) =>
	isBetaPingsLocation(
		interaction.rawData.guild_id,
		interaction.rawData.channel_id
	)

export default class BetaPingsCommand extends BaseCommand {
	name = "beta-pings"
	description = "Post the Beta Pings role toggle"
	permission = Permission.ManageRoles
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	guildIds = [betaPingsConfig.guildId]
	ephemeral = (interaction: CommandInteraction) =>
		!isPublishLocation(interaction)

	async run(interaction: CommandInteraction) {
		if (!isPublishLocation(interaction)) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay(betaPingsConfig.copy.publishWrongLocation)
					], { accentColor: "#f85149" })
				],
				allowedMentions: { parse: [] }
			})
			return
		}

		await interaction.reply({
			components: [buildBetaPingsContainer()],
			allowedMentions: { parse: [] }
		})
	}
}
