import { describe, expect, it, spyOn } from "bun:test"
import { processNominationRoleGrant } from "../src/services/nominationRoleGrant.js"
import type { Nomination } from "../src/db/schema.js"

const grantingNomination: Nomination = {
	id: 1,
	guildId: "guild-1",
	channelId: "channel-1",
	nomineeId: "nominee-1",
	nominatorId: "nominator-1",
	reason: "excellent shell judgment",
	messageId: "message-1",
	targetRoleId: "role-1",
	requiredApprovals: 3,
	status: "granting",
	expiresAt: "2099-01-01T00:00:00.000Z",
	completedAt: null,
	createdAt: "2026-06-30T00:00:00.000Z",
	updatedAt: "2026-06-30T00:00:00.000Z"
}

describe("processNominationRoleGrant", () => {
	it("leaves a failed role grant pending so a later attempt can retry it", async () => {
		let markApprovedCalled = false
		const pendingNomination = {
			...grantingNomination,
			updatedAt: "2026-06-30T00:15:00.000Z"
		}

		const result = await processNominationRoleGrant(grantingNomination, {
			addTargetRole: async () => false,
			markNominationApproved: async () => {
				markApprovedCalled = true
				return null
			},
			markNominationGrantPending: async () => pendingNomination,
			getNomination: async () => grantingNomination
		})

		expect(result).toEqual({
			status: "pending",
			nomination: pendingNomination
		})
		expect(markApprovedCalled).toBe(false)
	})

	it("marks the nomination approved after the role grant succeeds", async () => {
		const approvedNomination = {
			...grantingNomination,
			status: "approved"
		} satisfies Nomination

		const result = await processNominationRoleGrant(grantingNomination, {
			addTargetRole: async () => true,
			markNominationApproved: async () => approvedNomination,
			markNominationGrantPending: async () => null,
			getNomination: async () => approvedNomination
		})

		expect(result).toEqual({
			status: "approved",
			nomination: approvedNomination
		})
	})

	it("recognizes approval completed by a concurrent retry", async () => {
		const approvedNomination = {
			...grantingNomination,
			status: "approved"
		} satisfies Nomination

		const result = await processNominationRoleGrant(grantingNomination, {
			addTargetRole: async () => true,
			markNominationApproved: async () => null,
			markNominationGrantPending: async () => null,
			getNomination: async () => approvedNomination
		})

		expect(result).toEqual({
			status: "approved",
			nomination: approvedNomination
		})
	})

	it("keeps the grant pending when recording the retry time fails", async () => {
		const consoleError = spyOn(console, "error").mockImplementation(() => {})

		try {
			const result = await processNominationRoleGrant(grantingNomination, {
				addTargetRole: async () => false,
				markNominationApproved: async () => null,
				markNominationGrantPending: async () => {
					throw new Error("database unavailable")
				},
				getNomination: async () => grantingNomination
			})

			expect(result).toEqual({
				status: "pending",
				nomination: grantingNomination
			})
			expect(consoleError).toHaveBeenCalledTimes(1)
		} finally {
			consoleError.mockRestore()
		}
	})
})
