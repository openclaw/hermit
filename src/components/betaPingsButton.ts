import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	Container,
	Section,
	TextDisplay
} from "@buape/carbon"
import { betaPingsConfig } from "../config/betaPings.js"
import {
	isBetaPingsLocation,
	toggleBetaPingsRole,
	type BetaPingsMember
} from "../services/betaPings.js"

type FetchMember = (
	guildId: string,
	userId: string
) => Promise<BetaPingsMember>

const noticeContainer = (message: string, accentColor?: string) =>
	new Container([new TextDisplay(message)], { accentColor })

export const handleBetaPingsToggle = async (
	interaction: ButtonInteraction,
	fetchMember: FetchMember = (guildId, userId) =>
		interaction.client.fetchMember(guildId, userId)
) => {
	const guildId = interaction.rawData.guild_id
	const channelId = interaction.rawData.channel_id

	if (!isBetaPingsLocation(guildId, channelId)) {
		await interaction.reply({
			components: [
				noticeContainer(betaPingsConfig.copy.wrongLocation, "#f85149")
			],
			allowedMentions: { parse: [] }
		})
		return
	}

	const userId = interaction.user?.id ?? interaction.userId
	if (!userId) {
		await interaction.reply({
			components: [
				noticeContainer(betaPingsConfig.copy.userNotFound, "#f85149")
			],
			allowedMentions: { parse: [] }
		})
		return
	}

	try {
		const member = await fetchMember(betaPingsConfig.guildId, userId)
		const result = await toggleBetaPingsRole(member)
		await interaction.reply({
			components: [
				noticeContainer(
					result.enabled
						? betaPingsConfig.copy.enabled
						: betaPingsConfig.copy.disabled,
					result.enabled ? "#3fb950" : "#99aab5"
				)
			],
			allowedMentions: { parse: [] }
		})
	} catch (error) {
		console.error("Failed to toggle Beta Pings role:", error)
		await interaction.reply({
			components: [
				noticeContainer(betaPingsConfig.copy.updateFailed, "#f85149")
			],
			allowedMentions: { parse: [] }
		})
	}
}

export class BetaPingsToggleButton extends Button {
	customId = "beta-pings-toggle"
	label = betaPingsConfig.copy.buttonLabel
	style = ButtonStyle.Primary
	ephemeral = true
	defer = true

	async run(interaction: ButtonInteraction) {
		await handleBetaPingsToggle(interaction)
	}
}

export const buildBetaPingsContainer = () =>
	new Container([
		new TextDisplay(`### ${betaPingsConfig.copy.title}`),
		new Section(
			[new TextDisplay(betaPingsConfig.copy.description)],
			new BetaPingsToggleButton()
		)
	])

export const betaPingsComponents = [new BetaPingsToggleButton()]
