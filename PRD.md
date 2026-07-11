# Shell Society Nomination Review

## Status

- Product status: Confirmed
- Implementation status: Complete on feature branch
- Pull request status: In progress
- Rollout status: Discord preparation, review, merge, deployment, and smoke test pending
- Source of truth: This document
- Delivery: Feature branch and pull request only; do not push implementation directly to `main`

## Summary

Redesign Hermit's Shell Society nomination workflow so nominations originate in
`#shell-society`, Community Team voting happens privately in `#ct-general`, and
Hermit grants the Shell Society role after three approval votes.

The review board must support both approval and decline votes. The first side to
reach three votes ends the review. Hermit must not publish a welcome or
announcement; Barnacle Sapphire may handle that separately outside this project.

## Background

The current workflow:

- Allows `/nominate` in both `#shell-society` and the existing
  `#nominate-users`.
- Posts the review card into the channel where the command was invoked.
- Supports only positive approvals.
- Requires three distinct Community Team approvals.
- Expires open nominations after 48 hours.
- Uses a durable `granting` state to retry failed Discord role assignments.
- Replaces the review card with public-facing welcome copy after approval.

The redesigned workflow separates nomination entry, private review, role
assignment, public documentation, and any external announcement behavior.

## Goals

1. Make `#shell-society` the only channel where `/nominate` may be used.
2. Send every review card to the private Community Team channel.
3. Support distinct thumbs-up and thumbs-down votes.
4. Finish a review when either side reaches three votes.
5. Preserve durable and idempotent role assignment.
6. Keep the review card private and retain its nomination details after completion.
7. Keep Hermit completely out of public welcome and announcement delivery.
8. Replace the old nomination channel with a read-only information channel managed
   through Discord.

## Non-Goals

- Posting public welcomes or announcements from Hermit.
- Integrating Hermit with Barnacle Sapphire through events, webhooks, APIs, or
  shared state.
- Adding nomination cooldowns.
- Building a backoffice or web administration interface.
- Changing general Shell Society access policy beyond this voting workflow.
- Automating Discord channel creation, archival, permissions, or informational
  message publication.

## Discord Configuration

| Purpose | Channel | ID |
|---|---|---|
| Nomination command source | `#shell-society` | `1471742293055635536` |
| Community Team review | `#ct-general` | `1519064274561929328` |
| Existing nomination channel to archive | `#nominate-users` | `1471743636592001024` |
| New read-only information channel | `#nominate-users` | Assigned when created |

Existing guild, Community Team role, and Shell Society role IDs remain unchanged.

The new information channel is documentation-only. Members must not be directed
to run `/nominate` there. Its ID remains intentionally unassigned until the
Discord administrator creates it during rollout preparation.

## User Workflow

### Submit A Nomination

1. A Shell Society member runs `/nominate` in `#shell-society`.
2. The member selects a nominee and supplies a required reason.
3. Hermit performs the existing validation:
   - The nominee is not the nominator.
   - The nominee is not a bot.
   - The nominee is present in the guild.
   - The nominee does not already have the Shell Society role.
   - The nominee has no active nomination for the target role.
4. Hermit stores the nomination and posts its review card in `#ct-general`.
5. Hermit returns an ephemeral confirmation to the nominator.

No nomination review card or status message is posted publicly.

### Vote

1. The review card displays separate thumbs-up and thumbs-down controls.
2. Only a member currently holding the configured Community Team approver role may
   vote.
3. Each reviewer has one active vote per nomination:
   - Selecting the same vote again is an idempotent no-op.
   - Selecting the opposite vote replaces the reviewer's prior vote.
4. The card displays both totals, for example `Approvals: 2/3` and
   `Declines: 1/3`.
5. Vote mutations and threshold evaluation are atomic so concurrent clicks cannot
   produce two terminal outcomes.

### Approve

1. The first valid transaction that reaches three approval votes moves the
   nomination into the role-granting state.
2. Voting becomes terminal and both controls are disabled.
3. Hermit grants the configured Shell Society role using the existing idempotent
   Discord role `PUT`.
4. After the role grant succeeds, Hermit marks the nomination approved.
5. The private card is updated to show:
   - Nominee, nominator, and reason.
   - Final approval and decline totals.
   - Status: `Approved`.
   - Confirmation that the Shell Society role was granted.

Hermit does not post a welcome or announcement anywhere.

### Decline

1. The first valid transaction that reaches three decline votes marks the
   nomination declined.
2. Voting becomes terminal and both controls are disabled.
3. The private card retains the nomination details and final vote totals.
4. Hermit performs no role or public-message action.

### Expire

1. A nomination still open after 48 hours is marked expired.
2. Both voting controls are disabled.
3. The private card retains the nomination details and final vote totals.
4. A nomination that has already entered role granting does not expire.

## Review Card States

| State | Card behavior |
|---|---|
| Open | Shows nomination details, both vote totals, and enabled voting controls |
| Role grant pending | Shows final totals and disabled controls while role assignment retries |
| Approved | Shows details, final totals, role-granted confirmation, and disabled controls |
| Declined | Shows details, final totals, and disabled controls |
| Expired | Shows details, final totals, and disabled controls |

The current embedded welcome copy must be removed from Hermit's nomination card
and must not be relocated to another Hermit message.

## Information Channel Copy

> **Shell Society nominations**
>
> To nominate someone, use `/nominate` in <#1471742293055635536> and include a
> brief reason.
>
> The Community Team reviews nominations privately. Three thumbs-up votes approve
> a nomination; three thumbs-down votes decline it. Nominations expire after 48
> hours if neither side reaches three votes. Approved nominees receive the Shell
> Society role.

## Data Requirements

1. Add a new migration after the current `0008` nomination migration.
2. Keep the migration additive and compatible with the currently deployed code
   because `deploy:cf` applies remote migrations before deploying the new Worker.
   New required fields must have old-code-compatible defaults, and the migration
   must not rename or remove fields used by the existing implementation.
3. Store one vote choice per nomination and reviewer.
4. Migrate existing approval rows to the positive vote choice. The vote-choice
   field must default to the positive choice so old-code inserts remain valid during
   the migration-to-deploy window.
5. Enforce uniqueness for `(nomination_id, reviewer_id)`.
6. Add the terminal `declined` nomination status.
7. Preserve the active-nomination uniqueness rule for `submitted` and `granting`
   nominations.
8. Preserve existing nomination history.
9. Persist a monotonic desired review-card revision and the last successfully
   synchronized revision.
10. Persist or derive the start time and consecutive failure count for pending role
    grants and review-card synchronization.

## Concurrency And Integrity

- Threshold evaluation must use current persisted votes, not client-provided counts.
- Only one transition may claim a submitted nomination as terminal or role-granting.
- A vote arriving after approval, decline, or expiry must not change stored state.
- Expiry and voting races must resolve to exactly one valid result.
- Component interactions must match the stored guild, review channel, message, and
  nomination identifiers.
- Repeated interactions must remain idempotent.

## Failure And Recovery

### Role Assignment

- Preserve the current durable `granting` state.
- A failed role grant remains pending and is retried by the scheduled worker.
- A role failure must never automatically decline or expire the nomination.
- The nomination becomes approved only after Discord confirms the role operation.

### Review Card Synchronization

- Render every card update from fresh persisted nomination and vote state.
- Retry transient failures when updating terminal or role-pending cards.
- Every state or vote change increments the desired card revision.
- A worker marks a revision synchronized only when that same revision is still
  current after the Discord edit completes.
- If an older render reaches Discord after a newer state exists, the newer revision
  remains pending and must be rendered again. A stale worker must never clear the
  pending synchronization marker for a newer revision.
- Do not recreate a deleted review card automatically.
- Record and surface missing-card or repeated synchronization failures for manual
  repair.
- A card update failure must not reverse an approved, declined, or expired result.

## Permissions And Privacy

- `/nominate` remains guild-only and guild-install only.
- `/nominate` is accepted only from `#shell-society`.
- Voting is accepted only from current members of the configured Community Team
  role.
- Review messages are posted only in `#ct-general`.
- Nomination reasons must not be written to operational logs.
- Hermit sends no nomination-related public message beyond ephemeral command or
  component responses to the acting user.

## Observability

The nomination recovery service owns observability. Use the existing Cloudflare
Worker structured console logs; adding a separate alerting platform is out of scope.

Log these fields for every vote transition, role attempt, and card-sync attempt:

- Nomination ID.
- State transition.
- Approval and decline totals.
- Consecutive retry count.
- Pending duration in minutes.
- Discord response status.
- Desired and synchronized card revisions.

Emit warning or error logs when:

- A role grant or card synchronization fails.
- A nomination remains `granting` for at least 30 minutes.
- A card revision remains unsynchronized for at least 30 minutes.
- Either operation fails three consecutive times.
- Discord returns `404` for the stored review card.

Do not log nomination reasons.

## Product Decisions

These decisions are confirmed for implementation:

| ID | Status | Proposed decision |
|---|---|---|
| DEC-1 | confirmed | Any current Community Team member may vote, including the nominator or nominee when that person holds the Community Team role |
| DEC-2 | confirmed | A declined nomination may be submitted again immediately; no cooldown is added |
| DEC-3 | confirmed | Rollout uses a command freeze and zero-active-nomination gate immediately before merge, followed by a named smoke-only command exception while normal access remains frozen |
| DEC-4 | confirmed | The information-channel copy in this document is the initial production copy |

For DEC-3, a Discord administrator disables application-command use in both current
nomination source channels before merge. An authorized release owner then verifies
the remote database has zero `submitted` or `granting` nominations and records that
result in the pull request. The command remains frozen for normal users until the new
deployment passes its smoke test. For that test only, the administrator grants one
named nominator a temporary explicit command permission in `#shell-society`, either
directly or through a dedicated one-member smoke-test role. A separate consenting
nominee must not already hold the Shell Society role, and three named Community Team
members must be available to vote. The release owner records those five user IDs plus
the resulting nomination and review-message IDs in the pull request, then removes the
nominee's temporary Shell Society role and the smoke-only command permission before
normal command access is enabled.

## Delivery Plan

| ID | Workstream | Owner | Status | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|
| PRD-1 | Channel configuration | Bot implementation owner | complete | DEC-1 through DEC-4 | `/nominate` accepts only `#shell-society`; new review cards always post to `#ct-general`; the old nomination channel ID is removed from the command allowlist |
| PRD-2 | Schema and migration | Data implementation owner | complete | DEC-1 through DEC-4, PRD-1 | Add an online-compatible `0009` migration for vote choice, declined state, existing-approval conversion, uniqueness, measurable retry state, and monotonic card revisions without losing history |
| PRD-3 | Atomic voting | Data implementation owner | complete | PRD-2 | Same-vote clicks are idempotent, opposite votes switch, concurrent votes produce one first-to-three outcome, and late votes cannot mutate terminal nominations |
| PRD-4 | Carbon review UI | Discord UX implementation owner | complete | PRD-1, PRD-3 | Carbon v2 card shows both counts and two thumb controls across open, pending, approved, declined, and expired states; no welcome copy remains |
| PRD-5 | Role, card recovery, and logs | Nomination service owner | complete | PRD-2 through PRD-4 | Existing durable role retry remains intact; stale card writes cannot clear newer pending revisions; measurable Worker logs cover pending and failure thresholds |
| PRD-6 | Tests | Test owner | complete | PRD-1 through PRD-5 | Automated coverage proves routing, permissions, interaction binding, vote switching, threshold races, expiry races, `0009` migration, all card states, recovery, and absence of public Hermit messages |
| PRD-7 | Discord rollout preparation | Discord administrator | pending | DEC-3, DEC-4, PRD-6 | Create and permission the read-only information channel without publishing it; prepare its guide; document command-freeze, unfreeze, publication, and old-channel archival steps |
| PRD-8 | Pull request and production rollout | Release owner | in progress; rollout pending | DEC-1 through DEC-4, PRD-1 through PRD-7 | Implement on a feature branch, push that branch, open a PR, pass review and checks, freeze normal command access, prove zero active nominations, merge to `main`, let Cloudflare Builds deploy, run a controlled smoke test through one temporary named command exception, record the test identities and Discord evidence, remove the test role and command exception, then activate normal Discord access; never push implementation directly to `main` or manually deploy production |

## Implementation Verification

- `bun test`: 98 passed, 0 failed.
- `bun run typecheck`: passed.
- `bun run deploy:dry-run`: passed.
- `git diff --check`: passed.
- `bunx drizzle-kit check`: passed.
- Fresh local D1 migration application through `0009`: passed.

## Test Requirements

Automated coverage must include:

- Command accepted in `#shell-society`.
- Command rejected from every other channel, including both old and new
  `#nominate-users`.
- Review card posted to `#ct-general`.
- Self, bot, missing-member, existing-role, missing-reason, long-reason, and
  duplicate-active-nomination validation.
- Community Team authorization for both voting controls.
- One vote per reviewer.
- Same-vote idempotency.
- Vote switching in both directions.
- Three-approval and three-decline outcomes.
- Mixed votes that remain open.
- Concurrent opposing threshold attempts.
- Vote-versus-expiry races.
- No votes accepted after terminal or granting states.
- Role failure and scheduled recovery.
- Card synchronization failure and retry.
- Approved, declined, expired, and role-pending card rendering.
- Existing approval-row migration.
- Migration discovery updated so the nomination harness includes `0009` rather than
  stopping at `0008`.
- Active-nomination uniqueness after migration.
- Forged or replayed component interactions from the wrong guild, channel, message,
  or nomination are rejected without changing votes.
- Stale card synchronization cannot mark a newer revision synchronized.
- No nomination-related public Discord message calls from Hermit.

Validation commands:

```sh
bun test
bun run typecheck
bun run deploy:dry-run
git diff --check
```

## Rollout

1. Confirm the Product Decisions section.
2. Implement the PRD on a feature branch.
3. Apply and validate the migration against a representative local database,
   including a simulation where old code runs after `0009` is applied.
4. Run all required tests and type checks.
5. Push only the feature branch and open a pull request.
6. Review the migration, race handling, Discord permissions, and rendered Carbon
   components.
7. Create and permission the new read-only information channel, but do not publish
   the guide or archive the old channel yet.
8. Immediately before merge, a Discord administrator disables application-command
   use in `#shell-society` and the old `#nominate-users`.
9. With commands frozen, an authorized release owner verifies the remote database has
   zero `submitted` or `granting` nominations and records the result in the PR.
10. Merge the approved PR to `main`; allow Cloudflare Builds to apply the
    online-compatible migration and deploy the Worker.
11. Confirm the configured Cloudflare production build succeeds.
12. While normal command access remains frozen, designate and record:
    - One named nominator who receives a temporary explicit `/nominate` permission in
      `#shell-society`, either directly or through a dedicated one-member smoke-test role.
    - A separate consenting nominee who does not hold the Shell Society role.
    - Three named voters who currently hold the Community Team role.
13. Using only that temporary exception, submit a clearly labeled test nomination,
    complete the three-approval path, and verify the private terminal card and role
    assignment. Record the five user IDs plus the nomination and review-message IDs in
    the pull request. Retain the terminal test record for audit rather than deleting it.
14. Remove the Shell Society role granted to the test nominee. Remove the nominator's
    temporary command permission, dedicated smoke-test role, or role membership.
15. If the smoke test passes and cleanup is confirmed, enable normal
    application-command use in `#shell-society` only.
16. Publish the information-channel guide and archive the old nomination channel.
17. If the smoke test fails, remove the temporary role and command exception, keep
    normal commands frozen, and use a reviewed roll-forward fix.

## Rollback

- Keep `0009` additive and compatible with the old code during the migration-to-deploy
  window.
- Before the first new-model vote is accepted, application code may be reverted through
  a reviewed PR because the additive migration defaults remain readable by old code.
- After any approve or decline vote is stored under the new model, rollback to the
  previous approval-only application is prohibited. The previous code does not
  understand decline votes, the `declined` state, or card revisions.
- After new-model voting begins, freeze commands and roll forward through a reviewed
  repair PR. Do not attempt destructive data conversion during an incident.
- Do not manually deploy a rollback or repair; use the repository's reviewed `main`
  workflow.

## Completion Criteria

The redesign is complete only when:

1. Every delivery item is verified complete.
2. All automated validation passes without weakened tests.
3. The migration preserves existing nomination history.
4. Concurrency tests prove one terminal outcome per nomination.
5. Hermit grants approved roles durably and sends no public announcement.
6. The CT card remains the complete private audit record after every terminal outcome.
7. Discord operations are complete and documented.
8. The implementation is merged through a reviewed pull request and the Cloudflare
   production build succeeds.
