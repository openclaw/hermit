import {
  GuildMemberRemoveListener,
  type Client,
  type ListenerEventData,
} from "@buape/carbon"
import { and, eq } from "drizzle-orm"
import { db } from "../db.js"
import { applications, trials } from "../db/schema.js"
import { writeAuditLog } from "../lib/auditLogger.js"
import { postToModLog } from "../lib/notifications.js"

export default class GuildMemberRemove extends GuildMemberRemoveListener {
  async handle(data: ListenerEventData[this["type"]], client: Client) {
    const userId = data.user.id

    // Find an active trial application for this user
    const application = await db
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          eq(applications.status, "TRIAL_ACTIVE"),
        ),
      )
      .get()

    if (!application) return

    const now = new Date()

    // Transition application to TRIAL_FAILED
    await db
      .update(applications)
      .set({ status: "TRIAL_FAILED", updatedAt: now })
      .where(eq(applications.id, application.id))

    // Update the trial record
    await db
      .update(trials)
      .set({ status: "FAILED", endTime: now, updatedAt: now })
      .where(eq(trials.applicationId, application.id))

    // Write audit log
    await writeAuditLog({
      actorId: "system",
      action: "TRIAL_FAILED_MEMBER_LEFT",
      applicationId: application.id,
      details: {
        userId,
        team: application.team,
        guildId: application.guildId,
      },
    })

    // Post to mod log
    await postToModLog(client, {
      content: `<@${userId}> left the server during their **${application.team}** trial. Trial marked as FAILED.`,
      allowed_mentions: { parse: [] },
    })
  }
}
