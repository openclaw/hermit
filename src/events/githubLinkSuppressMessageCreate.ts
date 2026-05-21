import {
	MessageCreateListener,
	MessageFlags,
	Routes,
	type Client,
	type ListenerEventData
} from "@buape/carbon"

const githubUrlRegex = /https?:\/\/(?:www\.)?github\.com\/\S+/i

export default class GithubLinkSuppressMessageCreate extends MessageCreateListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		if (!data.channel_id || data.webhook_id || data.author.bot) {
			return
		}
		if (!githubUrlRegex.test(data.content)) {
			return
		}

		await client.rest.patch(Routes.channelMessage(data.channel_id, data.id), {
			body: { flags: (data.flags ?? 0) | MessageFlags.SuppressEmbeds }
		}).catch(() => null)
	}
}
