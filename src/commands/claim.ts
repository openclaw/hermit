import {
	ApplicationIntegrationType,
	Container,
	type CommandInteraction,
	InteractionContextType,
	LinkButton,
	Section,
	TextDisplay
} from "@buape/carbon"
import { getClaimRequest } from "../data/claimRequests.js"
import { createClaimUrl } from "../server/claimServer.js"
import BaseCommand from "./base.js"

const existingClaimMessage = (status: string) => {
	if (status === "accepted") {
		return "Your clawtributor claim has already been accepted."
	}

	if (status === "rejected") {
		return "Your clawtributor claim has already been reviewed. Ask a moderator if you think this needs another look."
	}

	return "Your clawtributor claim has already been submitted for review."
}

class ClaimLinkButton extends LinkButton {
	label = "Claim role"
	url: string

	constructor(url: string) {
		super()
		this.url = url
	}
}

export default class ClaimCommand extends BaseCommand {
	name = "claim"
	description = "Claim the clawtributors role"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	ephemeral = true

	async run(interaction: CommandInteraction) {
		const guildId = interaction.rawData.guild_id ?? interaction.guild?.id
		const userId = interaction.user?.id

		if (!guildId || !userId) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay("Run this command from the server where you want the role.")
					])
				]
			})
			return
		}

		const existingClaim = await getClaimRequest(userId, guildId)
		if (existingClaim) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Claim already exists"),
							new TextDisplay(existingClaimMessage(existingClaim.status))
						],
						{ accentColor: "#f1c40f" }
					)
				]
			})
			return
		}

		const claimUrl = await createClaimUrl(userId, guildId)

		await interaction.reply({
			components: [
				new Container([
					new TextDisplay("### Claim clawtributors"),
					new TextDisplay(
						"Authorize Discord connections access so Hermit can check your linked GitHub account for a merged pull request in openclaw/openclaw."
					),
					new Section(
						[new TextDisplay("Open the claim page to continue.")],
						new ClaimLinkButton(claimUrl)
					)
				])
			]
		})
	}
}
