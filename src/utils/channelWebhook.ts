import {
	type Client,
	type MessagePayloadObject,
	Routes,
	serializePayload,
	Webhook
} from "@buape/carbon"

const webhookCache = new Map<string, { webhook: Webhook; fetchedAt: number }>()
const pendingWebhooks = new Map<string, Promise<Webhook>>()
const webhookCacheTtlMs = 15 * 60 * 1000

const cleanupWebhookCache = () => {
	const now = Date.now()
	for (const [channelId, entry] of webhookCache.entries()) {
		if (now - entry.fetchedAt > webhookCacheTtlMs) {
			webhookCache.delete(channelId)
		}
	}
}

const fetchChannelWebhooks = async (client: Client, channelId: string) => {
	return (await client.rest.get(Routes.channelWebhooks(channelId))) as {
		id: string
		token?: string
	}[]
}

const createChannelWebhook = async (client: Client, channelId: string, name: string) => {
	return (await client.rest.post(Routes.channelWebhooks(channelId), {
		body: { name }
	})) as { id: string; token?: string }
}

export const getOrCreateChannelWebhook = async (
	client: Client,
	channelId: string,
	name = "Hermit Repost"
) => {
	cleanupWebhookCache()
	const cached = webhookCache.get(channelId)
	if (cached) {
		return cached.webhook
	}

	const pending = pendingWebhooks.get(channelId)
	if (pending) {
		return pending
	}

	const request = (async () => {
		const existingWebhooks = await fetchChannelWebhooks(client, channelId)
		const usableWebhook = existingWebhooks.find((webhook) => webhook.token)
		const webhookData = usableWebhook ?? (await createChannelWebhook(client, channelId, name))

		if (!webhookData.token) {
			throw new Error("Webhook token missing for channel repost")
		}

		const webhook = new Webhook({ id: webhookData.id, token: webhookData.token })
		webhookCache.set(channelId, { webhook, fetchedAt: Date.now() })
		return webhook
	})()
	pendingWebhooks.set(channelId, request)
	try {
		return await request
	} finally {
		pendingWebhooks.delete(channelId)
	}
}

export const sendWebhookMessage = async (
	webhook: Webhook,
	payload: MessagePayloadObject & { username?: string; avatar_url?: string }
) => {
	const serialized = serializePayload({
		...payload,
		allowedMentions: { parse: [] }
	})
	await webhook.rest.post(webhook.urlWithOptions({ wait: true }), {
		body: serialized
	})
}
