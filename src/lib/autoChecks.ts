import { and, gt, inArray, notInArray } from "drizzle-orm"
import { eq } from "drizzle-orm"
import type { Client } from "@buape/carbon"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import { getGlobalConfig } from "./configStore.js"
import {
  DECLINED_STATUSES,
  TERMINAL_STATUSES,
} from "../types/onboarding.js"
import type { AutoCheckResult, TeamSlug } from "../types/onboarding.js"

export async function runAutoChecks(
  userId: string,
  guildId: string,
  client: Client,
): Promise<AutoCheckResult> {
  const config = await getGlobalConfig()

  // 1. Check server tenure via REST
  try {
    const member = (await client.rest.get(
      `/guilds/${guildId}/members/${userId}`,
    )) as { joined_at?: string }
    if (member.joined_at) {
      const joinedAt = new Date(member.joined_at)
      const tenureDays =
        (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24)
      if (tenureDays < config.minServerTenureDays) {
        return {
          passed: false,
          reason: {
            type: "SERVER_TENURE",
            tenureDays: Math.floor(tenureDays),
            requiredDays: config.minServerTenureDays,
          },
        }
      }
    }
  } catch {
    // Member not found or fetch error — let onboard-start handle the not-in-server case
  }

  // 2. Check for active server ban
  try {
    await client.rest.get(`/guilds/${guildId}/bans/${userId}`)
    // If this doesn't throw, the user is banned
    return { passed: false, reason: { type: "HAS_BAN" } }
  } catch {
    // 404 = not banned, which is expected
  }

  // 3. Check for existing pending/active application
  const pending = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        notInArray(applications.status, TERMINAL_STATUSES),
      ),
    )
    .get()

  if (pending) {
    return {
      passed: false,
      reason: { type: "PENDING_APPLICATION", team: pending.team as TeamSlug },
    }
  }

  // 4. Check cooldown (recently declined/failed)
  const cooldownMs = config.reapplyCooldownDays * 24 * 60 * 60 * 1000
  const cooldownCutoff = new Date(Date.now() - cooldownMs)

  const recentDecline = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.status, DECLINED_STATUSES),
        gt(applications.updatedAt, cooldownCutoff),
      ),
    )
    .get()

  if (recentDecline) {
    const updatedAt = recentDecline.updatedAt
    const reapplyAt = new Date(
      (updatedAt instanceof Date ? updatedAt.getTime() : Date.now()) +
        cooldownMs,
    )
    return { passed: false, reason: { type: "IN_COOLDOWN", reapplyAt } }
  }

  return { passed: true }
}
