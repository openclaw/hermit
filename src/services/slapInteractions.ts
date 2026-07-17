import {
	type ButtonInteraction,
	type ComponentData,
	Container,
	TextDisplay
} from "@buape/carbon"
import {
	buildSlapIncidentContainer,
	buildSlapNoticeContainer
} from "../components/slapButtons.js"
import { slapConfig } from "../config/slap.js"
import {
	bindSlapMessage,
	getSlapEvent,
	recordSlapAppeal,
	recordSlapCounter
} from "../data/slapEvents.js"
import type { SlapEvent } from "../db/schema.js"
import {
	formatSlapIncidentId,
	generateSlapResult,
	getAppealRuling
} from "./slapEngine.js"

export const hasSlapRole = (roleIds: string[]) =>
	roleIds.some((roleId) =>
		slapConfig.authorizedRoleIds.some(
			(authorizedRoleId) => authorizedRoleId === roleId
		)
	)

export const parseSlapEventId = (id: unknown) => {
	if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
		return id
	}
	if (typeof id === "string" && /^\d+$/.test(id)) {
		const parsed = Number(id)
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
	}
	return null
}

const replyWithNotice = async (
	interaction: ButtonInteraction,
	body: string,
	accentColor = "#f1c40f"
) => {
	await interaction.reply({
		components: [buildSlapNoticeContainer(body, accentColor)],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
}

const boundEvent = async (
	interaction: ButtonInteraction,
	data: ComponentData
): Promise<SlapEvent | null> => {
	const eventId = parseSlapEventId(data.id)
	if (!eventId) {
		return null
	}
	let event = await getSlapEvent(eventId)
	if (!event) {
		return null
	}

	const messageId = interaction.rawData.message.id
	if (!event.messageId) {
		event = await bindSlapMessage(event.id, messageId) ?? event
	}
	if (
		interaction.rawData.guild_id !== event.guildId ||
		interaction.rawData.channel_id !== event.channelId ||
		event.messageId !== messageId
	) {
		return null
	}
	return event
}

const updateCanonicalIncident = async (
	interaction: ButtonInteraction,
	event: SlapEvent
) => {
	await interaction.update({
		components: [buildSlapIncidentContainer(event)],
		allowedMentions: { parse: [] }
	})
}

const handleSlapBackInternal = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	const event = await boundEvent(interaction, data)
	if (!event) {
		await replyWithNotice(
			interaction,
			"This fishery incident could not be verified.",
			"#f85149"
		)
		return
	}

	const userId = interaction.user?.id ?? interaction.userId
	if (userId !== event.targetId) {
		await replyWithNotice(
			interaction,
			"Only the named target may file the counter-slap.",
			"#f85149"
		)
		return
	}
	if (!hasSlapRole(
		interaction.member?.roles.map((role) => role.id) ?? []
	)) {
		await replyWithNotice(
			interaction,
			"Counter-slaps require an active Community Team or Maintainer role.",
			"#f85149"
		)
		return
	}

	if (event.counteredAt) {
		await updateCanonicalIncident(interaction, event)
		return
	}

	const result = generateSlapResult({
		seed: `counter:${event.interactionId}`,
		actor: { id: event.targetId, bot: event.targetIsBot },
		target: { id: event.actorId, bot: false },
		mode: "counter"
	})
	const recorded = await recordSlapCounter(
		event.id,
		event.targetId,
		event.actorId,
		result
	)
	if (!recorded) {
		await replyWithNotice(
			interaction,
			"This fishery incident no longer exists.",
			"#f85149"
		)
		return
	}

	await updateCanonicalIncident(interaction, recorded.event)
}

export const handleSlapBack = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	try {
		await handleSlapBackInternal(interaction, data)
	} catch (error) {
		console.error("Failed to process slap-back:", error)
		await replyWithNotice(
			interaction,
			"The counter-filing desk is temporarily underwater.",
			"#f85149"
		).catch(() => null)
	}
}

const handleSlapAppealInternal = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	const event = await boundEvent(interaction, data)
	if (!event) {
		await replyWithNotice(
			interaction,
			"This fishery incident could not be verified.",
			"#f85149"
		)
		return
	}

	const userId = interaction.user?.id ?? interaction.userId
	if (userId !== event.targetId) {
		await replyWithNotice(
			interaction,
			"Only the named target has standing to appeal.",
			"#f85149"
		)
		return
	}

	const ruling = event.appealRuling ?? getAppealRuling(event.id)
	const recorded = await recordSlapAppeal(event.id, userId, ruling)
	if (!recorded) {
		await replyWithNotice(
			interaction,
			"This fishery incident no longer exists.",
			"#f85149"
		)
		return
	}

	await interaction.reply({
		components: [
			new Container(
				[
					new TextDisplay(
						`### Appeal ruling · ${formatSlapIncidentId(event.id)}`
					),
					new TextDisplay(recorded.event.appealRuling ?? ruling)
				],
				{ accentColor: "#58a6ff" }
			)
		],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
	await interaction.message?.edit({
		components: [buildSlapIncidentContainer(recorded.event)],
		allowedMentions: { parse: [] }
	}).catch((error) => {
		console.error(
			`Failed to synchronize appealed slap event ${recorded.event.id}:`,
			error
		)
	})
}

export const handleSlapAppeal = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	try {
		await handleSlapAppealInternal(interaction, data)
	} catch (error) {
		console.error("Failed to process slap appeal:", error)
		await replyWithNotice(
			interaction,
			"The appeals desk has misplaced the waterproof folder.",
			"#f85149"
		).catch(() => null)
	}
}
