import {
	ApplicationIntegrationType,
	InteractionContextType,
	ApplicationCommandOptionType,
	type CommandInteraction,
} from "@buape/carbon"
import BaseCommand from "./base.js"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { isTeamLead } from "../lib/permissions.js"
import { dmUserPayload } from "../lib/notifications.js"
import { writeAuditLog } from "../lib/auditLogger.js"
import { TEAM_DISPLAY_NAMES } from "../types/onboarding.js"
import type { TeamSlug } from "../types/onboarding.js"

export default class OnboardStartCommand extends BaseCommand {
	name = "onboard-start"
	description = "Initiate the onboarding process for a new staff candidate"
	ephemeral = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]

	options = [
		{
			name: "user",
			description: "The candidate to onboard",
			type: ApplicationCommandOptionType.User as const,
			required: true,
		},
		{
			name: "team",
			description: "Which team to apply for",
			type: ApplicationCommandOptionType.String as const,
			required: true,
			choices: [
				{ name: "Discord Mod", value: "discord_mod" },
				{ name: "VC Mod", value: "vc_mod" },
				{ name: "Helper", value: "helper" },
				{ name: "Configurator", value: "configurator" },
			],
		},
	]

	async run(interaction: CommandInteraction) {
		const guild = interaction.guild
		if (!guild) {
			await interaction.reply({
				content: "This command can only be used in a server.",
				flags: 64,
			})
			return
		}

		const callerId = interaction.user?.id
		if (!callerId) {
			await interaction.reply({
				content: "Could not determine your user ID.",
				flags: 64,
			})
			return
		}

		const team = interaction.options.getString("team", true) as TeamSlug
		const targetUser = interaction.options.getUser("user", true)
		const targetUserId = targetUser.id

		// 1. Validate: check caller is Team Lead for the specified team
		const callerIsLead = await isTeamLead(callerId, team)
		if (!callerIsLead) {
			await interaction.reply({
				content: `You must be the Team Lead for **${TEAM_DISPLAY_NAMES[team]}** to initiate onboarding.`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 2. Validate: check target user is in the guild via REST
		try {
			await interaction.client.rest.get(
				`/guilds/${guild.id}/members/${targetUserId}`,
			)
		} catch {
			await interaction.reply({
				content: `<@${targetUserId}> is not in this server.`,
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 3. Create a DB record in applications table with status FORM_SENT
		const inserted = await db
			.insert(applications)
			.values({
				userId: targetUserId,
				guildId: guild.id,
				team: team,
				initiatedBy: callerId,
				status: "FORM_SENT",
			})
			.returning({ id: applications.id })

		const applicationId = inserted[0]?.id
		if (!applicationId) {
			await interaction.reply({
				content: "Failed to create application record. Please try again.",
				flags: 64,
			})
			return
		}

		const teamDisplayName = TEAM_DISPLAY_NAMES[team]

		// 4. DM the target user with a button to open the application form
		await dmUserPayload(interaction.client, targetUserId, {
			content: `You've been invited to apply for the **${teamDisplayName}** team at OpenClaw! Click the button below to open the application form.\n\n_This invitation was sent by a Team Lead. Complete your application at your convenience._`,
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 1,
							label: "Open Application Form",
							custom_id: `onboarding-open-form:applicationId=${applicationId}`,
						},
					],
				},
			],
		})

		// Write audit log
		await writeAuditLog({
			actorId: callerId,
			action: "ONBOARD_START",
			applicationId,
			details: {
				userId: targetUserId,
				team,
				guildId: guild.id,
			},
		})

		// 5. Reply to the caller (ephemeral) confirming the invite was sent
		await interaction.reply({
			content: `Onboarding invitation sent to <@${targetUserId}> for the **${teamDisplayName}** team. They'll receive a DM with a form link.`,
			flags: 64,
			allowedMentions: { parse: [] },
		})
	}
}
