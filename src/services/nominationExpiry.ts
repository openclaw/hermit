import type { Client } from "@buape/carbon"
import {
	listGrantingNominations,
	listExpiredSubmittedNominations,
	listStaleUnpublishedNominations,
	markNominationExpired,
	markNominationSubmissionFailed
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { syncNominationReviewCard } from "./nominationCardSync.js"
import { processNominationRoleGrant } from "./nominationRoleGrant.js"

export const editNominationMessage = async (
	client: Client,
	nomination: Nomination
) => {
	await syncNominationReviewCard(client, nomination.id)
}

export const editNominationMessageExpired = editNominationMessage

export const runNominationExpiry = async (client: Client) => {
	const unpublishedNominations = await listStaleUnpublishedNominations()
	for (const nomination of unpublishedNominations) {
		await markNominationSubmissionFailed(nomination.id)
	}

	const expiredNominations = await listExpiredSubmittedNominations()

	for (const nomination of expiredNominations) {
		const expiredNomination = await markNominationExpired(nomination.id)
		if (!expiredNomination) {
			continue
		}

		await syncNominationReviewCard(client, expiredNomination.id)
	}
}

export const runNominationGrantRecovery = async (client: Client) => {
	const grantingNominations = await listGrantingNominations()

	for (const nomination of grantingNominations) {
		const result = await processNominationRoleGrant(nomination)
		await syncNominationReviewCard(client, result.nomination.id)
	}
}
