import {
	type Client,
	Routes,
	serializePayload
} from "@buape/carbon"
import { buildNominationContainer } from "../components/nominationButtons.js"
import { nominationConfig } from "../config/nominations.js"
import {
	getNominationReviewState,
	listPendingNominationCardSyncs,
	markNominationCardStaleWrite,
	markNominationCardSyncFailed,
	markNominationCardSynced
} from "../data/nominations.js"
import {
	getDiscordErrorStatus,
	logNominationOperation
} from "./nominationObservability.js"

export type NominationCardSyncResult =
	| { status: "synced" | "current" }
	| { status: "missing" | "failed" }

type NominationCardSyncDependencies = {
	getNominationReviewState: typeof getNominationReviewState
	markNominationCardStaleWrite: typeof markNominationCardStaleWrite
	markNominationCardSyncFailed: typeof markNominationCardSyncFailed
	markNominationCardSynced: typeof markNominationCardSynced
	logNominationOperation: typeof logNominationOperation
}

export const syncNominationReviewCard = async (
	client: Client,
	nominationId: number,
	maxAttempts = 3,
	overrides: Partial<NominationCardSyncDependencies> = {}
): Promise<NominationCardSyncResult> => {
	const dependencies: NominationCardSyncDependencies = {
		getNominationReviewState,
		markNominationCardStaleWrite,
		markNominationCardSyncFailed,
		markNominationCardSynced,
		logNominationOperation,
		...overrides
	}

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const state = await dependencies.getNominationReviewState(nominationId)
		const messageId = state?.nomination.messageId
		if (!state || !messageId) {
			return { status: "missing" }
		}

		const { nomination, totals } = state
		if (nomination.desiredCardRevision <= nomination.syncedCardRevision) {
			return { status: "current" }
		}

		const revision = nomination.desiredCardRevision
		if (nomination.channelId !== nominationConfig.reviewChannelId) {
			const failedNomination =
				await dependencies.markNominationCardSyncFailed(
					nomination.id,
					revision
				)
			dependencies.logNominationOperation({
				operation: "card_sync",
				nomination: failedNomination ?? nomination,
				totals,
				discordResponseStatus: "unexpected_channel",
				failed: true
			})
			return { status: "failed" }
		}

		try {
			await client.rest.patch(
				Routes.channelMessage(nomination.channelId, messageId),
				{
					body: serializePayload({
						components: [buildNominationContainer(nomination, totals)],
						allowedMentions: { parse: [] }
					})
				}
			)
			const synchronized = await dependencies.markNominationCardSynced(
				nomination.id,
				revision
			)
			if (!synchronized) {
				const staleWrite = await dependencies.markNominationCardStaleWrite(
					nomination.id,
					revision
				)
				if (staleWrite) {
					dependencies.logNominationOperation({
						operation: "card_sync",
						nomination: staleWrite,
						totals,
						discordResponseStatus: "stale_write",
						failed: true
					})
				}
				continue
			}

			dependencies.logNominationOperation({
				operation: "card_sync",
				nomination: synchronized,
				totals,
				discordResponseStatus: 200
			})
			return { status: "synced" }
		} catch (error) {
			let failedNomination = null
			try {
				failedNomination =
					await dependencies.markNominationCardSyncFailed(
						nomination.id,
						revision
					)
			} catch (trackingError) {
				console.error(
					`Failed to record card sync failure for nomination ${nomination.id}:`,
					trackingError
				)
			}

			let staleWrite = null
			if (!failedNomination) {
				try {
					staleWrite =
						await dependencies.markNominationCardStaleWrite(
							nomination.id,
							revision
						)
				} catch (trackingError) {
					console.error(
						`Failed to preserve stale card recovery for nomination ${nomination.id}:`,
						trackingError
					)
				}
			}

			dependencies.logNominationOperation({
				operation: "card_sync",
				nomination: staleWrite ?? failedNomination ?? nomination,
				totals,
				discordResponseStatus: getDiscordErrorStatus(error),
				failed: true
			})
			return { status: "failed" }
		}
	}

	return { status: "failed" }
}

export const runNominationCardSyncRecovery = async (client: Client) => {
	const pendingNominations = await listPendingNominationCardSyncs()
	for (const nomination of pendingNominations) {
		await syncNominationReviewCard(client, nomination.id)
	}
}
