import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	type CommandInteraction,
	CommandWithSubcommands,
	Container,
	InteractionContextType,
	LinkButton,
	Row,
	Routes,
	Separator,
	TextDisplay,
	type APIMessage
} from "@buape/carbon"
import BaseCommand from "./base.js"
import { WhoisDeleteButton } from "../components/whoisDeleteButton.js"

const maintainerRoleId = "1457214688806047756"
const whoisGuildId = "1456350064065904867"
const whoisChannelId = "1482394321100476426"

const hasMaintainerRole = (interaction: CommandInteraction) =>
	interaction.member?.roles.some((role) => role.id === maintainerRoleId) ?? false

const maintainerRolePreCheck = async (interaction: CommandInteraction) => {
	if (hasMaintainerRole(interaction)) {
		return true
	}

	await interaction.reply({
		components: [
			new Container(
				[
					new TextDisplay("### Maintainer role required"),
					new TextDisplay(`You need <@&${maintainerRoleId}> to use this command.`)
				],
				{ accentColor: "#f85149" }
			)
		],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
	return false
}

class JumpToIntroductionButton extends LinkButton {
	label = "Jump to post"
	url: string

	constructor(url: string) {
		super()
		this.url = url
	}
}

export default class MaintainerCommand extends CommandWithSubcommands {
	name = "maintainer"
	description = "Maintainer commands"
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	ephemeral = true
	subcommands = [new MaintainerWhois()]
}

export class MaintainerWhois extends BaseCommand {
	name = "whois"
	description = "Find a user's introduction post"
	ephemeral = (interaction: CommandInteraction) => !hasMaintainerRole(interaction)
	preCheck = maintainerRolePreCheck

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to find",
			required: true
		}
	]

	async run(interaction: CommandInteraction) {
		const user = interaction.options.getUser("user", true)
		let before: string | undefined

		for (let page = 0; page < 30; page += 1) {
			const messages = (await interaction.client.rest.get(
				Routes.channelMessages(whoisChannelId),
				before ? { limit: 100, before } : { limit: 100 }
			)) as APIMessage[]

			const match = messages.find((message) => message.author.id === user.id)
			if (match) {
				const postUrl = `https://discord.com/channels/${whoisGuildId}/${whoisChannelId}/${match.id}`
				const content = match.content.trim() || "No text content."
				const snippet = content.length > 1000 ? `${content.slice(0, 999)}…` : content

				await interaction.reply({
					components: [
						new Container([
							new TextDisplay(`## <@${user.id}>'s introduction post\n\n${snippet}`),
							new Separator({ divider: true, spacing: "small" }),
							new Row([
								new JumpToIntroductionButton(postUrl),
								new WhoisDeleteButton(interaction.user?.id ?? interaction.userId)
							])
						])
					],
					allowedMentions: { parse: [] }
				})
				return
			}

			if (messages.length < 100) {
				break
			}
			before = messages.at(-1)?.id
		}

		await interaction.reply({
			components: [new Container([new TextDisplay(`No introduction post by <@${user.id}> was found in <#${whoisChannelId}>.`)])],
			allowedMentions: { parse: [] }
		})
	}
}
