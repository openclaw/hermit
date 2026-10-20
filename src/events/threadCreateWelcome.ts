import {
	Container,
	type Client,
	type ListenerEventData,
	TextDisplay,
	ThreadCreateListener
} from "@buape/carbon"
import { upsertTrackedThread } from "../utils/trackedThreads.js"
import { postWorkerEvent } from "../utils/workerEvent.js"

const defaultWelcomeTemplate =
	`Welcome to the help channel!

<@1457407575476801641> cannot see your system; it only knows what you tell it. The more details you include, the easier it is to help. If you haven’t included it yet, please consider sending:
- What you’re trying to do (goal / expected behaviour)
- What happened instead (exact error message)
- What you ran or clicked (commands, config snippet, etc.)
- Your environment (OS, install method, versions)
- Relevant redacted logs (the smallest useful snippet; never share tokens or secrets)

Posts like “it doesn’t work” without details are very hard to debug.

Keep this thread focused on one issue so answers stay useful. Discord remains a place for social conversation and collaboration.`

export default class ThreadCreateWelcome extends ThreadCreateListener {
	async handle(data: ListenerEventData[this["type"]], _client: Client) {
		const welcomeParentId = process.env.HELPER_THREAD_WELCOME_PARENT_ID?.trim()
		if (!welcomeParentId) {
			return
		}

		const thread = data.thread
		const parentId = thread.parentId

		if (thread.archived || !parentId || parentId !== welcomeParentId) {
			return
		}

		const configuredTemplate = process.env.HELPER_THREAD_WELCOME_TEMPLATE
		const template =
			configuredTemplate && configuredTemplate.trim().length > 0
				? configuredTemplate
				: defaultWelcomeTemplate
		const welcomeMessage = `${template}\n\n[Get support](https://community.openclaw.ai/) is the official OpenClaw support pathway for setup, usage questions, and troubleshooting. Find or create a relevant topic there, and redact tokens and secrets from logs.`

		const createdAt = thread.createTimestamp ?? new Date().toISOString()
		const initialMessageCount =
			thread.totalMessageSent ?? thread.messageCount ?? null

		const workerEventResult = await Promise.allSettled([
			postWorkerEvent({
				type: "thread_welcome_created",
				invokedBy: {
					id: null,
					username: null,
					globalName: null
				},
				context: {
					guildId: thread.guildId ?? null,
					channelId: parentId,
					threadId: thread.id,
					messageCount: initialMessageCount,
					parentId
				},
				data: {}
			}),
			upsertTrackedThread({
				threadId: thread.id,
				createdAt,
				lastChecked: null,
				solved: false,
				warningLevel: 0,
				closed: false,
				lastMessageCount: initialMessageCount
			})
		])

		for (const result of workerEventResult) {
			if (result.status === "rejected") {
				console.error("Failed to register tracked helper thread:", result.reason)
			}
		}

		try {
			await thread.send({
				components: [new Container([new TextDisplay(welcomeMessage)])]
			})
		} catch (error) {
			console.error("Failed to send thread welcome message:", error)
		}
	}
}
