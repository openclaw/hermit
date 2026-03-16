# Next Steps

## Done This Session

- Implemented full community staff onboarding pipeline per `community-staff-001-onboarding.md` RFC
- DB schema: `applications`, `trials`, `promotion_votes`, `audit_logs` tables + migration
- Commands: `/onboard-start`, `/status`, `/trials`, `/trial-status`, `/applications`, `/review`, `/onboarding-stats`, `/promote`, `/deny`, `/onboarding-config`, `/team-config`, `/onboarding-setup`
- Button components: approve/deny application, approve/deny vote, open application form
- Modal: application form (timezone, availability, motivation)
- Scheduler: vote window expiry + lead approval timeout (with startup catch-up)
- Event: auto-fail trial on member leave
- Fixed pre-existing TypeScript error in `github.ts` (`as const` on option types)
- Added `GuildMembers` + `MessageContent` privileged intents
- `/onboarding-setup` command: creates missing roles, auto-saves IDs to config
- README: setup instructions including Developer Portal intents, OAuth2 invite steps, bot configuration
- `VALIDATION.md`: step-by-step manual test guide
- Bot running and verified in test server — `/onboarding-setup` confirmed writing role IDs to `keyValue` table

---

## Bugs (Broken Critical Path)

The vote phase is non-functional. The full broken path:

### 1. `trials` table never populated — `src/components/applicationApproveButton.ts`
When an application is approved and transitions to `TRIAL_ACTIVE`, no row is inserted into the `trials` table. Every command that queries trials (`/trials`, `/trial-status`, `/onboarding-stats`) will return empty results.

**Fix:** Insert a `trials` row when transitioning to `TRIAL_ACTIVE`.

### 2. No mechanism to end a trial — entire codebase
There is no `/trial-complete` command or any other way to manually mark a trial as done and trigger the vote phase. The scheduler's `checkExpiredVotes` only processes applications already in `AWAITING_TEAM_VOTE` — nothing transitions them there.

**Fix:** Add `/trial-complete @user` command that transitions `TRIAL_ACTIVE` → `AWAITING_TEAM_VOTE` and posts the vote message.

### 3. Vote message never posted — `src/lib/scheduler.ts` + `src/components/applicationApproveButton.ts`
When a transition to `AWAITING_TEAM_VOTE` occurs (or would occur), no message with vote buttons is posted to the team channel. `voteMessageId` on the application is never set. Team members have no way to cast votes.

**Fix:** On transition to `AWAITING_TEAM_VOTE`, post a message to the team channel with `VoteApproveButton` and `VoteDenyButton`, save the returned message ID to `application.voteMessageId`.

### 4. `guildMemberRemove` only handles `TRIAL_ACTIVE` — `src/events/guildMemberRemove.ts`
If a member leaves during `AWAITING_TEAM_VOTE` or `AWAITING_LEAD_APPROVAL`, their application is not cleaned up.

**Fix:** Extend the handler to fail/cancel applications in all non-terminal active statuses.

---

## Incomplete Implementations

### 5. Trial start DM never sent — `src/components/applicationApproveButton.ts`
The congratulations DM on approval exists but there is no follow-up DM with trial guidelines/expectations.

### 6. Vote result not announced to team channel — `src/components/voteApproveButton.ts`, `voteDenyButton.ts`
When a vote passes or fails via button click, no message is posted to the team channel showing the result.

### 7. Lead not DM'd on vote pass — `src/lib/scheduler.ts`
The lead is pinged in the team channel but not sent a DM when action is required.

### 8. Race condition: vote buttons vs. scheduler — `src/components/voteApproveButton.ts`, `src/lib/scheduler.ts`
Both the vote buttons and `checkExpiredVotes` can trigger the `AWAITING_TEAM_VOTE` → `AWAITING_LEAD_APPROVAL` transition. No guard prevents both from firing simultaneously.

### 9. Vote threshold inconsistency
- Scheduler (`scheduler.ts:39`): uses `<= threshold` (tie = fail)
- Vote buttons (`voteApproveButton.ts:135`): uses `> threshold` (tie = fail)
- These are consistent but should be verified as intentional.

### 10. Auto-denied applications don't tell user when they can reapply
`applicationModal.ts` sends a denial DM but doesn't include the reapply date.

### 11. Trial metrics never collected — `src/db/schema.ts` `trials.metrics`
The `metrics` JSON column exists and is displayed by `/trial-status`, but nothing ever writes to it. Dead column until a metrics collection strategy is defined.

### 12. Config not validated before scheduler runs — `src/lib/scheduler.ts`
If team config is incomplete (missing `trialRoleId`, `fullRoleId`, etc.), the scheduler will fail silently on that application.

---

## Missing Features

### 13. `/trial-complete @user` command (blocks vote phase entirely)
Team lead manually marks a trial as complete, triggering `TRIAL_ACTIVE` → `AWAITING_TEAM_VOTE` + vote message post.

### 14. Remaining cooldown shown on rejection DM
When auto-rejected due to cooldown, tell the user the exact date they can reapply.

### 15. Vote tally visibility
No way to see current vote counts during an open vote window. Consider `/trial-status` showing live tally for leads.

### 16. Channel setup in `/onboarding-setup`
The command creates roles but not channels. Team channels and mod log channel must still be created and configured manually.

---

## Testing

- [ ] Write unit tests for `src/lib/autoChecks.ts`
- [ ] Write unit tests for `src/lib/configStore.ts`
- [ ] Write unit tests for `src/lib/permissions.ts`
- [ ] Write unit tests for `src/lib/scheduler.ts`
- [ ] Write unit tests for `src/lib/auditLogger.ts`
- [ ] Integration tests for application status transitions end-to-end
- [ ] Run through `VALIDATION.md` checklist in test server once bugs above are fixed

## Setup Still Needed in Test Server

- [ ] Configure channel IDs: `/onboarding-config set publicAnnouncementChannelId` and `modLogChannelId`
- [ ] Configure per-team channel IDs and lead user IDs: `/team-config set --team <team>`
- [ ] Verify all 4 teams configured, not just `discord_mod`
