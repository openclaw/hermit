import {
	type Client,
	Routes,
	serializePayload
} from "@buape/carbon"
import { buildNominationContainer } from "../components/nominationButtons.js"
import {
	getNominationApproverIds,
	listGrantingNominations,
	listExpiredSubmittedNominations,
	markNominationExpired
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { processNominationRoleGrant } from "./nominationRoleGrant.js"

export const editNominationMessage = async (
	client: Client,
	nomination: Nomination
) => {
	if (!nomination.messageId) {
		return
	}

	const approverIds = await getNominationApproverIds(nomination.id)
	await client.rest.patch(
		Routes.channelMessage(nomination.channelId, nomination.messageId),
		{
			body: serializePayload({
				components: [buildNominationContainer(nomination, approverIds)],
				allowedMentions: { parse: [] }
			})
		}
	)
}

export const editNominationMessageExpired = editNominationMessage

export const runNominationExpiry = async (client: Client) => {
	const expiredNominations = await listExpiredSubmittedNominations()

	for (const nomination of expiredNominations) {
		const expiredNomination = await markNominationExpired(nomination.id)
		if (!expiredNomination) {
			continue
		}

		try {
			await editNominationMessageExpired(client, expiredNomination)
		} catch (error) {
			console.error(
				`Failed to edit expired nomination message ${expiredNomination.id}:`,
				error
			)
		}
	}
}

export const runNominationGrantRecovery = async (client: Client) => {
	const grantingNominations = await listGrantingNominations()

	for (const nomination of grantingNominations) {
		const result = await processNominationRoleGrant(nomination)
		if (result.status !== "approved") {
			continue
		}

		try {
			await editNominationMessage(client, result.nomination)
		} catch (error) {
			console.error(
				`Failed to edit approved nomination message ${result.nomination.id}:`,
				error
			)
		}
	}
}
