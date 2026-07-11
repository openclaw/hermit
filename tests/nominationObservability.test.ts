import { describe, expect, it, spyOn } from "bun:test"
import type { Nomination } from "../src/db/schema.js"
import { logNominationOperation } from "../src/services/nominationObservability.js"

const nomination = {
	id: 1,
	guildId: "guild-1",
	channelId: "channel-1",
	nomineeId: "nominee-1",
	nominatorId: "nominator-1",
	reason: "private nomination reason",
	messageId: "message-1",
	targetRoleId: "role-1",
	requiredApprovals: 3,
	status: "submitted",
	expiresAt: "2099-01-01T00:00:00.000Z",
	completedAt: null,
	desiredCardRevision: 2,
	syncedCardRevision: 1,
	cardSyncStartedAt: "2026-07-10T00:00:00.000Z",
	cardSyncFailureCount: 0,
	grantStartedAt: null,
	grantFailureCount: 0,
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:00:00.000Z"
} satisfies Nomination

describe("nomination observability", () => {
	it("logs measurable fields without nomination reasons", () => {
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			logNominationOperation({
				operation: "vote",
				nomination,
				totals: { approvals: 2, declines: 1 },
				previousStatus: "submitted"
			})

			expect(consoleLog).toHaveBeenCalledTimes(1)
			const message = String(consoleLog.mock.calls[0]?.[0])
			expect(message).toContain('"nominationId":1')
			expect(message).toContain('"approvalCount":2')
			expect(message).toContain('"declineCount":1')
			expect(message).not.toContain(nomination.reason)
		} finally {
			consoleLog.mockRestore()
		}
	})

	it("escalates repeated synchronization failures", () => {
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			logNominationOperation({
				operation: "card_sync",
				nomination: {
					...nomination,
					cardSyncFailureCount: 3
				},
				totals: { approvals: 2, declines: 1 },
				discordResponseStatus: 500,
				failed: true
			})

			expect(consoleError).toHaveBeenCalledTimes(1)
			expect(String(consoleError.mock.calls[0]?.[0])).toContain(
				'"consecutiveRetryCount":3'
			)
		} finally {
			consoleError.mockRestore()
		}
	})
})
