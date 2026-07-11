import { describe, expect, it } from "bun:test"
import { serializePayload } from "@buape/carbon"
import { buildNominationContainer } from "../src/components/nominationButtons.js"
import { nominationConfig } from "../src/config/nominations.js"
import type { Nomination } from "../src/db/schema.js"
import {
	hasNominationApproverRole,
	isNominationInteractionBound,
	parseNominationId
} from "../src/services/nominationVoting.js"

const nomination = {
	id: 42,
	guildId: nominationConfig.guildId,
	channelId: nominationConfig.reviewChannelId,
	nomineeId: "nominee-1",
	nominatorId: "nominator-1",
	reason: "excellent shell judgment",
	messageId: "message-1",
	targetRoleId: nominationConfig.targetRoleId,
	requiredApprovals: 3,
	status: "submitted",
	expiresAt: "2099-01-01T00:00:00.000Z",
	completedAt: null,
	desiredCardRevision: 1,
	syncedCardRevision: 1,
	cardSyncStartedAt: null,
	cardSyncFailureCount: 0,
	grantStartedAt: null,
	grantFailureCount: 0,
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:00:00.000Z"
} satisfies Nomination

const flattenComponents = (component: unknown): Record<string, unknown>[] => {
	if (!component || typeof component !== "object") {
		return []
	}
	const record = component as Record<string, unknown>
	const children = Array.isArray(record.components)
		? record.components.flatMap(flattenComponents)
		: []
	return [record, ...children]
}

describe("nomination review card", () => {
	it("renders both vote totals and thumb controls for an open nomination", () => {
		const payload = serializePayload({
			components: [
				buildNominationContainer(nomination, {
					approvals: 2,
					declines: 1
				})
			]
		})
		const components = flattenComponents(payload)
		const text = components
			.map((component) => component.content)
			.filter((content): content is string => typeof content === "string")
			.join("\n")
		const buttons = components.filter((component) => component.type === 2)

		expect(text).toContain("👍 Approvals: 2/3")
		expect(text).toContain("👎 Declines: 1/3")
		expect(text).toContain("**Status:** Open")
		expect(buttons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					custom_id: "nomination-approve:id=42",
					disabled: false,
					emoji: { name: "👍" }
				}),
				expect.objectContaining({
					custom_id: "nomination-decline:id=42",
					disabled: false,
					emoji: { name: "👎" }
				})
			])
		)
	})

	it("keeps terminal details private-card shaped without welcome copy", () => {
		const approved = {
			...nomination,
			status: "approved",
			completedAt: "2026-07-10T01:00:00.000Z"
		} satisfies Nomination
		const payload = serializePayload({
			components: [
				buildNominationContainer(approved, {
					approvals: 3,
					declines: 1
				})
			]
		})
		const components = flattenComponents(payload)
		const text = components
			.map((component) => component.content)
			.filter((content): content is string => typeof content === "string")
			.join("\n")
		const buttons = components.filter((component) => component.type === 2)

		expect(text).toContain("**Nominee:** <@nominee-1>")
		expect(text).toContain("**Nominator:** <@nominator-1>")
		expect(text).toContain("excellent shell judgment")
		expect(text).toContain("Shell Society role granted.")
		expect(text.toLowerCase()).not.toContain("welcome to the shell society")
		expect(buttons.every((button) => button.disabled === true)).toBe(true)
	})

	for (const [status, expectedStatus] of [
		["granting", "Role grant pending"],
		["declined", "Declined"],
		["expired", "Expired"]
	] as const) {
		it(`renders the ${status} state with voting disabled`, () => {
			const payload = serializePayload({
				components: [
					buildNominationContainer(
						{
							...nomination,
							status
						},
						{
							approvals: status === "granting" ? 3 : 1,
							declines: status === "declined" ? 3 : 1
						}
					)
				]
			})
			const components = flattenComponents(payload)
			const text = components
				.map((component) => component.content)
				.filter((content): content is string => typeof content === "string")
				.join("\n")
			const buttons = components.filter((component) => component.type === 2)

			expect(text).toContain(`**Status:** ${expectedStatus}`)
			expect(text).toContain("excellent shell judgment")
			expect(text.toLowerCase()).not.toContain("welcome to the shell society")
			expect(buttons).toHaveLength(2)
			expect(buttons.every((button) => button.disabled === true)).toBe(true)
		})
	}
})

describe("nomination interaction authorization", () => {
	it("requires the configured Community Team role", () => {
		expect(hasNominationApproverRole(["unrelated-role"])).toBe(false)
		expect(
			hasNominationApproverRole([nominationConfig.approverRoleIds[0] ?? ""])
		).toBe(true)
	})

	it("binds component interactions to the stored guild, channel, and message", () => {
		expect(
			isNominationInteractionBound(nomination, {
				guildId: nomination.guildId,
				channelId: nomination.channelId,
				messageId: nomination.messageId
			})
		).toBe(true)
		expect(
			isNominationInteractionBound(nomination, {
				guildId: "wrong-guild",
				channelId: nomination.channelId,
				messageId: nomination.messageId
			})
		).toBe(false)
		expect(
			isNominationInteractionBound(nomination, {
				guildId: nomination.guildId,
				channelId: "wrong-channel",
				messageId: nomination.messageId
			})
		).toBe(false)
		expect(
			isNominationInteractionBound(nomination, {
				guildId: nomination.guildId,
				channelId: nomination.channelId,
				messageId: "wrong-message"
			})
		).toBe(false)
	})

	it("rejects malformed or replayed component ids", () => {
		expect(parseNominationId(42)).toBe(42)
		expect(parseNominationId("42")).toBe(42)
		expect(parseNominationId("42:choice=approve")).toBeNull()
		expect(parseNominationId("not-a-number")).toBeNull()
	})
})
