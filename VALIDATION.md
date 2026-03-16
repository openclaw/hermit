# Basic Validation Guide

These tests cover the core onboarding flow end-to-end. Run them in order.

---

## Prerequisites

- Bot is running (`bun run dev`)
- You have two Discord accounts: one as **Team Lead**, one as the **candidate**
- At least one team is fully configured via `/team-config set`
- Candidate account has been in the server for 14+ days (or temporarily set `minServerTenureDays` to 0 via `/onboarding-config set`)

---

## Test 1 — Start onboarding

**Run as Team Lead:**
```
/onboard-start user:@candidate team:discord_mod
```

**Expect:**
- Ephemeral reply: "Invite sent to @candidate"
- Candidate receives a DM with an "Open Application Form" button
- DB: one row in `applications` with `status = FORM_SENT`

---

## Test 2 — Submit the application form

**As the candidate**, click "Open Application Form" in the DM.

**Expect:**
- A modal appears with three fields: Timezone, Availability, Motivation
- Fill them in and submit

**Expect after submit:**
- DB: application row updated to `status = APPLICATION_PENDING_REVIEW`, form fields populated
- Team channel receives a review embed with **Approve** and **Deny** buttons

---

## Test 3 — Deny the application

**As a full team member**, click **Deny** on the review embed.

**Expect:**
- Candidate receives a DM: application not approved, reapply after N days
- Team channel review embed updated to show denied state
- DB: `status = APPLICATION_DENIED`, `denied_by` populated

---

## Test 4 — Approve the application (2-member path)

Re-run Test 1 and Test 2 with a fresh candidate account, then:

**As full team member #1**, click **Approve**.

**Expect:**
- Ephemeral acknowledgement: "1/2 approvals received"
- DB: `approved_by` has one entry, status still `APPLICATION_PENDING_REVIEW`

**As full team member #2**, click **Approve**.

**Expect:**
- Candidate receives a DM: application approved, now a Trial member
- Candidate is granted the trial role in Discord
- DB: `status = TRIAL_ACTIVE`, a row created in `trials`
- Mod log receives a notification

---

## Test 5 — Member leaves during trial

With the candidate in `TRIAL_ACTIVE`, have the candidate leave the server.

**Expect:**
- DB: `status = TRIAL_FAILED`, trial row updated to `status = FAILED`
- Mod log receives a notification

---

## Test 6 — Auto-reject (tenure check)

Use a fresh account that joined less than 14 days ago as the candidate.

**Run as Team Lead:**
```
/onboard-start user:@new-candidate team:discord_mod
```

Candidate clicks the DM button and submits the form.

**Expect:**
- Candidate receives a DM explaining they don't meet the tenure requirement
- DB: `status = APPLICATION_DENIED`
- Nothing posted to team channel

---

## Shortcut: Bypass tenure for testing

```
/onboarding-config set minServerTenureDays:0
```

Remember to set it back after:
```
/onboarding-config set minServerTenureDays:14
```
