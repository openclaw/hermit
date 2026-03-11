import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	CommandWithSubcommands,
	Container,
	type CommandInteraction,
	type GuildThreadChannel,
	InteractionContextType,
	TextDisplay
} from "@buape/carbon"
import BaseCommand from "./base.js"
import { sendWorkerEvent } from "../utils/workerEvent.js"

const warnNewThreadMessage =
	"This thread is getting very long and answers may not be accurate due to the large context. Please start a new thread for any different problems/topics. <@1457407575476801641> please sum up the answer to the initial message and the conversation briefly. This thread will be closed soon."
const closeThreadMessage =
	"This thread has gotten very long and spanned multiple topics which will make future reading difficult. This thread is now closed. Please create a new thread for any new topics."

const isThreadLikeChannel = (
	channel: CommandInteraction["channel"]
): channel is GuildThreadChannel<any> =>
	Boolean(
		channel &&
			typeof (channel as GuildThreadChannel<any>).archive === "function" &&
			typeof (channel as GuildThreadChannel<any>).lock === "function"
	)

class HelperWarnNewThreadCommand extends BaseCommand {
	name = "warn-new-thread"
	description = "Warn that the thread should be split into a new thread"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			name: "user",
			description: "User to mention",
			type: ApplicationCommandOptionType.User as const
		}
	]

	async run(interaction: CommandInteraction) {
		await sendWorkerEvent(interaction, "helper_command", {
			command: "/helper warn-new-thread"
		})
		const user = interaction.options.getUser("user")
		const message = user
			? `${this.formatMention(user.id)}${this.lowercaseFirstLetter(warnNewThreadMessage)}`
			: warnNewThreadMessage

		await interaction.reply({
			components: [new Container([new TextDisplay(message)])]
		})
	}

	private formatMention(userId: string) {
		return `<@${userId}>, `
	}

	private lowercaseFirstLetter(message: string) {
		const match = message.match(/[A-Za-z]/)
		if (match?.index === undefined) {
			return message
		}

		const index = match.index
		return `${message.slice(0, index)}${message.charAt(index).toLowerCase()}${message.slice(index + 1)}`
	}
}

class HelperCloseThreadCommand extends BaseCommand {
	name = "close-thread"
	description = "Post a close notice and archive/lock the current thread"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]

	async run(interaction: CommandInteraction) {
		await closeHelperThread(interaction, "/helper close-thread")
	}
}

class HelperCloseCommand extends BaseCommand {
	name = "close"
	description = "Close and lock the current thread"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]

	async run(interaction: CommandInteraction) {
		await closeHelperThread(interaction, "/helper close")
	}
}

const closeHelperThread = async (
	interaction: CommandInteraction,
	commandName: string
) => {
		const channel = interaction.channel
		await sendWorkerEvent(interaction, "helper_command", {
			command: commandName
		})

		if (!isThreadLikeChannel(channel)) {
			await interaction.reply({
				components: [
					new Container([
						new TextDisplay("This command can only be used inside a thread.")
					])
				]
			})
			return
		}

		await interaction.reply({
			components: [new Container([new TextDisplay(closeThreadMessage)])]
		})

		await channel.archive()
		await channel.lock()
}

export default class HelperRootCommand extends CommandWithSubcommands {
	name = "helper"
	description = "Helper-channel moderation utilities"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	subcommands = [
		new HelperWarnNewThreadCommand(),
		new HelperCloseCommand(),
		new HelperCloseThreadCommand()
	]
}
