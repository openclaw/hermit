import { and, eq, lt } from "drizzle-orm"
import type { Client } from "@buape/carbon"
import { db } from "../db.js"
import { applications, promotionVotes, trials } from "../db/schema.js"
import { getTeamConfig, getGlobalConfig } from "./configStore.js"
import { dmUser, postToTeamChannel, postPublicAnnouncement, postToModLog } from "./notifications.js"
import { writeAuditLog } from "./auditLogger.js"
import type { TeamSlug } from "../types/onboarding.js"

export function startScheduler(client: Client): void {
  // Run immediately on start to catch any missed deadlines
  void checkExpiredVotes(client)
  void checkLeadApprovalTimeouts(client)

  // Then run on interval
  setInterval(() => { void checkExpiredVotes(client) }, 5 * 60 * 1000)   // every 5 min
  setInterval(() => { void checkLeadApprovalTimeouts(client) }, 15 * 60 * 1000)  // every 15 min
}

async function checkExpiredVotes(client: Client): Promise<void> {
  // Find all applications in AWAITING_TEAM_VOTE
  const pending = await db.select().from(applications).where(eq(applications.status, "AWAITING_TEAM_VOTE"))

  for (const app of pending) {
    try {
      const teamConfig = await getTeamConfig(app.team as TeamSlug)
      // The vote window starts when the status was set to AWAITING_TEAM_VOTE (use updatedAt as proxy)
      const voteWindowMs = teamConfig.voteWindowHours * 60 * 60 * 1000
      const updatedAt = app.updatedAt instanceof Date ? app.updatedAt : new Date(app.updatedAt ?? Date.now())
      const voteDeadline = new Date(updatedAt.getTime() + voteWindowMs)

      if (Date.now() < voteDeadline.getTime()) continue // window still open

      // Window expired — evaluate votes
      const votes = await db.select().from(promotionVotes).where(eq(promotionVotes.applicationId, app.id))
      const approveCount = votes.filter(v => v.vote === "APPROVE").length
      const totalVotes = votes.length

      if (totalVotes === 0 || approveCount / totalVotes <= teamConfig.voteThreshold) {
        // No majority — VOTE_FAILED
        await db.update(applications)
          .set({ status: "VOTE_FAILED", updatedAt: new Date() })
          .where(eq(applications.id, app.id))

        // Remove trial role
        const guildId = app.guildId
        if (teamConfig.trialRoleId) {
          try {
            await client.rest.delete(`/guilds/${guildId}/members/${app.userId}/roles/${teamConfig.trialRoleId}`)
          } catch {}
        }

        const globalConfig = await getGlobalConfig()
        await dmUser(client, app.userId,
          `After review, the ${app.team.replace("_", " ")} team has decided not to proceed with your promotion. You may reapply after ${globalConfig.reapplyCooldownDays} days.`)

        await writeAuditLog({ actorId: "system", action: "VOTE_EXPIRED_FAILED", applicationId: app.id, details: { approveCount, totalVotes } })
        await postToModLog(client, { content: `Vote window expired for <@${app.userId}> (${app.team}) — no majority reached. Status: VOTE_FAILED.` })
      } else {
        // Majority approve — transition to AWAITING_LEAD_APPROVAL
        const timeoutDays = teamConfig.leadApprovalTimeoutDays
        const deadline = new Date(Date.now() + timeoutDays * 24 * 60 * 60 * 1000)

        await db.update(applications)
          .set({ status: "AWAITING_LEAD_APPROVAL", leadApprovalDeadline: deadline, updatedAt: new Date() })
          .where(eq(applications.id, app.id))

        await dmUser(client, app.userId,
          `The ${app.team.replace("_", " ")} team has voted to promote you! Awaiting final sign-off from the Team Lead within ${timeoutDays} days.`)

        if (teamConfig.leadUserId) {
          await postToTeamChannel(client, app.team as TeamSlug, {
            content: `<@${teamConfig.leadUserId}> — <@${app.userId}> has passed the team vote for **${app.team}**! Use \`/promote\` or \`/deny\` within **${timeoutDays} days**. If you don't respond, they will be auto-approved.`
          })
        }

        await writeAuditLog({ actorId: "system", action: "VOTE_PASSED_AWAITING_LEAD", applicationId: app.id, details: { approveCount, totalVotes } })
      }
    } catch (err) {
      console.error(`[scheduler] Error processing vote for application ${app.id}:`, err)
    }
  }
}

async function checkLeadApprovalTimeouts(client: Client): Promise<void> {
  const now = new Date()

  // Find applications past their lead approval deadline
  const expired = await db.select().from(applications)
    .where(and(
      eq(applications.status, "AWAITING_LEAD_APPROVAL"),
      lt(applications.leadApprovalDeadline, now),
    ))

  for (const app of expired) {
    try {
      const teamConfig = await getTeamConfig(app.team as TeamSlug)
      const globalConfig = await getGlobalConfig()

      // Auto-promote
      await db.update(applications)
        .set({
          status: "PROMOTED_BY_LEAD_INACTION",
          leadDecisionBy: teamConfig.leadUserId || "system",
          leadDecidedAt: now,
          updatedAt: now,
        })
        .where(eq(applications.id, app.id))

      const guildId = app.guildId

      // Grant full role
      if (teamConfig.fullRoleId) {
        try { await client.rest.put(`/guilds/${guildId}/members/${app.userId}/roles/${teamConfig.fullRoleId}`) } catch {}
      }

      // Grant community staff umbrella role
      if (globalConfig.communityStaffRoleId) {
        try { await client.rest.put(`/guilds/${guildId}/members/${app.userId}/roles/${globalConfig.communityStaffRoleId}`) } catch {}
      }

      // Remove trial role
      if (teamConfig.trialRoleId) {
        try { await client.rest.delete(`/guilds/${guildId}/members/${app.userId}/roles/${teamConfig.trialRoleId}`) } catch {}
      }

      // Update trial record
      await db.update(trials)
        .set({ status: "COMPLETED", endTime: now, updatedAt: now })
        .where(eq(trials.applicationId, app.id))

      await dmUser(client, app.userId,
        `Your promotion has been automatically approved! The Team Lead approval window has expired. Welcome to the ${app.team.replace("_", " ")} Staff team!`)

      await postPublicAnnouncement(client, {
        content: `Please welcome <@${app.userId}> to the **${app.team.replace("_", " ")}** team!`
      })

      if (teamConfig.leadUserId) {
        await postToTeamChannel(client, app.team as TeamSlug, {
          content: `<@${teamConfig.leadUserId}> did not respond within the approval window. <@${app.userId}> has been **auto-approved** and promoted to ${app.team} Staff.`
        })
      }

      await postToModLog(client, { content: `Auto-promotion triggered for <@${app.userId}> (${app.team}). Lead approval timeout expired.` })
      await writeAuditLog({ actorId: "system", action: "AUTO_PROMOTED_LEAD_INACTION", applicationId: app.id, details: { team: app.team } })
    } catch (err) {
      console.error(`[scheduler] Error auto-promoting application ${app.id}:`, err)
    }
  }
}
