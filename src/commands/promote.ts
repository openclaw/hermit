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
import {
	dmUser,
	postToModLog,
	postPublicAnnouncement,
} from "../lib/notifications.js"
import { writeAuditLog } from "../lib/auditLogger.js"

export default class PromoteCommand extends BaseCommand {
	name = "promote"
	description = "Promote a trial member to full team staff (after vote passes)"
	defer = true
	integrationTypes = [ApplicationIntegrationType.GuildInstall]
	contexts = [InteractionContextType.Guild]
	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The trial member to promote",
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
				status: "PROMOTED_BY_LEAD",
				leadDecisionBy: callerId,
				leadDecidedAt: now,
				updatedAt: now,
			})
			.where(eq(applications.id, application.id))

		// Update trial record
		await db
			.update(trials)
			.set({ status: "COMPLETED", endTime: now })
			.where(
				and(
					eq(trials.applicationId, application.id),
					eq(trials.userId, targetId)
				)
			)

		const auditHeader = { "X-Audit-Log-Reason": "Onboarding promotion" }

		// Grant full team role
		if (teamConfig.fullRoleId) {
			try {
				await client.rest.put(
					`/guilds/${guildId}/members/${targetId}/roles/${teamConfig.fullRoleId}`,
					{ body: undefined, headers: auditHeader }
				)
			} catch (err) {
				console.error("[promote] Failed to grant full team role:", err)
			}
		}

		// Grant Community Staff umbrella role
		if (globalConfig.communityStaffRoleId) {
			try {
				await client.rest.put(
					`/guilds/${guildId}/members/${targetId}/roles/${globalConfig.communityStaffRoleId}`,
					{ body: undefined, headers: auditHeader }
				)
			} catch (err) {
				console.error("[promote] Failed to grant community staff role:", err)
			}
		}

		// Remove trial role
		if (teamConfig.trialRoleId) {
			try {
				await client.rest.delete(
					`/guilds/${guildId}/members/${targetId}/roles/${teamConfig.trialRoleId}`,
					{ headers: { "X-Audit-Log-Reason": "Onboarding promotion - trial period complete" } }
				)
			} catch (err) {
				console.error("[promote] Failed to remove trial role:", err)
			}
		}

		// DM user
		await dmUser(
			client,
			targetId,
			`Congratulations! You've been promoted to ${teamName} Staff! Welcome to the team!`
		)

		// Public announcement
		await postPublicAnnouncement(client, {
			content: `Please welcome <@${targetId}> to the ${teamName} team!`,
			allowed_mentions: { users: [targetId] },
		})

		// Mod log
		await postToModLog(client, {
			content: `[Onboarding] <@${targetId}> has been promoted to **${teamName}** by <@${callerId}>.`,
			allowed_mentions: { parse: [] },
		})

		await writeAuditLog({
			actorId: callerId,
			action: "PROMOTED_BY_LEAD",
			applicationId: application.id,
			details: {
				team: appTeam,
				targetUserId: targetId,
				fullRoleId: teamConfig.fullRoleId,
				trialRoleId: teamConfig.trialRoleId,
				communityStaffRoleId: globalConfig.communityStaffRoleId,
			},
		})

		const container = new Container(
			[
				new TextDisplay(`### Promotion Complete`),
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					[
						`<@${targetId}> has been promoted to **${teamName}** staff.`,
						`- Trial role removed`,
						`- Full team role granted`,
						`- Community Staff role granted`,
						`- User notified via DM`,
						`- Public announcement posted`,
					].join("\n")
				),
			],
			{ accentColor: "#3fb950" }
		)

		await interaction.reply({ components: [container] })
	}
}
