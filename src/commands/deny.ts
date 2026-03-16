import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	InteractionContextType,
	type CommandInteraction,
	Container,
	Separator,
	TextDisplay,
} from "@buape/carbon"
import { and, eq } from "drizzle-orm"
import BaseCommand from "./base.js"
import { db } from "../db.js"
import { applications, trials } from "../db/schema.js"
import { TEAM_DISPLAY_NAMES, type TeamSlug } from "../types/onboarding.js"
import { getLeadTeams } from "../lib/permissions.js"
import { getTeamConfig, getGlobalConfig } from "../lib/configStore.js"
import { dmUser, postToModLog } from "../lib/notifications.js"
import { writeAuditLog } from "../lib/auditLogger.js"

export default class DenyCommand extends BaseCommand {
	name = "deny"
	description = "Deny a promotion after the team vote (lead final decision)"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The trial member to deny promotion",
			required: true,
		},
	]

	async run(interaction: CommandInteraction) {
		const callerId = interaction.user?.id
		const guildId = interaction.guild?.id

		if (!callerId || !guildId) {
			await interaction.reply({
				components: [
					new Container(
						[new TextDisplay("Could not determine your identity or guild.")],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const targetUser = interaction.options.getUser("user", true)
		const targetId = targetUser.id

		// Find the application in AWAITING_LEAD_APPROVAL for this user
		const application = await db
			.select()
			.from(applications)
			.where(
				and(
					eq(applications.userId, targetId),
					eq(applications.status, "AWAITING_LEAD_APPROVAL"),
					eq(applications.guildId, guildId)
				)
			)
			.get()

		if (!application) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`<@${targetId}> does not have an application awaiting lead approval.`
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
			})
			return
		}

		const appTeam = application.team as TeamSlug
		const leadTeams = await getLeadTeams(callerId)

		if (!leadTeams.includes(appTeam)) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You are not the team lead for this application's team."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
			})
			return
		}

		const [teamConfig, globalConfig] = await Promise.all([
			getTeamConfig(appTeam),
			getGlobalConfig(),
		])

		const teamName = TEAM_DISPLAY_NAMES[appTeam]
		const client = interaction.client
		const now = new Date()

		// Update application status
		await db
			.update(applications)
			.set({
				status: "DENIED_BY_LEAD",
				leadDecisionBy: callerId,
				leadDecidedAt: now,
				updatedAt: now,
			})
			.where(eq(applications.id, application.id))

		// Update trial record
		await db
			.update(trials)
			.set({ status: "FAILED", endTime: now })
			.where(
				and(
					eq(trials.applicationId, application.id),
					eq(trials.userId, targetId)
				)
			)

		// Remove trial role
		if (teamConfig.trialRoleId) {
			try {
				await client.rest.delete(
					`/guilds/${guildId}/members/${targetId}/roles/${teamConfig.trialRoleId}`,
					{ headers: { "X-Audit-Log-Reason": "Lead denied promotion" } }
				)
			} catch (err) {
				console.error("[deny] Failed to remove trial role:", err)
			}
		}

		// DM user
		await dmUser(
			client,
			targetId,
			`After final review, your promotion to ${teamName} was not approved. You may reapply after ${globalConfig.reapplyCooldownDays} days.`
		)

		// Mod log
		await postToModLog(client, {
			content: `[Onboarding] <@${targetId}>'s promotion to **${teamName}** was denied by <@${callerId}>.`,
			allowed_mentions: { parse: [] },
		})

		await writeAuditLog({
			actorId: callerId,
			action: "DENIED_BY_LEAD",
			applicationId: application.id,
			details: {
				team: appTeam,
				targetUserId: targetId,
				trialRoleId: teamConfig.trialRoleId,
			},
		})

		const container = new Container(
			[
				new TextDisplay(`### Promotion Denied`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`<@${targetId}>'s promotion to **${teamName}** has been denied.`,
						`- Trial role removed`,
						`- User notified via DM`,
						`- Logged to mod log`,
					].join("\n")
				),
			],
			{ accentColor: "#ed4245" }
		)

		await interaction.reply({ components: [container] })
	}
}
