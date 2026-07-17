import type {
	ButtonInteraction,
	ComponentData
} from "@buape/carbon"
import { buildLobsterNoticeContainer } from "../components/lobsterButtons.js"
import { lobsterConfig } from "../config/lobster.js"
import {
	getLobsterEncounter,
	recordLobsterResponse
} from "../data/lobsterEncounters.js"
import type { LobsterEncounter } from "../db/schema.js"
import {
	generateLobsterButterResult,
	generateLobsterReturn
} from "./lobsterEngine.js"
import { buildLobsterEncounterPayload } from "./lobsterMedia.js"

export const hasLobsterRole = (roleIds: string[]) =>
	roleIds.some((roleId) =>
		lobsterConfig.authorizedRoleIds.some(
			(authorizedRoleId) => authorizedRoleId === roleId
		)
	)

export const parseLobsterEncounterId = (id: unknown) => {
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
	accentColor: string = lobsterConfig.noticeColor
) => {
	await interaction.reply({
		components: [buildLobsterNoticeContainer(body, accentColor)],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
}

const boundEncounter = async (
	interaction: ButtonInteraction,
	data: ComponentData
): Promise<LobsterEncounter | null> => {
	const encounterId = parseLobsterEncounterId(data.id)
	if (!encounterId) {
		return null
	}
	const encounter = await getLobsterEncounter(encounterId)
	if (
		!encounter ||
		!encounter.messageId ||
		encounter.publicationStatus !== "published" ||
		interaction.rawData.guild_id !== encounter.guildId ||
		interaction.rawData.channel_id !== encounter.channelId ||
		interaction.rawData.message.id !== encounter.messageId
	) {
		return null
	}
	return encounter
}

const updateCanonicalEncounter = async (
	interaction: ButtonInteraction,
	encounter: LobsterEncounter
) => {
	const payload = await buildLobsterEncounterPayload(encounter)
	await interaction.update({
		...payload,
		allowedMentions: { parse: [] }
	})
}

const authorizeTarget = async (
	interaction: ButtonInteraction,
	encounter: LobsterEncounter
) => {
	const userId = interaction.user?.id ?? interaction.userId
	if (userId !== encounter.targetId || interaction.user?.bot) {
		await replyWithNotice(
			interaction,
			"Only the named non-bot target may respond to this encounter.",
			lobsterConfig.errorColor
		)
		return null
	}
	if (encounter.targetIsBot) {
		await replyWithNotice(
			interaction,
			"Bot targets cannot negotiate lobster encounters.",
			lobsterConfig.errorColor
		)
		return null
	}
	return userId
}

const handleResponse = async (
	interaction: ButtonInteraction,
	data: ComponentData,
	responseType: "return_to_sender" | "offer_butter"
) => {
	const encounter = await boundEncounter(interaction, data)
	if (!encounter) {
		await replyWithNotice(
			interaction,
			"This lobster encounter could not be verified.",
			lobsterConfig.errorColor
		)
		return
	}
	const responderId = await authorizeTarget(interaction, encounter)
	if (!responderId) {
		return
	}
	if (encounter.responseStatus === "responded") {
		await updateCanonicalEncounter(interaction, encounter)
		return
	}
	const messageId = encounter.messageId
	if (!messageId) {
		await replyWithNotice(
			interaction,
			"This lobster encounter could not be verified.",
			lobsterConfig.errorColor
		)
		return
	}

	const result =
		responseType === "return_to_sender"
			? {
				responseType,
				responseResult: {
					outcome: "returned",
					speciesAphiaId: encounter.speciesAphiaId
				},
				counterEvent: generateLobsterReturn(encounter)
			} as const
			: {
				responseType,
				responseResult: generateLobsterButterResult(encounter)
			} as const

	const recorded = await recordLobsterResponse({
		encounterId: encounter.id,
		guildId: encounter.guildId,
		channelId: encounter.channelId,
		messageId,
		responderId,
		responderIsBot: false,
		...result
	})
	if (recorded.kind === "not_found" || recorded.kind === "unauthorized") {
		await replyWithNotice(
			interaction,
			"This lobster response could not be authorized.",
			lobsterConfig.errorColor
		)
		return
	}
	await updateCanonicalEncounter(interaction, recorded.encounter)
}

export const handleLobsterReturn = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	try {
		await handleResponse(interaction, data, "return_to_sender")
	} catch (error) {
		console.error("Failed to return lobster encounter:", error)
		await replyWithNotice(
			interaction,
			"The lobster return desk is temporarily unavailable.",
			lobsterConfig.errorColor
		).catch(() => null)
	}
}

export const handleLobsterButter = async (
	interaction: ButtonInteraction,
	data: ComponentData
) => {
	try {
		await handleResponse(interaction, data, "offer_butter")
	} catch (error) {
		console.error("Failed to resolve lobster butter offer:", error)
		await replyWithNotice(
			interaction,
			"The lobster negotiation desk is temporarily unavailable.",
			lobsterConfig.errorColor
		).catch(() => null)
	}
}
