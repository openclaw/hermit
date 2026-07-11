import {
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType,
	Permission
} from "@buape/carbon"
import { buildBetaPingsContainer } from "../components/betaPingsButton.js"
import { betaPingsConfig } from "../config/betaPings.js"
import BaseCommand from "./base.js"

export default class BetaPingsCommand extends BaseCommand {
	name = "beta-pings"
	description = "Post the Beta Pings role toggle"
	permission = Permission.ManageRoles
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	guildIds = [betaPingsConfig.guildId]

	async run(interaction: CommandInteraction) {
		await interaction.reply({
			components: [buildBetaPingsContainer()],
			allowedMentions: { parse: [] }
		})
	}
}
