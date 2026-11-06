import {
	ApplicationIntegrationType,
	type CommandInteraction,
	InteractionContextType,
	Permission,
	TextDisplay
} from "@buape/carbon"
import { buildBetaPingsContainer } from "../components/betaPingsButton.js"
import { betaPingsConfig } from "../config/betaPings.js"
import { getRuntimeEnv } from "../runtime/env.js"
import { BetaRegistrationError, ensureBetaCommand } from "../utils/ensureBetaCommand.js"
import BaseCommand from "./base.js"

export default class BetaPingsCommand extends BaseCommand {
	name = "beta-pings"
	description = "Post the Beta Pings role toggle and ensure /beta is available"
	permission = Permission.ManageRoles
	ephemeral = true
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	guildIds = [betaPingsConfig.guildId]

	async run(interaction: CommandInteraction) {
		const privateReply = (message: string) => interaction.reply({
			ephemeral: true,
			components: [new TextDisplay(message)],
			allowedMentions: { parse: [] }
		})
		if (interaction.rawData.guild_id !== betaPingsConfig.guildId) {
			await privateReply("This command is only available in the configured server.")
			return
		}
		// Default command permissions can be overridden by Discord administrators;
		// authenticate the invoking member from the signed interaction as well.
		const rawPermissions = interaction.rawData.member?.permissions
		const permissions = typeof rawPermissions === "string" && /^\d+$/.test(rawPermissions)
			? BigInt(rawPermissions) : 0n
		if ((permissions & (Permission.ManageRoles | Permission.Administrator)) === 0n) {
			await privateReply("You need Manage Roles or Administrator permission to use this command.")
			return
		}
		try {
			await ensureBetaCommand(interaction.client, getRuntimeEnv().DB)
			// Finish the private deferred response before sending the public followup.
			// The visibility of the original deferred message cannot be changed.
			await privateReply("The /beta command is ready. Posting the Beta Pings menu.")
			await interaction.followUp({
				ephemeral: false,
				components: [buildBetaPingsContainer()],
				allowedMentions: { parse: [] }
			})
		} catch (error) {
			await privateReply(error instanceof BetaRegistrationError
				? error.message
				: "Could not confirm /beta registration or menu delivery. Nothing was retried. Ask an operator to check before trying again.")
		}
	}
}
