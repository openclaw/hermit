import type { CommandInteraction } from "@buape/carbon"

type ThreadStatsChannel = {
	id?: string
	messageCount?: number
	totalMessageSent?: number
}

type CommandWebhookPayload = {
	threadId: string | null
	messageCount: number | null
	time: string
	command: string
	invokedBy: {
		id: string | null
		username: string | null
		globalName: string | null
	}
}

export const sendCommandWebhook = async (
	interaction: CommandInteraction,
	command: string
) => {
	const workerUrl = process.env.HELPER_COMMAND_WEBHOOK_URL
	if (!workerUrl) {
		return
	}

	const channel = interaction.channel as ThreadStatsChannel | null
	const user = interaction.user
	const messageCount =
		channel?.totalMessageSent ?? channel?.messageCount ?? null
	const payload: CommandWebhookPayload = {
		threadId: channel?.id ?? null,
		messageCount,
		time: new Date().toISOString(),
		command,
		invokedBy: {
			id: user?.id ?? null,
			username: user?.username ?? null,
			globalName: user?.globalName ?? null
		}
	}

	try {
		await fetch(workerUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json"
			},
			body: JSON.stringify(payload)
		})
	} catch {
		// Ignore webhook delivery failures so command execution can continue.
	}
}
