import { db } from "../db.js"
import { auditLogs } from "../db/schema.js"

export async function writeAuditLog(params: {
  actorId: string
  action: string
  applicationId?: string
  trialId?: string
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: params.actorId,
      action: params.action,
      applicationId: params.applicationId,
      trialId: params.trialId,
      details: params.details ?? {},
    })
  } catch (err) {
    console.error(`[auditLogger] Failed to write audit log:`, err)
  }
}
