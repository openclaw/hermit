import { eq } from "drizzle-orm"
import { db } from "../db.js"
import { keyValue } from "../db/schema.js"
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_TEAM_CONFIG,
} from "../config/onboarding-defaults.js"
import type {
  OnboardingGlobalConfig,
  OnboardingTeamConfig,
  TeamSlug,
} from "../types/onboarding.js"

const GLOBAL_KEY = "onboarding:globalConfig"
const teamKey = (team: TeamSlug) => `onboarding:teamConfig:${team}`

export async function getGlobalConfig(): Promise<OnboardingGlobalConfig> {
  const row = await db
    .select()
    .from(keyValue)
    .where(eq(keyValue.key, GLOBAL_KEY))
    .get()
  if (!row) return { ...DEFAULT_GLOBAL_CONFIG }
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...(JSON.parse(row.value) as Partial<OnboardingGlobalConfig>),
  }
}

export async function setGlobalConfig(
  config: Partial<OnboardingGlobalConfig>,
): Promise<void> {
  const current = await getGlobalConfig()
  const merged = { ...current, ...config }
  await db
    .insert(keyValue)
    .values({ key: GLOBAL_KEY, value: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: keyValue.key,
      set: { value: JSON.stringify(merged), updatedAt: new Date() },
    })
}

export async function getTeamConfig(
  team: TeamSlug,
): Promise<OnboardingTeamConfig> {
  const row = await db
    .select()
    .from(keyValue)
    .where(eq(keyValue.key, teamKey(team)))
    .get()
  const defaults: OnboardingTeamConfig = {
    channelId: "",
    leadUserId: "",
    trialRoleId: "",
    fullRoleId: "",
    ...DEFAULT_TEAM_CONFIG,
  }
  if (!row) return defaults
  return {
    ...defaults,
    ...(JSON.parse(row.value) as Partial<OnboardingTeamConfig>),
  }
}

export async function setTeamConfig(
  team: TeamSlug,
  config: Partial<OnboardingTeamConfig>,
): Promise<void> {
  const current = await getTeamConfig(team)
  const merged = { ...current, ...config }
  await db
    .insert(keyValue)
    .values({ key: teamKey(team), value: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: keyValue.key,
      set: { value: JSON.stringify(merged), updatedAt: new Date() },
    })
}
