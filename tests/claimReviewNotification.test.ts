import { type Client, MessageFlags, serializePayload } from "@buape/carbon"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { formSettings } from "../forms.config.js"
import * as claimRequests from "../src/data/claimRequests.js"
import { getRuntimeEnv, setRuntimeEnv } from "../src/runtime/env.js"
import { createClaimUrl, registerClaimRoutes } from "../src/server/claimServer.js"

const moderationPingRoleId = "1546936406272778271"
const communityTeamRoleId = "1477360613125787678"
const reviewChannelId = "1503772785120383057"

const submitClaim = async () => {
	const messages: ReturnType<typeof serializePayload>[] = []
	const fetchedChannels: string[] = []
	const client = {
		routes: [],
		fetchChannel: async (channelId: string) => {
			fetchedChannels.push(channelId)
			return {
				send: async (payload: Parameters<typeof serializePayload>[0]) => {
					messages.push(serializePayload(payload))
					return { id: "review-message-1", startThread: async () => null }
				}
			}
		}
	} as unknown as Client
	registerClaimRoutes(client)
	const callback = client.routes.find((route) => route.path === "/claim/callback")!
	const claimUrl = new URL(await createClaimUrl("applicant-1", "guild-1"))
	const callbackUrl = new URL("/claim/callback", claimUrl)
	callbackUrl.searchParams.set("state", claimUrl.searchParams.get("state")!)
	callbackUrl.searchParams.set("code", "test-code")
	const response = await callback.handler(new Request(callbackUrl))
	expect(response.status).toBe(200)
	expect(await response.text()).toContain("Claim submitted")
	expect(fetchedChannels).toEqual([reviewChannelId])
	expect(messages).toHaveLength(1)
	return messages[0]
}

describe("claim review notification routing", () => {
	let previousEnv: ReturnType<typeof getRuntimeEnv>
	let restoreMocks: Array<() => void>

	beforeEach(() => {
		try { previousEnv = getRuntimeEnv() } catch { previousEnv = {} as Env }
		setRuntimeEnv({
			BASE_URL: "https://hermit.example",
			DEPLOY_SECRET: "test-only-secret",
			DISCORD_CLIENT_ID: "test-client"
		} as Env)
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = String(input)
			if (url === "https://discord.com/api/v10/oauth2/token" && init?.method === "POST") {
				return Response.json({ access_token: "test-access-token" })
			}
			if (url === "https://discord.com/api/v10/users/@me") {
				return Response.json({ id: "applicant-1" })
			}
			if (url === "https://discord.com/api/v10/users/@me/connections") {
				return Response.json([{ type: "github", name: "applicant", verified: true }])
			}
			if (url.startsWith("https://api.github.com/search/issues?")) {
				return Response.json({ total_count: 1, items: [] })
			}
			throw new Error(`Unexpected request (including role grants): ${init?.method ?? "GET"} ${url}`)
		})
		const getSpy = spyOn(claimRequests, "getClaimRequest").mockResolvedValue(null)
		const createSpy = spyOn(claimRequests, "createClaimRequest").mockResolvedValue({
			created: true,
			claimRequest: { id: 1 } as NonNullable<Awaited<ReturnType<typeof claimRequests.getClaimRequest>>>
		})
		const markSpy = spyOn(claimRequests, "markClaimRequestSubmitted").mockResolvedValue(undefined)
		restoreMocks = [fetchSpy, getSpy, createSpy, markSpy].map((mock) => () => mock.mockRestore())
	})

	afterEach(() => {
		for (const restore of restoreMocks) restore()
		setRuntimeEnv(previousEnv)
	})

	it("displays Community Moderation Pings, not Community Team, in the submitted Carbon card", async () => {
		const message = await submitClaim()
		expect(message.flags).toBe(MessageFlags.IsComponentsV2)
		expect(JSON.stringify(message.components)).toContain(`<@&${moderationPingRoleId}>`)
		expect(JSON.stringify(message.components)).not.toContain(`<@&${communityTeamRoleId}>`)
	})

	it("allows only the moderation role ping and suppresses applicant mentions", async () => {
		const message = await submitClaim()
		expect(message.allowed_mentions).toEqual({ roles: [moderationPingRoleId], users: [] })
	})

	it("retains Community Team review configuration and the existing claim controls", async () => {
		const message = await submitClaim()
		expect(formSettings.reviewRoleId).toBe(communityTeamRoleId)
		expect(formSettings.reviewPingRoleId).toBe(moderationPingRoleId)
		expect(formSettings.reviewRoleId).not.toBe(formSettings.reviewPingRoleId)
		const components = JSON.stringify(message.components)
		expect(components).toContain("claim-review-accept:userId=sapplicant-1;guildId=sguild-1")
		expect(components).toContain("claim-review-reject:userId=sapplicant-1;guildId=sguild-1")
	})
})
