# Onboarding System Walkthrough

Step-by-step guide to validate the full onboarding pipeline in a test Discord server.

---

## 1. Prerequisites

### Discord Developer Portal
1. Go to https://discord.com/developers/applications and open your bot application.
2. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**.
3. Copy your **Bot Token** and **Application (Client) ID**.

### Test Server Setup

Create (or use) a private Discord server and set up these items:

**Roles** (create all, copy each role ID via right-click → Copy Role ID):
| Role | Purpose |
|------|---------|
| `Community Staff` | Umbrella role granted on promotion |
| `Discord Mod Trial` | Trial role for the `discord_mod` team |
| `Discord Mod` | Full role for the `discord_mod` team |

**Channels** (copy channel IDs via right-click → Copy Channel ID):
| Channel | Purpose |
|---------|---------|
| `#announcements` | Public promotion announcements |
| `#mod-log` | Private staff audit log |
| `#discord-mod-team` | Team review/vote channel |

**Bot permissions** — when inviting the bot, ensure it has:
- Manage Roles
- Send Messages
- Read Message History
- View Channels (on all the above channels)

---

## 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
```

Start the bot:
```bash
bun dev
```

You should see the bot come online in your test server. Wait for slash commands to register (up to ~1 minute on first run).

---

## 3. Initial Configuration

Run these slash commands in your test server. Use your own user ID as the lead for testing.

### Global config
```
/onboarding-config set
  communityStaffRoleId: <Community Staff role ID>
  publicAnnouncementChannelId: <#announcements channel ID>
  modLogChannelId: <#mod-log channel ID>
```

### Team config — use shortened timeouts so you don't wait days
```
/team-config set team:discord_mod
  channelId: <#discord-mod-team channel ID>
  leadUserId: <your Discord user ID>
  trialRoleId: <Discord Mod Trial role ID>
  fullRoleId: <Discord Mod role ID>
  trialDurationDays: 0
  voteWindowHours: 0
  leadApprovalTimeoutDays: 0
```

> **Why zero?** The scheduler checks every 5–15 minutes. Setting durations to 0 means the windows expire immediately, so the scheduler resolves them on the very next tick rather than after days.

Verify config was saved:
```
/onboarding-config get
/team-config get team:discord_mod
```

---

## 4. Happy Path Walkthrough

You'll need two Discord accounts: **Lead** (you) and **Candidate** (alt account or a friend).

---

### Step 1 — Start Onboarding
As the **Lead**, run:
```
/onboard-start user:@Candidate team:discord_mod
```

**Expected:**
- Ephemeral reply: "Onboarding invitation sent to @Candidate…"
- **Candidate** receives a DM with an "Open Application Form" button
- `audit_logs` gets an `ONBOARD_START` entry

---

### Step 2 — Submit the Application Form
As the **Candidate**, open the DM and click **"Open Application Form"**.

**Expected:**
- A modal appears with three fields: Timezone, Availability, Motivation
- Fill in the fields and submit

**Expected after submit:**
- Candidate receives a DM: "Your application is under review…"
- `#discord-mod-team` channel receives a review message with **Approve** and **Deny** buttons
- Application status → `APPLICATION_PENDING_REVIEW`

---

### Step 3 — Approve the Application
As the **Lead** (or any full team member), click **Approve** in `#discord-mod-team`.

> Approval requires 2 full members OR 1 Team Lead. Since you are the lead, one click is enough.

**Expected:**
- Candidate receives the `Discord Mod Trial` role
- Candidate receives a DM: "Your application has been approved! Your trial period has started…"
- Application status → `TRIAL_ACTIVE`
- `trials` table gets an `ACTIVE` row

---

### Step 4 — Wait for Trial Expiry (scheduler)
Since `trialDurationDays` is set to `0`, the trial is already expired. The scheduler runs every **5 minutes** — wait for the next tick.

**Expected:**
- Application status → `AWAITING_TEAM_VOTE`
- A vote message appears in `#discord-mod-team` with **Approve** and **Deny** buttons
- Candidate receives a DM notifying them the vote has started

---

### Step 5 — Vote to Promote
As the **Lead** (or any full member), click **Approve** on the vote message in `#discord-mod-team`.

**Expected:**
- Vote is recorded in `promotion_votes`
- Since `voteWindowHours` is `0`, the vote window is already expired — wait for the scheduler (up to 5 min)

**After scheduler runs:**
- Application status → `AWAITING_LEAD_APPROVAL`
- Lead receives a notification in `#discord-mod-team` to run `/promote` or `/deny`
- Candidate receives a DM: "The team has voted to promote you!"

---

### Step 6a — Lead Approves (manual)
As the **Lead**, run:
```
/promote user:@Candidate
```

**Expected:**
- Candidate receives `Discord Mod` (full) role
- Candidate receives `Community Staff` role
- `Discord Mod Trial` role is removed
- Public announcement in `#announcements`: "Please welcome @Candidate to the discord_mod team!"
- Application status → `PROMOTED_BY_LEAD`

---

### Step 6b — Lead Times Out (auto-promote)
Alternatively, skip `/promote` and wait for the scheduler (up to 15 min, since `leadApprovalTimeoutDays` is `0`).

**Expected:**
- Same role changes as 6a
- Application status → `PROMOTED_BY_LEAD_INACTION`
- Note in `#discord-mod-team` that the lead did not respond

---

## 5. Edge Case Checklist

| Scenario | How to test |
|----------|------------|
| **Deny at review** | Click Deny on the review message in step 3 → status `APPLICATION_DENIED`, candidate DM'd |
| **Deny at lead approval** | Run `/deny user:@Candidate` in step 6 → status `DENIED_BY_LEAD` |
| **Vote fails** | In step 5, click Deny instead of Approve → after scheduler: status `VOTE_FAILED`, trial role removed |
| **Candidate leaves server** | While status is `TRIAL_ACTIVE`, have the candidate leave → status `TRIAL_FAILED` (immediate via `GuildMemberRemove` event) |
| **Cooldown enforcement** | After a denial, immediately try `/onboard-start` again for the same user → should be blocked with "in cooldown" message |
| **Tenure check** | Try `/onboard-start` on a brand-new account that joined < 14 days ago → should be blocked with "server tenure" message |
| **Non-lead blocked** | Have a non-lead run `/onboard-start` → should be rejected immediately |

---

## 6. Verifying the Database

While the bot is running you can inspect the SQLite file directly:

```bash
# Open the database
sqlite3 data/hermit.sqlite

# Check all applications
SELECT id, user_id, team, status, created_at FROM applications;

# Check audit trail for an application
SELECT actor_id, action, details, created_at FROM audit_logs WHERE application_id = '<id>';

# Check votes
SELECT voter_id, vote FROM promotion_votes WHERE application_id = '<id>';

# Check trials
SELECT user_id, status, start_time, end_time FROM trials;
```

---

## 7. Restore Normal Timeouts

Once validation is complete, restore production values:
```
/team-config set team:discord_mod
  trialDurationDays: 7
  voteWindowHours: 48
  leadApprovalTimeoutDays: 7
```
