import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	Container,
	TextDisplay,
} from "@buape/carbon"
import { and, eq } from "drizzle-orm"
import { db } from "../db.js"
import { applications, promotionVotes, trials } from "../db/schema.js"
import { getTeamConfig } from "../lib/configStore.js"
import {
	getFullMemberTeams,
	getLeadTeams,
	type MemberRoles,
} from "../lib/permissions.js"
import {
	dmUser,
	postToTeamChannel,
} from "../lib/notifications.js"
import { writeAuditLog } from "../lib/auditLogger.js"
import { TEAM_DISPLAY_NAMES, type TeamSlug } from "../types/onboarding.js"

export default class VoteApproveButton extends Button {
	customId = "onboarding-vote-approve"
	label = "Approve"
	style = ButtonStyle.Success

	constructor(applicationId?: string) {
		super()
		if (applicationId) {
			this.customId = `onboarding-vote-approve:applicationId=${applicationId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const applicationId = String(data.applicationId)
		const voterId = interaction.user?.id

		if (!voterId) {
			await interaction.reply({
				components: [
					new Container(
						[new TextDisplay("Could not determine your user ID.")],
						{ accentColor: "#ed4245" }
					),
				],
				flags: 64,
			})
			return
		}

		const application = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId))
			.get()

		if (!application || application.status !== "AWAITING_TEAM_VOTE") {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"This application is not currently in the voting stage."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
				flags: 64,
			})
			return
		}

		const appTeam = application.team as TeamSlug
		const member = interaction.member
		const memberRoles: MemberRoles = member?.roles ?? []

		const [fullTeams, leadTeams] = await Promise.all([
			getFullMemberTeams(memberRoles),
			getLeadTeams(voterId),
		])

		const canVote =
			fullTeams.includes(appTeam) || leadTeams.includes(appTeam)

		if (!canVote) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								"You are not authorized to vote on this application."
							),
						],
						{ accentColor: "#ed4245" }
					),
				],
				flags: 64,
			})
			return
		}

		// Upsert vote as APPROVE
		await db
			.insert(promotionVotes)
			.values({
				applicationId,
				voterId,
				vote: "APPROVE",
			})
			.onConflictDoUpdate({
				target: [promotionVotes.applicationId, promotionVotes.voterId],
				set: { vote: "APPROVE", updatedAt: new Date() },
			})

		// Re-evaluate vote totals
		const allVotes = await db
			.select()
			.from(promotionVotes)
			.where(eq(promotionVotes.applicationId, applicationId))
			.all()

		const teamConfig = await getTeamConfig(appTeam)
		const approveCount = allVotes.filter((v) => v.vote === "APPROVE").length
		const denyCount = allVotes.filter((v) => v.vote === "DENY").length
		const totalVotes = allVotes.length
		const threshold = teamConfig.voteThreshold ?? 0.5

		const teamName = TEAM_DISPLAY_NAMES[appTeam]
		const client = interaction.client

		if (approveCount / totalVotes > threshold) {
			// Majority approve — transition to AWAITING_LEAD_APPROVAL
			const deadline = new Date(
				Date.now() +
					(teamConfig.leadApprovalTimeoutDays ?? 7) * 24 * 60 * 60 * 1000
			)

			await db
				.update(applications)
				.set({
					status: "AWAITING_LEAD_APPROVAL",
					leadApprovalDeadline: deadline,
					updatedAt: new Date(),
				})
				.where(eq(applications.id, applicationId))

			// DM the applicant
			await dmUser(
				client,
				application.userId,
				`The ${teamName} team has approved your promotion! Awaiting final sign-off from the Team Lead.`
			)

			// Notify team lead in team channel
			await postToTeamChannel(client, appTeam, {
				content: `<@${teamConfig.leadUserId}> — <@${application.userId}> has passed the team vote! Use /promote or /deny within ${teamConfig.leadApprovalTimeoutDays ?? 7} days. Auto-approval will occur after the deadline.`,
				allowed_mentions: { users: [teamConfig.leadUserId] },
			})

			await writeAuditLog({
				actorId: voterId,
				action: "VOTE_MAJORITY_APPROVE",
				applicationId,
				details: {
					approveCount,
					denyCount,
					totalVotes,
					team: appTeam,
					newStatus: "AWAITING_LEAD_APPROVAL",
				},
			})

			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`Your approve vote has been recorded. The team has reached a majority — the application is now awaiting lead approval.`
							),
						],
						{ accentColor: "#3fb950" }
					),
				],
				flags: 64,
			})
		} else if (denyCount / totalVotes > threshold) {
			// Majority deny — transition to VOTE_FAILED
			await db
				.update(applications)
				.set({ status: "VOTE_FAILED", updatedAt: new Date() })
				.where(eq(applications.id, applicationId))

			// Update trial record
			await db
				.update(trials)
				.set({ status: "FAILED", endTime: new Date() })
				.where(
					and(
						eq(trials.applicationId, applicationId),
						eq(trials.userId, application.userId)
					)
				)

			// Remove trial role
			const guildId = application.guildId
			if (teamConfig.trialRoleId) {
				try {
					await client.rest.delete(
						`/guilds/${guildId}/members/${application.userId}/roles/${teamConfig.trialRoleId}`,
						{ headers: { "X-Audit-Log-Reason": "Team vote failed" } }
					)
				} catch (err) {
					console.error("[voteApproveButton] Failed to remove trial role:", err)
				}
			}

			// DM user
			await dmUser(
				client,
				application.userId,
				`After the team vote, your promotion to ${teamName} was not approved at this time. You may reapply after the cooldown period.`
			)

			await writeAuditLog({
				actorId: voterId,
				action: "VOTE_MAJORITY_DENY",
				applicationId,
				details: {
					approveCount,
					denyCount,
					totalVotes,
					team: appTeam,
					newStatus: "VOTE_FAILED",
				},
			})

			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`Your approve vote has been recorded. The deny votes have reached a majority — the vote has concluded with a denial.`
							),
						],
						{ accentColor: "#f0b132" }
					),
				],
				flags: 64,
			})
		} else {
			// No majority yet
			await writeAuditLog({
				actorId: voterId,
				action: "VOTE_CAST_APPROVE",
				applicationId,
				details: { approveCount, denyCount, totalVotes, team: appTeam },
			})

			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay(
								`Your approve vote has been recorded. Current tally: **${approveCount}** approve, **${denyCount}** deny (${totalVotes} total votes cast).`
							),
						],
						{ accentColor: "#3fb950" }
					),
				],
				flags: 64,
			})
		}
	}
}
