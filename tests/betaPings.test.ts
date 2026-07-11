import { describe, expect, it, spyOn } from "bun:test"
import {
	ApplicationIntegrationType,
	type ButtonInteraction,
	type CommandInteraction,
	InteractionContextType,
	Permission,
	serializePayload
} from "@buape/carbon"
import BetaPingsCommand from "../src/commands/betaPings.js"
import {
	buildBetaPingsContainer,
	handleBetaPingsToggle
} from "../src/components/betaPingsButton.js"
import { betaPingsConfig } from "../src/config/betaPings.js"
import {
	isBetaPingsGuild,
	toggleBetaPingsRole,
	type BetaPingsMember
} from "../src/services/betaPings.js"

const flattenComponents = (component: unknown): Record<string, unknown>[] => {
	if (!component || typeof component !== "object") {
		return []
	}

	const record = component as Record<string, unknown>
	const children = Array.isArray(record.components)
		? record.components.flatMap(flattenComponents)
		: []
	const accessory = record.accessory
		? flattenComponents(record.accessory)
		: []

	return [record, ...children, ...accessory]
}

const payloadText = (payload: unknown) =>
	flattenComponents(serializePayload(payload))
		.map((component) => component.content)
		.filter((content): content is string => typeof content === "string")
		.join("\n")

const makeInteraction = (options: {
	guildId?: string
	channelId?: string
	userId?: string | undefined
} = {}) => {
	const guildId = options.guildId ?? betaPingsConfig.guildId
	const channelId = options.channelId ?? "channel-1"
	const userId = "userId" in options ? options.userId : "user-1"
	const replies: unknown[] = []
	const interaction = {
		rawData: {
			guild_id: guildId,
			channel_id: channelId
		},
		userId,
		reply: async (payload: unknown) => {
			replies.push(payload)
		}
	} as unknown as ButtonInteraction

	return { interaction, replies }
}

const makeMember = (roleIds: string[] = []) => {
	const added: Array<[string, string | undefined]> = []
	const removed: Array<[string, string | undefined]> = []
	const member: BetaPingsMember = {
		roles: roleIds.map((id) => ({ id })),
		addRole: async (roleId, reason) => {
			added.push([roleId, reason])
		},
		removeRole: async (roleId, reason) => {
			removed.push([roleId, reason])
		}
	}

	return { member, added, removed }
}

describe("Beta Pings post", () => {
	it("renders a compact Carbon post with one toggle button", () => {
		const payload = serializePayload({
			components: [buildBetaPingsContainer()]
		})
		const components = flattenComponents(payload)
		const text = components
			.map((component) => component.content)
			.filter((content): content is string => typeof content === "string")
			.join("\n")
		const buttons = components.filter((component) => component.type === 2)

		expect(text).toContain(`### ${betaPingsConfig.copy.title}`)
		expect(text).toContain(betaPingsConfig.copy.description)
		expect(buttons).toEqual([
			expect.objectContaining({
				custom_id: "beta-pings-toggle",
				label: betaPingsConfig.copy.buttonLabel
			})
		])
	})

	it("keeps the publisher command guild-only and staff-restricted", () => {
		const command = new BetaPingsCommand()

		expect(command.contexts).toEqual([InteractionContextType.Guild])
		expect(command.integrationTypes).toEqual([
			ApplicationIntegrationType.GuildInstall
		])
		expect(command.guildIds).toEqual([betaPingsConfig.guildId])
		expect(command.permission).toBe(Permission.ManageRoles)
	})

	it("publishes in any channel in the configured guild", async () => {
		const replies: unknown[] = []
		const interaction = {
			rawData: {
				guild_id: betaPingsConfig.guildId,
				channel_id: "another-channel"
			},
			reply: async (payload: unknown) => {
				replies.push(payload)
			}
		} as unknown as CommandInteraction

		await new BetaPingsCommand().run(interaction)

		expect(payloadText(replies[0])).toContain(betaPingsConfig.copy.title)
	})
})

describe("Beta Pings role toggle", () => {
	it("binds the control to the configured guild", () => {
		expect(isBetaPingsGuild(betaPingsConfig.guildId)).toBe(true)
		expect(isBetaPingsGuild("wrong-guild")).toBe(false)
	})

	it("adds Beta Pings when the member does not have it", async () => {
		const { member, added, removed } = makeMember()

		expect(await toggleBetaPingsRole(member)).toEqual({ enabled: true })
		expect(added).toEqual([
			[betaPingsConfig.roleId, "Self-service Beta Pings toggle"]
		])
		expect(removed).toEqual([])
	})

	it("removes Beta Pings when the member already has it", async () => {
		const { member, added, removed } = makeMember([
			betaPingsConfig.roleId
		])

		expect(await toggleBetaPingsRole(member)).toEqual({ enabled: false })
		expect(added).toEqual([])
		expect(removed).toEqual([
			[betaPingsConfig.roleId, "Self-service Beta Pings toggle"]
		])
	})

	it("allows interactions in any channel in the configured guild", async () => {
		const { interaction, replies } = makeInteraction({
			channelId: "another-channel"
		})
		const { member, added } = makeMember()

		await handleBetaPingsToggle(interaction, async () => member)

		expect(added).toEqual([
			[betaPingsConfig.roleId, "Self-service Beta Pings toggle"]
		])
		expect(payloadText(replies[0])).toContain(
			betaPingsConfig.copy.enabled
		)
	})

	it("rejects interactions outside the configured guild", async () => {
		const { interaction, replies } = makeInteraction({
			guildId: "wrong-guild"
		})
		let fetched = false

		await handleBetaPingsToggle(interaction, async () => {
			fetched = true
			return makeMember().member
		})

		expect(fetched).toBe(false)
		expect(payloadText(replies[0])).toContain(
			betaPingsConfig.copy.wrongGuild
		)
	})

	it("handles a missing interaction user without fetching a member", async () => {
		const { interaction, replies } = makeInteraction({
			userId: undefined
		})
		let fetched = false

		await handleBetaPingsToggle(interaction, async () => {
			fetched = true
			return makeMember().member
		})

		expect(fetched).toBe(false)
		expect(payloadText(replies[0])).toContain(
			betaPingsConfig.copy.userNotFound
		)
	})

	it("reports Discord API failures privately", async () => {
		const { interaction, replies } = makeInteraction()
		const consoleError = spyOn(console, "error").mockImplementation(
			() => {}
		)

		try {
			await handleBetaPingsToggle(interaction, async () => {
				throw new Error("Discord unavailable")
			})
		} finally {
			consoleError.mockRestore()
		}

		expect(payloadText(replies[0])).toContain(
			betaPingsConfig.copy.updateFailed
		)
	})
})
