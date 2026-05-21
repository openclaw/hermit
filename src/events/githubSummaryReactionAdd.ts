import {
	MessageReactionAddListener,
	type Client,
	type ListenerEventData
} from "@buape/carbon"
import {
	buildGitHubSummaryContainer,
	fetchGitHubSummaryData,
	parseGitHubIssueUrls
} from "../utils/githubSummary.js"

const summaryEmojiId = "1478966151743672563"
const debugChannelId = "1506880591340113990"

const formatError = (error: unknown) => {
	if (error instanceof Error) {
		return `${error.name}: ${error.message || "<empty>"}`
	}
	try {
		return JSON.stringify(error) || String(error)
	} catch {
		return String(error)
	}
}

const sendDebugLog = async (client: Client, message: string) => {
	const channel = await client.fetchChannel(debugChannelId).catch(() => null)
	if (channel && "send" in channel) {
		await channel.send(message).catch(() => null)
	}
}

export default class GithubSummaryReactionAdd extends MessageReactionAddListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		try {
			if (data.user.bot) {
				return
			}
			if (data.emoji.id !== summaryEmojiId) {
				await sendDebugLog(client, `Ignored reaction ${data.emoji.name ?? "unknown"}:${data.emoji.id ?? "no-id"} on ${data.channel_id}/${data.message_id}`)
				return
			}

			await sendDebugLog(client, `GitHub summary reaction by <@${data.user.id}> on https://discord.com/channels/${data.guild_id ?? "@me"}/${data.channel_id}/${data.message_id}`)

			const message = data.message.partial
				? await data.message.fetch().catch((error: unknown) => {
					void sendDebugLog(client, `Failed to fetch reacted message ${data.channel_id}/${data.message_id}: ${formatError(error)}`)
					return null
				})
				: data.message
			if (!message) {
				return
			}

			const source = [
				message.content,
				...(message.embeds ?? []).flatMap((embed: { url?: string; title?: string; description?: string }) => [
					embed.url,
					embed.title,
					embed.description
				])
			]
				.filter(Boolean)
				.join("\n")
			const matches = parseGitHubIssueUrls(source)
			if (matches.length === 0) {
				await sendDebugLog(client, `No GitHub links found for reacted message ${data.channel_id}/${data.message_id}`)
				return
			}
			await sendDebugLog(client, `Found ${matches.length} GitHub link(s): ${matches.map((match) => `${match.owner}/${match.repo}#${match.number}`).join(", ")}`)

			const summaries = (await Promise.all(
				matches.map(async (match) => {
					try {
						return await fetchGitHubSummaryData(match.owner, match.repo, match.number)
					} catch (error) {
						await sendDebugLog(client, `Failed to fetch GitHub summary ${match.owner}/${match.repo}#${match.number}: ${formatError(error)}`)
						return null
					}
				})
			)).filter((summary) => summary !== null)
			if (summaries.length === 0) {
				await sendDebugLog(client, `No GitHub summaries fetched for reacted message ${data.channel_id}/${data.message_id}`)
				return
			}

			const channel = await client.fetchChannel(data.channel_id).catch((error: unknown) => {
				void sendDebugLog(client, `Failed to fetch target channel ${data.channel_id}: ${formatError(error)}`)
				return null
			})
			if (!channel || !("send" in channel)) {
				await sendDebugLog(client, `Could not fetch/send in channel ${data.channel_id}`)
				return
			}

			let sent = 0
			for (const summary of summaries) {
				try {
					await channel.send({
						components: [buildGitHubSummaryContainer(summary)]
					})
					sent += 1
				} catch (error) {
					await sendDebugLog(client, `Failed to send GitHub summary ${summary.repoName}#${summary.number}: ${formatError(error)}`)
				}
			}
			await sendDebugLog(client, `Sent ${sent}/${summaries.length} GitHub summary container(s) in <#${data.channel_id}>`)
		} catch (error) {
			await sendDebugLog(client, `Unhandled reaction summary error for ${data.channel_id}/${data.message_id}: ${formatError(error)}`)
		}
	}
}
