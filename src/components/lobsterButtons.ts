import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	Container,
	LinkButton,
	MediaGallery,
	Row,
	Separator,
	TextDisplay
} from "@buape/carbon"
import { lobsterConfig, lobsterDossierUrl } from "../config/lobster.js"
import type { LobsterEncounter } from "../db/schema.js"
import {
	formatLobsterEncounterId,
	type LobsterButterResult,
	type LegacyLobsterMetrics,
	type LobsterMetrics
} from "../services/lobsterEngine.js"

export type LobsterEncounterMedia = {
	imageUrl?: string | null
	counterImageUrl?: string | null
}

const parseJson = <T>(value: string | null): T | null => {
	if (!value) {
		return null
	}
	try {
		return JSON.parse(value) as T
	} catch {
		return null
	}
}

const isV2Metrics = (
	metrics: LobsterMetrics | LegacyLobsterMetrics
): metrics is LobsterMetrics => "version" in metrics && metrics.version === 2

const metricsText = (metricsJson: string | null) => {
	const metrics = parseJson<LobsterMetrics | LegacyLobsterMetrics>(metricsJson)
	if (!metrics) {
		return "**Encounter metrics:** unavailable"
	}
	if (isV2Metrics(metrics)) {
		return `**MENACE:** ${metrics.menace}%\n**SHELL SHOCK:** ${metrics.shellShock}%\n**DIGNITY REMAINING:** ${metrics.dignityRemaining}%\n**ESCAPE CHANCE:** ${metrics.escapeChance}%\n\n**WHY THIS WAS SCIENTIFICALLY ALLOWED**\n${metrics.nerdNote}`
	}
	return `**Action:** ${metrics.action.replaceAll("-", " ")}\n**Resolve:** ${metrics.resolve}%\n**Approach distance:** ${metrics.approachDistanceCm} cm\n**Procedural drag:** ${metrics.proceduralDrag}%`
}

export const buildLobsterNoticeContainer = (
	body: string,
	accentColor: string = lobsterConfig.noticeColor
) => new Container([new TextDisplay(body)], { accentColor })

export const buildLobsterEncounterContainer = (
	encounter: LobsterEncounter,
	media: LobsterEncounterMedia = {}
) => {
	const encounterId = formatLobsterEncounterId(encounter.id)
	const imageUrl =
		media.imageUrl === undefined ? encounter.assetUrl : media.imageUrl
	const components: NonNullable<ConstructorParameters<typeof Container>[0]> = [
		new TextDisplay(
			`## <@${encounter.targetId}> GOT LOBSTERED\n### ${encounter.headline} · ${encounter.speciesDisplayName}\n-# Deployed by <@${encounter.actorId}> · Encounter ${encounterId}`
		)
	]

	if (imageUrl) {
		components.push(
			new MediaGallery([
				{
					url: imageUrl,
					description: encounter.accessibilityDescription
				}
			])
		)
	} else {
		components.push(
			new TextDisplay("-# Encounter artwork is temporarily unavailable.")
		)
	}

	components.push(
		new TextDisplay(
			`${encounter.narrative}\n\n${metricsText(
				encounter.metricsJson
			)}`
		)
	)

	if (
		encounter.responseType === "return_to_sender" &&
		encounter.counterHeadline &&
		encounter.counterNarrative
	) {
		const counterImageUrl =
			media.counterImageUrl === undefined
				? encounter.counterAssetUrl
				: media.counterImageUrl
		components.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				`### ${encounter.counterHeadline}\n${encounter.counterNarrative}\n\n${metricsText(
					encounter.counterMetricsJson
				)}`
			)
		)
		if (counterImageUrl) {
			components.push(
				new MediaGallery([
					{
						url: counterImageUrl,
						description:
							encounter.counterAccessibilityDescription ??
							`Return scene for ${encounter.speciesDisplayName}`
					}
				])
			)
		} else {
			components.push(
				new TextDisplay("-# Return artwork is temporarily unavailable.")
			)
		}
	}

	if (encounter.responseType === "offer_butter") {
		const result = parseJson<LobsterButterResult>(
			encounter.responseResultJson
		)
		components.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				result
					? `### ${result.headline}\n${result.narrative}`
					: "### Butter offer resolved\nThe encounter is closed."
			)
		)
	}

	const closed =
		encounter.responseStatus === "responded" || encounter.targetIsBot
	components.push(
		new Separator({ divider: true, spacing: "small" }),
		new TextDisplay(
			`${closed ? "" : `**<@${encounter.targetId}>: choose your response. Only you can press these buttons.**\n`}-# *${encounter.speciesAcceptedName}* · ${encounter.speciesFamily} · AphiaID ${encounter.speciesAphiaId}\n-# Taxonomy snapshot: ${encounter.taxonomySnapshotId} · Status: ${
				encounter.targetIsBot
					? "target is a bot; responses disabled"
					: closed
						? "response recorded; encounter closed"
						: "awaiting target response"
			}.`
		),
		new Row([
			new LobsterReturnButton(encounter.id, closed),
			new LobsterButterButton(encounter.id, closed),
			new LobsterDossierButton(encounter.speciesAphiaId)
		])
	)

	return new Container(components, {
		accentColor: lobsterConfig.accentColor
	})
}

export class LobsterReturnButton extends Button {
	customId = "lobster-return"
	label = "Lobster Them Back"
	style = ButtonStyle.Danger
	defer = false
	ephemeral = false
	disabled = false

	constructor(encounterId?: number, disabled = false) {
		super()
		if (encounterId !== undefined) {
			this.customId = `lobster-return:id=${encounterId}`
		}
		this.disabled = disabled
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const { handleLobsterReturn } = await import(
			"../services/lobsterInteractions.js"
		)
		await handleLobsterReturn(interaction, data)
	}
}

export class LobsterButterButton extends Button {
	customId = "lobster-butter"
	label = "Bribe With Butter"
	style = ButtonStyle.Secondary
	defer = false
	ephemeral = false
	disabled = false

	constructor(encounterId?: number, disabled = false) {
		super()
		if (encounterId !== undefined) {
			this.customId = `lobster-butter:id=${encounterId}`
		}
		this.disabled = disabled
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const { handleLobsterButter } = await import(
			"../services/lobsterInteractions.js"
		)
		await handleLobsterButter(interaction, data)
	}
}

export class LobsterDossierButton extends LinkButton {
	label = "Open Lobster Dossier"
	url: string

	constructor(aphiaId: number) {
		super()
		this.url = lobsterDossierUrl(aphiaId)
	}
}

export const lobsterComponents = [
	new LobsterReturnButton(),
	new LobsterButterButton()
]
