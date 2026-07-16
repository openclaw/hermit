import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	Container,
	MediaGallery,
	Row,
	Separator,
	TextDisplay
} from "@buape/carbon"
import {
	slapConfig,
	type SlapRarity
} from "../config/slap.js"
import type { SlapEvent } from "../db/schema.js"
import { formatSlapIncidentId } from "../services/slapEngine.js"

const rarityDetails = (rarity: string | null) =>
	slapConfig.rarities[rarity as SlapRarity] ?? slapConfig.rarities.common

const metricText = (
	impact: number,
	dignityRemaining: number,
	fishCondition: string
) =>
	`**Impact:** ${impact.toLocaleString("en-US")} N\n**Dignity remaining:** ${dignityRemaining}%\n**Fish condition:** ${fishCondition}`

export const buildSlapNoticeContainer = (
	body: string,
	accentColor = "#f1c40f"
) => new Container([new TextDisplay(body)], { accentColor })

export const buildSlapIncidentContainer = (event: SlapEvent) => {
	const rarity = rarityDetails(event.rarity)
	const incidentId = formatSlapIncidentId(event.id)
	const components: NonNullable<ConstructorParameters<typeof Container>[0]> = [
		new TextDisplay(
			`## Fishery Incident ${incidentId}\n**${rarity.label.toUpperCase()} · ${event.fishName}**`
		),
		new MediaGallery([
			{
				url: event.imageUrl,
				description: `${event.fishName}, assigned to ${incidentId}`
			}
		]),
		new TextDisplay(
			`### ${event.headline}\n${event.narrative}\n\n${metricText(
				event.impact,
				event.dignityRemaining,
				event.fishCondition
			)}`
		)
	]

	if (
		event.counteredAt &&
		event.counterFishName &&
		event.counterRarity &&
		event.counterHeadline &&
		event.counterNarrative &&
		event.counterImpact !== null &&
		event.counterDignityRemaining !== null &&
		event.counterFishCondition &&
		event.counterImageUrl
	) {
		const counterRarity = rarityDetails(event.counterRarity)
		components.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				`### Counter-filing accepted\n**${counterRarity.label.toUpperCase()} · ${event.counterFishName}**\n${event.counterHeadline}\n\n${event.counterNarrative}\n\n${metricText(
					event.counterImpact,
					event.counterDignityRemaining,
					event.counterFishCondition
				)}`
			),
			new MediaGallery([
				{
					url: event.counterImageUrl,
					description: `${event.counterFishName}, deployed as the counter-filing for ${incidentId}`
				}
			])
		)
	}

	const status = [
		event.counteredAt ? "Counter-filing closed" : "Counter-filing available to the target",
		event.appealedAt ? "Appeal sealed" : "Appeal window open"
	].join(" · ")
	components.push(
		new Separator({ divider: true, spacing: "small" }),
		new TextDisplay(
			`-# ${status}. Filed by the Hermit Department of Interpersonal Fisheries.`
		),
		new Row([
			new SlapBackButton(
				event.id,
				Boolean(event.counteredAt || event.targetIsBot)
			),
			new SlapAppealButton(
				event.id,
				Boolean(event.appealedAt || event.targetIsBot)
			)
		])
	)

	return new Container(components, { accentColor: rarity.color })
}

export class SlapBackButton extends Button {
	customId = "slap-back"
	label = "Slap Back"
	emoji = { name: "🐟" }
	style = ButtonStyle.Danger
	defer = false
	ephemeral = false
	disabled = false

	constructor(eventId?: number, disabled = false) {
		super()
		if (eventId !== undefined) {
			this.customId = `slap-back:id=${eventId}`
		}
		this.disabled = disabled
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const { handleSlapBack } = await import("../services/slapInteractions.js")
		await handleSlapBack(interaction, data)
	}
}

export class SlapAppealButton extends Button {
	customId = "slap-appeal"
	label = "Appeal"
	emoji = { name: "📎" }
	style = ButtonStyle.Secondary
	defer = false
	ephemeral = false
	disabled = false

	constructor(eventId?: number, disabled = false) {
		super()
		if (eventId !== undefined) {
			this.customId = `slap-appeal:id=${eventId}`
		}
		this.disabled = disabled
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const { handleSlapAppeal } = await import("../services/slapInteractions.js")
		await handleSlapAppeal(interaction, data)
	}
}

export const slapComponents = [
	new SlapBackButton(),
	new SlapAppealButton()
]
