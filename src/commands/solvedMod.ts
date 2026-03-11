import {
	ApplicationCommandType,
	ApplicationIntegrationType,
	Container,
	type CommandInteraction,
	GuildThreadChannel,
	InteractionContextType,
	Permission,
	Routes,
	TextDisplay
} from "@buape/carbon"
import BaseCommand from "./base.js"
import { sendWorkerEvent } from "../utils/workerEvent.js"

const answerOverflowBaseUrl = (
	process.env.ANSWER_OVERFLOW_API_BASE_URL ?? "https://www.answeroverflow.com"
).replace(/\/+$/, "")

type MarkSolutionResponse = {
	success?: boolean
}

type MarkSolutionWorkerEvent = {
	command: string
	threadId: string | null
	questionMessageId: string
	solutionMessageId: string
	solutionAuthorId: string | null
	aoRequest: {
		url: string
		success: boolean
		status: number | null
	}
	discordActions: {
		reactionAdded: boolean
		threadArchived: boolean
		threadLocked: boolean
	}
	error: string | null
}

const isThreadLikeChannel = (
	channel: CommandInteraction["channel"]
): channel is GuildThreadChannel<any> =>
	Boolean(
		channel &&
			typeof (channel as GuildThreadChannel<any>).archive === "function" &&
			typeof (channel as GuildThreadChannel<any>).lock === "function"
	)

const addCheckmarkReaction = async (interaction: CommandInteraction) => {
	const message = interaction.targetMessage
	if (!message) {
		return
	}

	await interaction.client.rest.put(
		Routes.channelMessageOwnReaction(
			message.channelId,
			message.id,
			encodeURIComponent("✅")
		)
	)
}

export default class SolvedModCommand extends BaseCommand {
	name = "Solved (Mod)"
	type = ApplicationCommandType.Message
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	permission = [Permission.ManageMessages, Permission.ManageThreads]

	async run(interaction: CommandInteraction) {
		const targetMessage = interaction.targetMessage
		const channel = interaction.channel
		const apiKey = process.env.ANSWER_OVERFLOW_API_KEY

		if (!targetMessage) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay("This action requires a target message.")
					], { accentColor: "#f85149" })
				]
			})
			return
		}

		if (!isThreadLikeChannel(channel)) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay("This action can only be used inside a thread.")
					], { accentColor: "#f85149" })
				]
			})
			return
		}

		if (!apiKey) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay("ANSWER_OVERFLOW_API_KEY is not configured.")
					], { accentColor: "#f85149" })
				]
			})
			return
		}

		const questionMessageId = channel.id
		const solutionMessageId = targetMessage.id
		const aoUrl = `${answerOverflowBaseUrl}/api/v1/messages/${questionMessageId}`

		let aoSuccess = false
		let aoStatus: number | null = null
		let errorMessage: string | null = null
		let reactionAdded = false
		let threadArchived = false
		let threadLocked = false

		try {
			const response = await fetch(aoUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": apiKey
				},
				body: JSON.stringify({
					solutionId: solutionMessageId
				})
			})

			aoStatus = response.status
			if (response.ok) {
				const result = (await response.json()) as MarkSolutionResponse
				aoSuccess = result.success === true
			}

			if (!aoSuccess) {
				errorMessage = response.ok
					? "Answer Overflow did not confirm the solution update."
					: `Answer Overflow returned ${response.status}.`
			}
		} catch (error) {
			errorMessage =
				error instanceof Error
					? error.message
					: "Could not reach Answer Overflow."
		}

		if (!aoSuccess) {
			await sendWorkerEvent<MarkSolutionWorkerEvent>(
				interaction,
				"mark_solution",
				{
					command: "Solved (Mod)",
					threadId: channel.id,
					questionMessageId,
					solutionMessageId,
					solutionAuthorId: targetMessage.author?.id ?? null,
					aoRequest: {
						url: aoUrl,
						success: false,
						status: aoStatus
					},
					discordActions: {
						reactionAdded,
						threadArchived,
						threadLocked
					},
					error: errorMessage
				}
			)

			await interaction.reply({
				components: [
					new Container([
						new TextDisplay(
							errorMessage ?? "Failed to mark this thread as solved."
						)
					], { accentColor: "#f85149" })
				]
			})
			return
		}

		try {
			await addCheckmarkReaction(interaction)
			reactionAdded = true
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Failed to add the checkmark reaction."
		}

		try {
			await channel.archive()
			threadArchived = true
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Failed to archive the thread."
		}

		try {
			await channel.lock()
			threadLocked = true
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Failed to lock the thread."
		}

		await sendWorkerEvent<MarkSolutionWorkerEvent>(interaction, "mark_solution", {
			command: "Solved (Mod)",
			threadId: channel.id,
			questionMessageId,
			solutionMessageId,
			solutionAuthorId: targetMessage.author?.id ?? null,
			aoRequest: {
				url: aoUrl,
				success: true,
				status: aoStatus
			},
			discordActions: {
				reactionAdded,
				threadArchived,
				threadLocked
			},
			error: errorMessage
		})

		const resultMessage =
			errorMessage === null
				? "Marked the thread as solved, added a checkmark, and closed the thread."
				: "Marked the thread as solved in Answer Overflow, but some Discord cleanup steps failed."

		await interaction.reply({
			components: [new Container([new TextDisplay(resultMessage)])]
		})
	}
}
