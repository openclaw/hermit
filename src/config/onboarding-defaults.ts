import type { OnboardingGlobalConfig, OnboardingTeamConfig } from "../types/onboarding.js"

export const DEFAULT_GLOBAL_CONFIG: OnboardingGlobalConfig = {
  minServerTenureDays: 14,
  reapplyCooldownDays: 7,
  communityStaffRoleId: "",
  publicAnnouncementChannelId: "",
  modLogChannelId: "",
  docsRepoUrl: "https://github.com/openclaw/community",
}

export const DEFAULT_TEAM_CONFIG: Omit<OnboardingTeamConfig, "channelId" | "leadUserId" | "trialRoleId" | "fullRoleId"> = {
  trialDurationDays: 7,
  voteWindowHours: 48,
  voteThreshold: 0.5,
  leadApprovalTimeoutDays: 7,
}
