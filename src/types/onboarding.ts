export type TeamSlug = "discord_mod" | "vc_mod" | "helper" | "configurator"

export const TEAM_SLUGS: TeamSlug[] = ["discord_mod", "vc_mod", "helper", "configurator"]

export const TEAM_DISPLAY_NAMES: Record<TeamSlug, string> = {
  discord_mod: "Discord Mod",
  vc_mod: "VC Mod",
  helper: "Helper",
  configurator: "Configurator",
}

export type ApplicationStatus =
  | "FORM_SENT"
  | "APPLICATION_PENDING_REVIEW"
  | "APPLICATION_DENIED"
  | "TRIAL_ACTIVE"
  | "TRIAL_FAILED"
  | "AWAITING_TEAM_VOTE"
  | "VOTE_FAILED"
  | "AWAITING_LEAD_APPROVAL"
  | "PROMOTED_BY_LEAD"
  | "PROMOTED_BY_LEAD_INACTION"
  | "DENIED_BY_LEAD"

export const TERMINAL_STATUSES: ApplicationStatus[] = [
  "APPLICATION_DENIED",
  "TRIAL_FAILED",
  "VOTE_FAILED",
  "PROMOTED_BY_LEAD",
  "PROMOTED_BY_LEAD_INACTION",
  "DENIED_BY_LEAD",
]

export const DECLINED_STATUSES: ApplicationStatus[] = [
  "APPLICATION_DENIED",
  "TRIAL_FAILED",
  "VOTE_FAILED",
  "DENIED_BY_LEAD",
]

export type TrialStatus = "ACTIVE" | "COMPLETED" | "FAILED"
export type VoteChoice = "APPROVE" | "DENY"

export type OnboardingGlobalConfig = {
  minServerTenureDays: number
  reapplyCooldownDays: number
  communityStaffRoleId: string
  publicAnnouncementChannelId: string
  modLogChannelId: string
  docsRepoUrl: string
}

export type OnboardingTeamConfig = {
  channelId: string
  leadUserId: string
  trialRoleId: string
  fullRoleId: string
  trialDurationDays: number
  voteWindowHours: number
  voteThreshold: number
  leadApprovalTimeoutDays: number
}

export type AutoRejectReason =
  | { type: "SERVER_TENURE"; tenureDays: number; requiredDays: number }
  | { type: "HAS_BAN" }
  | { type: "PENDING_APPLICATION"; team: TeamSlug }
  | { type: "IN_COOLDOWN"; reapplyAt: Date }

export type AutoCheckResult =
  | { passed: true }
  | { passed: false; reason: AutoRejectReason }
