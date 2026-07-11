import type {
	ButtonInteraction,
	ComponentData
} from "@buape/carbon"
import { buildNominationNoticeContainer } from "../components/nominationButtons.js"
import { nominationConfig } from "../config/nominations.js"
import {
	getNomination,
	type NominationVoteChoice,
	recordNominationVote
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { syncNominationReviewCard } from "./nominationCardSync.js"
import { logNominationOperation } from "./nominationObservability.js"
import { processNominationRoleGrant } from "./nominationRoleGrant.js"

type NominationInteractionBinding = {
	guildId: string | null | undefined
	channelId: string | null | undefined
	messageId: string | null | undefined
}

export const parseNominationId = (id: unknown) => {
	if (typeof id === "number" && Number.isInteger(id)) {
		return id
	}
	if (typeof id === "string" && /^\d+$/.test(id)) {
		return Number(id)
	}
	return null
}

export const hasNominationApproverRole = (roleIds: string[]) =>
	roleIds.some((roleId) => nominationConfig.approverRoleIds.includes(roleId))

export const isNominationInteractionBound = (
	nomination: Nomination,
	binding: NominationInteractionBinding
) =>
	binding.guildId === nomination.guildId &&
	binding.channelId === nomination.channelId &&
	binding.channelId === nominationConfig.reviewChannelId &&
	binding.messageId === nomination.messageId

const replyWithNotice = async (
	interaction: ButtonInteraction,
	body: string,
	accentColor = "#f1c40f"
) => {
	await interaction.reply({
		components: [buildNominationNoticeContainer(body, accentColor)],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
}

export const handleNominationVote = async (
	interaction: ButtonInteraction,
	data: ComponentData,
	choice: NominationVoteChoice
) => {
	const nominationId = parseNominationId(data.id)
	if (!nominationId) {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.invalidNomination,
			"#f85149"
		)
		return
	}

	const nomination = await getNomination(nominationId)
	if (!nomination) {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.invalidNomination,
			"#f85149"
		)
		return
	}

	if (!isNominationInteractionBound(nomination, {
		guildId: interaction.rawData.guild_id,
		channelId: interaction.rawData.channel_id,
		messageId: interaction.rawData.message.id
	})) {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.invalidNomination,
			"#f85149"
		)
		return
	}

	if (!hasNominationApproverRole(
		interaction.member?.roles.map((role) => role.id) ?? []
	)) {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.noPermission,
			"#f85149"
		)
		return
	}

	const reviewerId = interaction.user?.id ?? interaction.userId
	if (!reviewerId) {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.invalidNomination,
			"#f85149"
		)
		return
	}

	const result = await recordNominationVote(
		nomination.id,
		reviewerId,
		choice
	)
	if (result.kind === "not_found") {
		await replyWithNotice(
			interaction,
			nominationConfig.copy.invalidNomination,
			"#f85149"
		)
		return
	}

	if (result.kind === "closed") {
		await syncNominationReviewCard(interaction.client, nomination.id)
		await replyWithNotice(
			interaction,
			nominationConfig.copy.alreadyComplete
		)
		return
	}

	if (result.kind === "unchanged") {
		await replyWithNotice(interaction, nominationConfig.copy.voteUnchanged)
		return
	}

	logNominationOperation({
		operation: "vote",
		nomination: result.nomination,
		totals: result.totals,
		previousStatus: nomination.status
	})

	if (result.kind === "expired") {
		await syncNominationReviewCard(interaction.client, nomination.id)
		await replyWithNotice(
			interaction,
			nominationConfig.copy.nominationExpired,
			"#8b949e"
		)
		return
	}

	if (result.kind === "granting") {
		await syncNominationReviewCard(interaction.client, nomination.id)
		const grantResult = await processNominationRoleGrant(result.nomination)
		await syncNominationReviewCard(interaction.client, nomination.id)
		if (grantResult.status === "pending") {
			await replyWithNotice(
				interaction,
				nominationConfig.copy.roleAddFailed,
				"#f85149"
			)
			return
		}

		await replyWithNotice(
			interaction,
			"Third approval recorded. Shell Society role granted.",
			"#3fb950"
		)
		return
	}

	await syncNominationReviewCard(interaction.client, nomination.id)
	if (result.kind === "declined") {
		await replyWithNotice(
			interaction,
			"Third decline recorded. Nomination declined.",
			"#f85149"
		)
		return
	}

	await replyWithNotice(
		interaction,
		result.kind === "switched"
			? nominationConfig.copy.voteSwitched
			: nominationConfig.copy.voteRecorded,
		"#3fb950"
	)
}
