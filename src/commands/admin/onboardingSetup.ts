import {
	ApplicationIntegrationType,
	Command,
	Container,
	type CommandInteraction,
	InteractionContextType,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { setGlobalConfig, setTeamConfig } from "../../lib/configStore.js"
import { TEAM_SLUGS, TEAM_DISPLAY_NAMES } from "../../types/onboarding.js"
import type { TeamSlug } from "../../types/onboarding.js"

type DiscordRole = {
	id: string
	name: string
	color: number
	managed: boolean
	position: number
}

// Role definitions: name → color (decimal)
const GLOBAL_ROLES: { name: string; color: number; key: "communityStaffRoleId" }[] = [
	{ name: "Community Staff", color: 0x5865f2, key: "communityStaffRoleId" },
]

const TEAM_ROLE_DEFS: {
	label: string
	nameTemplate: (displayName: string) => string
	color: number
	key: "trialRoleId" | "fullRoleId"
}[] = [
	{
		label: "trial",
		nameTemplate: (d) => `Trial ${d}`,
		color: 0xf0b132,
		key: "trialRoleId",
	},
	{
		label: "full",
		nameTemplate: (d) => d,
		color: 0x3fb950,
		key: "fullRoleId",
	},
]

async function getOrCreateRole(
	client: { rest: { get: (path: string) => Promise<unknown>; post: (path: string, opts: { body: unknown }) => Promise<unknown> } },
	guildId: string,
	existingRoles: DiscordRole[],
	name: string,
	color: number,
): Promise<{ role: DiscordRole; created: boolean }> {
	const existing = existingRoles.find(
		(r) => r.name.toLowerCase() === name.toLowerCase(),
	)
	if (existing) return { role: existing, created: false }

	const created = (await client.rest.post(`/guilds/${guildId}/roles`, {
		body: { name, color, hoist: false, mentionable: false },
	})) as DiscordRole

	return { role: created, created: true }
}

export default class OnboardingSetupCommand extends Command {
	name = "onboarding-setup"
	description =
		"Create required onboarding roles if missing and save their IDs to config"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = []

	async run(interaction: CommandInteraction) {
		const guildId = interaction.guild?.id
		if (!guildId) {
			await interaction.reply({ components: [new Container([new TextDisplay("Must be run in a server.")], { accentColor: "#f04747" })] })
			return
		}

		const existingRoles = (await interaction.client.rest.get(
			`/guilds/${guildId}/roles`,
		)) as DiscordRole[]

		const found: string[] = []
		const created: string[] = []

		// Global roles
		for (const def of GLOBAL_ROLES) {
			const result = await getOrCreateRole(
				interaction.client,
				guildId,
				existingRoles,
				def.name,
				def.color,
			)
			await setGlobalConfig({ [def.key]: result.role.id })
			const line = `<@&${result.role.id}> — \`${def.name}\``
			result.created ? created.push(line) : found.push(line)
		}

		// Per-team roles
		for (const team of TEAM_SLUGS) {
			const displayName = TEAM_DISPLAY_NAMES[team as TeamSlug]
			const teamUpdates: Partial<Record<"trialRoleId" | "fullRoleId", string>> = {}

			for (const def of TEAM_ROLE_DEFS) {
				const name = def.nameTemplate(displayName)
				const result = await getOrCreateRole(
					interaction.client,
					guildId,
					existingRoles,
					name,
					def.color,
				)
				teamUpdates[def.key] = result.role.id
				const line = `<@&${result.role.id}> — \`${name}\``
				result.created ? created.push(line) : found.push(line)
			}

			await setTeamConfig(team as TeamSlug, teamUpdates)
		}

		const lines: (TextDisplay | Separator)[] = [
			new TextDisplay("### Onboarding Setup Complete"),
			new Separator({ divider: true, spacing: "small" }),
		]

		if (found.length > 0) {
			lines.push(new TextDisplay(`**Already existed (${found.length}):**\n${found.join("\n")}`))
		}

		if (created.length > 0) {
			if (found.length > 0) lines.push(new Separator({ divider: false, spacing: "small" }))
			lines.push(new TextDisplay(`**Created (${created.length}):**\n${created.join("\n")}`))
		}

		lines.push(new Separator({ divider: true, spacing: "small" }))
		lines.push(new TextDisplay("Role IDs have been saved to config. Run `/onboarding-config get` and `/team-config get` to verify."))

		await interaction.reply({
			components: [new Container(lines, { accentColor: "#3fb950" })],
		})
	}
}
