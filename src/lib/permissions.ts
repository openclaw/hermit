import type { TeamSlug } from "../types/onboarding.js"
import { TEAM_SLUGS } from "../types/onboarding.js"
import { getTeamConfig } from "./configStore.js"

export type MemberRoles = { id: string }[]

export async function isTeamLead(
  userId: string,
  team: TeamSlug,
): Promise<boolean> {
  const config = await getTeamConfig(team)
  return userId === config.leadUserId
}

export async function isFullTeamMember(
  roles: MemberRoles,
  team: TeamSlug,
): Promise<boolean> {
  const config = await getTeamConfig(team)
  return roles.some((r) => r.id === config.fullRoleId)
}

export async function isTrialMember(
  roles: MemberRoles,
  team: TeamSlug,
): Promise<boolean> {
  const config = await getTeamConfig(team)
  return roles.some((r) => r.id === config.trialRoleId)
}

export async function getFullMemberTeams(
  roles: MemberRoles,
): Promise<TeamSlug[]> {
  const result: TeamSlug[] = []
  for (const team of TEAM_SLUGS) {
    if (await isFullTeamMember(roles, team)) result.push(team)
  }
  return result
}

export async function getLeadTeams(userId: string): Promise<TeamSlug[]> {
  const result: TeamSlug[] = []
  for (const team of TEAM_SLUGS) {
    if (await isTeamLead(userId, team)) result.push(team)
  }
  return result
}
