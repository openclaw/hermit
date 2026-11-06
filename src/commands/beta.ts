import {
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType
} from "@buape/carbon"
import { handleBetaPingsToggle } from "../components/betaPingsButton.js"
import { betaPingsConfig } from "../config/betaPings.js"
import BaseCommand from "./base.js"

export default class BetaCommand extends BaseCommand {
	name = "beta"
	description = "Toggle your Beta Pings role on or off"
	ephemeral = true
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	guildIds = [betaPingsConfig.guildId]

	async run(interaction: CommandInteraction) {
		await handleBetaPingsToggle(interaction)
	}
}
