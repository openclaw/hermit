import { describe, expect, it, mock } from "bun:test"
import type { Client } from "@buape/carbon"
import { getOrCreateChannelWebhook } from "../src/utils/channelWebhook.js"

const webhookData = { id: "123", token: "synthetic-webhook-token" }
const makeClient = (get: () => Promise<unknown>, post = async () => webhookData) => {
	const rest = { get: mock(get), post: mock(post) }
	return { client: { rest } as unknown as Client, rest }
}

describe("channel webhook cache", () => {
	it("shares lookup and creation among simultaneous callers", async () => {
		const { client, rest } = makeClient(async () => [])
		const webhooks = await Promise.all(Array.from({ length: 20 }, () =>
			getOrCreateChannelWebhook(client, "concurrent-create")
		))
		expect(rest.get).toHaveBeenCalledTimes(1)
		expect(rest.post).toHaveBeenCalledTimes(1)
		expect(new Set(webhooks).size).toBe(1)
		expect(await getOrCreateChannelWebhook(client, "concurrent-create")).toBe(webhooks[0])
		expect(rest.get).toHaveBeenCalledTimes(1)
	})

	it("shares an existing webhook without creating another", async () => {
		const { client, rest } = makeClient(async () => [webhookData])
		const webhooks = await Promise.all([
			getOrCreateChannelWebhook(client, "concurrent-existing"),
			getOrCreateChannelWebhook(client, "concurrent-existing")
		])
		expect(rest.get).toHaveBeenCalledTimes(1)
		expect(rest.post).not.toHaveBeenCalled()
		expect(webhooks[0]).toBe(webhooks[1])
	})

	for (const stage of ["lookup", "create", "missing-token"] as const) {
		it(`releases failed ${stage} attempts so later events can retry`, async () => {
			let fail = true
			const { client, rest } = makeClient(async () => {
				if (fail && stage === "lookup") throw new Error("lookup unavailable")
				return []
			}, async () => {
				if (fail && stage === "create") throw new Error("create unavailable")
				return fail && stage === "missing-token" ? { id: "123", token: "" } : webhookData
			})
			const channel = `retry-${stage}`
			const results = await Promise.allSettled([
				getOrCreateChannelWebhook(client, channel),
				getOrCreateChannelWebhook(client, channel)
			])
			expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
			expect(rest.get).toHaveBeenCalledTimes(1)
			fail = false
			expect((await getOrCreateChannelWebhook(client, channel)).id).toBe(webhookData.id)
			expect(rest.get).toHaveBeenCalledTimes(2)
		})
	}

	it("does not block another channel behind a pending lookup", async () => {
		let release = (_: unknown[]) => {}
		const pending = new Promise<unknown[]>((resolve) => { release = resolve })
		const slow = makeClient(() => pending)
		const fast = makeClient(async () => [webhookData])
		const slowRequest = getOrCreateChannelWebhook(slow.client, "slow-channel")
		try {
			expect((await getOrCreateChannelWebhook(fast.client, "fast-channel")).id).toBe(webhookData.id)
			expect(slow.rest.post).not.toHaveBeenCalled()
		} finally {
			release([])
			await slowRequest
		}
	})
})
