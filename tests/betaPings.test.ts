import { describe, expect, it, spyOn } from "bun:test"
import {
	ApplicationIntegrationType,
	type ButtonInteraction,
	type CommandInteraction,
	InteractionContextType,
	Permission,
	serializePayload
} from "@buape/carbon"
import BetaCommand from "../src/commands/beta.js"
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


describe("public /beta command", () => {
	const makeCommandInteraction = (member: BetaPingsMember, options: {
		guildId?: string | null
		userId?: string | null
		fetchError?: boolean
	} = {}) => {
		const replies: unknown[] = []
		const fetched: Array<[string, string]> = []
		const interaction = {
			rawData: { guild_id: options.guildId === null ? undefined : options.guildId ?? betaPingsConfig.guildId },
			userId: options.userId === null ? undefined : options.userId ?? "caller",
			// Deliberately stale interaction member; the fresh member must win.
			member: { roles: [{ id: "unrelated-role" }] },
			client: { fetchMember: async (guildId: string, userId: string) => {
				fetched.push([guildId, userId])
				if (options.fetchError) throw new Error("Discord unavailable")
				return member
			} },
			reply: async (payload: unknown) => { replies.push(payload) }
		} as unknown as CommandInteraction
		return { interaction, replies, fetched }
	}

	it("is a public, zero-option, guild-installed private deferred command", () => {
		const command = new BetaCommand()
		expect(command.name).toBe("beta")
		expect(command.permission).toBeUndefined()
		expect(command.serialize().default_member_permissions).toBeNull()
		expect(command.serialize().options ?? []).toEqual([])
		expect(command.contexts).toEqual([InteractionContextType.Guild])
		expect(command.integrationTypes).toEqual([ApplicationIntegrationType.GuildInstall])
		expect(command.guildIds).toEqual([betaPingsConfig.guildId])
		expect(command.defer).toBe(true)
		expect(command.ephemeral).toBe(true)
	})

	for (const enabled of [false, true]) {
		it("toggles only the caller's fresh membership " + (enabled ? "off" : "on"), async () => {
			const { member, added, removed } = makeMember(enabled ? [betaPingsConfig.roleId, "unrelated-role"] : ["unrelated-role"])
			const { interaction, replies, fetched } = makeCommandInteraction(member)
			await new BetaCommand().run(interaction)
			expect(fetched).toEqual([[betaPingsConfig.guildId, "caller"]])
			expect(added.map(([id]) => id)).toEqual(enabled ? [] : [betaPingsConfig.roleId])
			expect(removed.map(([id]) => id)).toEqual(enabled ? [betaPingsConfig.roleId] : [])
			expect(replies).toHaveLength(1)
			expect(payloadText(replies[0])).toContain(enabled ? betaPingsConfig.copy.disabled : betaPingsConfig.copy.enabled)
			expect(serializePayload(replies[0])).toMatchObject({ allowed_mentions: { parse: [] }, components: [{ type: 17, components: [{ type: 10 }] }] })
		})
	}

	it("uses the authenticated user rather than an interaction member or target", async () => {
		const { member } = makeMember()
		const { interaction, fetched } = makeCommandInteraction(member)
		Object.assign(interaction, { user: { id: "authenticated-caller" }, member: { id: "not-a-target" } })
		await new BetaCommand().run(interaction)
		expect(fetched).toEqual([[betaPingsConfig.guildId, "authenticated-caller"]])
	})

	for (const guildId of [null, "wrong-guild"]) {
		it("rejects an absent or wrong guild before fetching membership: " + guildId, async () => {
			const { member, added, removed } = makeMember()
			const { interaction, replies, fetched } = makeCommandInteraction(member, { guildId })
			await new BetaCommand().run(interaction)
			expect(fetched).toEqual([])
			expect([...added, ...removed]).toEqual([])
			expect(payloadText(replies[0])).toContain(betaPingsConfig.copy.wrongGuild)
		})
	}

	it("rejects missing caller identity without fetching or changing roles", async () => {
		const { member, added, removed } = makeMember()
		const { interaction, replies, fetched } = makeCommandInteraction(member, { userId: null })
		await new BetaCommand().run(interaction)
		expect(fetched).toEqual([])
		expect([...added, ...removed]).toEqual([])
		expect(payloadText(replies[0])).toContain(betaPingsConfig.copy.userNotFound)
	})

	for (const failure of ["fetch", "add", "remove"]) {
		it("reports a " + failure + " failure without claiming success", async () => {
			const { member } = makeMember(failure === "remove" ? [betaPingsConfig.roleId] : [])
			if (failure === "add") member.addRole = async () => { throw new Error("Forbidden") }
			if (failure === "remove") member.removeRole = async () => { throw new Error("Forbidden") }
			const { interaction, replies } = makeCommandInteraction(member, { fetchError: failure === "fetch" })
			const consoleError = spyOn(console, "error").mockImplementation(() => {})
			try { await new BetaCommand().run(interaction) } finally { consoleError.mockRestore() }
			expect(replies).toHaveLength(1)
			expect(payloadText(replies[0])).toContain(betaPingsConfig.copy.updateFailed)
		})
	}
})
