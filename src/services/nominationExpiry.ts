import {
	type Client,
	Routes,
	serializePayload
} from "@buape/carbon"
import { buildNominationContainer } from "../components/nominationButtons.js"
import {
	getNominationApproverIds,
	listExpiredSubmittedNominations,
	markNominationExpired
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"

export const editNominationMessageExpired = async (
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
