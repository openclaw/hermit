import type { Client } from "@buape/carbon"
import { expireWatchlistCases, pruneOldObservations } from "../data/review.js"
import {
	recoverReviewReceipts,
	recoverReviewEscalations,
	recoverSharedCardSync
} from "./reviewNotifier.js"

export const runReviewMaintenance = async (client: Client) => {
	const stages: [string, () => Promise<unknown>][] = [
		["watchlist expiry", () => expireWatchlistCases()],
		["observation retention", () => pruneOldObservations(14)],
		["receipt reconciliation", () => recoverReviewReceipts(client)],
		["escalation delivery", () => recoverReviewEscalations(client)],
		["shared-card synchronization", () => recoverSharedCardSync(client)]
	]
	for (const [name, run] of stages) {
		try {
			await run()
		} catch (error) {
			console.error(`Review maintenance stage failed (${name}):`, error)
		}
	}
}
