# Session Notes — Onboarding System Implementation

**Date:** 2026-03-08
**Goal:** Implement `community-staff-001-onboarding.md` RFC into the Hermit Discord bot.
**Status:** Implementation complete, TypeScript clean. Unit tests not yet written.

---

## What Was Built

Full community staff onboarding pipeline: application → trial → team vote → lead approval → promotion (or decline at any stage), with bot-driven logistics and human decision-making at key checkpoints.

---

## New Files (28 files created, 4 modified)

### Types & Config
| File | Purpose |
|------|---------|
| `src/types/onboarding.ts` | All shared types: `TeamSlug`, `ApplicationStatus`, `OnboardingGlobalConfig`, `OnboardingTeamConfig`, `AutoCheckResult`, constants like `TERMINAL_STATUSES` |
| `src/config/onboarding-defaults.ts` | Default values: 14-day tenure, 7-day cooldown, 7-day trial, 48h vote window, 7-day lead timeout |

### Database
| File | Purpose |
|------|---------|
| `src/db/schema.ts` | **Modified** — 4 new tables added (see below) |
| `drizzle/0000_fixed_may_parker.sql` | Generated migration |

### Library (pure functions, no Discord interactions)
| File | Purpose |
|------|---------|
| `src/lib/configStore.ts` | Typed read/write for global + per-team config stored in the `keyValue` table |
| `src/lib/permissions.ts` | `isTeamLead`, `isFullTeamMember`, `isTrialMember`, `getFullMemberTeams`, `getLeadTeams` |
| `src/lib/autoChecks.ts` | Pre-application eligibility: server tenure, ban check, pending app check, cooldown check |
| `src/lib/notifications.ts` | Discord messaging: `dmUser`, `postToTeamChannel`, `postToModLog`, `postPublicAnnouncement`, `editMessage` |
| `src/lib/auditLogger.ts` | `writeAuditLog` — writes structured entries to `audit_logs` table |
| `src/lib/scheduler.ts` | `startScheduler` — two `setInterval` loops: vote expiry (5 min) + lead timeout (15 min) |

### Commands
| File | Command | Who Can Use |
|------|---------|-------------|
| `src/commands/onboardStart.ts` | `/onboard-start @user --team` | Team Lead |
| `src/commands/status.ts` | `/status` | Trial member |
| `src/commands/trials.ts` | `/trials`, `/trial-status @user` | Full members + leads |
| `src/commands/applications.ts` | `/applications`, `/review <id>` | Team leads |
| `src/commands/onboardingStats.ts` | `/onboarding-stats` | Team leads |
| `src/commands/promote.ts` | `/promote @user` | Team lead only |
| `src/commands/deny.ts` | `/deny @user` | Team lead only |
| `src/commands/admin/onboardingConfig.ts` | `/onboarding-config get\|set` | Admin |
| `src/commands/admin/teamConfig.ts` | `/team-config get\|set --team` | Admin |

### Components (Buttons)
| File | Custom ID Pattern | Purpose |
|------|------------------|---------|
| `src/components/openApplicationFormButton.ts` | `onboarding-open-form:applicationId={id}` | In DM — opens application modal |
| `src/components/applicationApproveButton.ts` | `onboarding-app-approve:applicationId={id}` | In team channel — approve application |
| `src/components/applicationDenyButton.ts` | `onboarding-app-deny:applicationId={id}` | In team channel — deny application |
| `src/components/voteApproveButton.ts` | `onboarding-vote-approve:applicationId={id}` | In team channel — approve promotion vote |
| `src/components/voteDenyButton.ts` | `onboarding-vote-deny:applicationId={id}` | In team channel — deny promotion vote |

### Modals
| File | Custom ID Pattern | Purpose |
|------|------------------|---------|
| `src/modals/applicationModal.ts` | `application-modal:applicationId={id}` | Application form: timezone, availability, motivation |

### Events
| File | Trigger | Purpose |
|------|---------|---------|
| `src/events/guildMemberRemove.ts` | Member leaves server | Auto-fail active trial → `TRIAL_FAILED` |
| `src/events/ready.ts` | **Modified** — bot ready | Starts the scheduler |

### Modified (existing files)
| File | Change |
|------|--------|
| `src/index.ts` | Registered all new commands, components, modal, listener; added `GuildMembers` intent |
| `src/commands/github.ts` | Fixed pre-existing TS error: added `as const` to `type` fields in `options` array |
| `src/commands/admin/teamConfig.ts` | Fixed TS error: removed `as const` from choices array (was making it readonly) |

---

## Database Schema

### `applications`
Core entity. Tracks every application from `FORM_SENT` → terminal state.

**Status flow:**
```
FORM_SENT
  → APPLICATION_PENDING_REVIEW  (modal submitted + auto-checks passed)
  → APPLICATION_DENIED          (team denied during review) [terminal]
  → TRIAL_ACTIVE                (team approved)
  → TRIAL_FAILED                (member left or failed) [terminal]
  → AWAITING_TEAM_VOTE          (trial completed)
  → VOTE_FAILED                 (no majority in 48h) [terminal]
  → AWAITING_LEAD_APPROVAL      (vote passed)
  → PROMOTED_BY_LEAD            (lead ran /promote) [terminal]
  → PROMOTED_BY_LEAD_INACTION   (lead timed out, auto-promoted) [terminal]
  → DENIED_BY_LEAD              (lead ran /deny) [terminal]
```

Key columns: `userId`, `guildId`, `team`, `status`, `initiatedBy`, `approvedBy` (JSON array), `reviewMessageId`, `voteMessageId`, `leadApprovalDeadline`, `leadDecisionBy`

### `trials`
One row per `TRIAL_ACTIVE` application. Tracks start/end time, status (`ACTIVE|COMPLETED|FAILED`), and extensible `metrics` JSON for team-specific tracking.

### `promotion_votes`
One row per voter per application. Unique constraint on `(applicationId, voterId)` — enables vote changes via upsert. `vote` is `APPROVE|DENY`.

### `audit_logs`
Append-only log of every state transition and action. Fields: `actorId`, `action` (e.g. `"TRIAL_STARTED"`), `applicationId`, `trialId`, `details` (JSON).

### `keyValue` (existing, extended)
Config stored under namespaced keys:
- `"onboarding:globalConfig"` → `OnboardingGlobalConfig` JSON
- `"onboarding:teamConfig:discord_mod"` → `OnboardingTeamConfig` JSON
- (same pattern for `vc_mod`, `helper`, `configurator`)

---

## Key Design Decisions

1. **Config via DB** — All settings (role IDs, channel IDs, timeouts) are stored in the `keyValue` table and overlaid on hardcoded defaults. Bot works with zero config rows on first boot.

2. **Modal flow** — Discord modals can't be pushed proactively. Flow is: `/onboard-start` DMs a button → user clicks → modal appears → modal submit runs auto-checks → post to team channel or reject.

3. **Approval logic** — 2 full members OR 1 Team Lead to approve. Any full member can immediately deny. Tracked via `approvedBy` JSON array on the application.

4. **Vote upsert** — `promotionVotes` unique index on `(applicationId, voterId)` + Drizzle's `onConflictDoUpdate` handles vote changes cleanly.

5. **Scheduler on startup** — Both scheduler functions run immediately on bot start (before the intervals kick in) to catch any deadlines missed during downtime.

6. **`GuildMembers` privileged intent** — Required for member join date (tenure check) and `GuildMemberRemove` events. Must be enabled in Discord Developer Portal.

---

## Unit Test Targets for Next Session

### `src/lib/autoChecks.ts` — `runAutoChecks`
- Returns `{ passed: false, reason: { type: "SERVER_TENURE" } }` when member joined < 14 days ago
- Returns `{ passed: false, reason: { type: "HAS_BAN" } }` when user is banned
- Returns `{ passed: false, reason: { type: "PENDING_APPLICATION" } }` when user has an active application
- Returns `{ passed: false, reason: { type: "IN_COOLDOWN" } }` when user declined within cooldown window
- Returns `{ passed: true }` when all checks pass
- Cooldown check uses `reapplyCooldownDays` from config (not hardcoded 7)

### `src/lib/configStore.ts`
- `getGlobalConfig` returns defaults when no DB row exists
- `getGlobalConfig` merges DB values over defaults
- `setGlobalConfig` upserts (not duplicates) on repeated calls
- `getTeamConfig` / `setTeamConfig` work per-team without cross-contamination

### `src/lib/permissions.ts`
- `isTeamLead` returns true only when userId matches `leadUserId` in config
- `isFullTeamMember` checks roles against `fullRoleId`
- `isTrialMember` checks roles against `trialRoleId`
- `getFullMemberTeams` returns multiple teams if user has multiple full roles

### `src/lib/scheduler.ts` — `checkExpiredVotes`
- Does nothing when vote window is still open
- Transitions to `VOTE_FAILED` when window expires with no majority
- Transitions to `AWAITING_LEAD_APPROVAL` when majority approve
- Sets `leadApprovalDeadline` correctly on transition

### `src/lib/scheduler.ts` — `checkLeadApprovalTimeouts`
- Does nothing when deadline is in the future
- Grants full role + community staff role on auto-promote
- Removes trial role on auto-promote
- Sets status to `PROMOTED_BY_LEAD_INACTION`
- Updates trial record to `COMPLETED`

### `src/lib/auditLogger.ts`
- Writes correct fields to `audit_logs`
- Does not throw on DB error (logs to console instead)

### Application status transitions (integration-style)
- `FORM_SENT` → `APPLICATION_PENDING_REVIEW` on modal submit + passing checks
- `FORM_SENT` → `APPLICATION_DENIED` on modal submit + failing auto-check
- `APPLICATION_PENDING_REVIEW` → `TRIAL_ACTIVE` on 2nd approval (or 1 lead approval)
- Partial approval (1 of 2): status stays `APPLICATION_PENDING_REVIEW`
- `TRIAL_ACTIVE` → `TRIAL_FAILED` on `GuildMemberRemove`

---

## Setup Required Before Bot Can Run

1. Enable `GuildMembers` privileged intent in Discord Developer Portal
2. Configure via `/onboarding-config set` and `/team-config set --team` for each team:
   - Role IDs: `communityStaffRoleId`, per-team `trialRoleId`, `fullRoleId`
   - Channel IDs: `publicAnnouncementChannelId`, `modLogChannelId`, per-team `channelId`
   - Lead user ID: per-team `leadUserId`
