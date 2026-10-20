# Hermit (Cloudflare Worker)

Discord bot built with Carbon on Cloudflare Workers.

## Stack

- `@buape/carbon`
- Cloudflare Workers (`@buape/carbon/adapters/fetch`)
- Gateway forwarding: `forwarder/` Bun process using `GatewayForwarderPlugin`
- Cloudflare D1 + Drizzle ORM

## Setup

Use Bun 1.4.2 and Node.js 22.22.0 or later for the build tools (CI uses Node.js 24).

1. Install deps:

```bash
bun install
```

2. Create `.env` from `.env.example`.

Required:

```env
BASE_URL=
DEPLOY_SECRET=
DISCORD_CLIENT_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
```

Optional:

```env
DISCORD_DEV_GUILDS=
FORWARDER_PUBLIC_KEY=
ANSWER_OVERFLOW_API_KEY=
HELPER_THREAD_WELCOME_PARENT_ID=
HELPER_THREAD_WELCOME_TEMPLATE=
THREAD_LENGTH_CHECK_INTERVAL_HOURS=
```

`/say help` directs setup, usage, and troubleshooting questions to [Get support](https://community.openclaw.ai/), the official OpenClaw support pathway. Discord remains available for social conversation, collaboration, and existing helper assistance; development bugs, security reports, and moderation matters keep their separate routes.

When `HELPER_THREAD_WELCOME_PARENT_ID` enables helper-thread welcomes, the welcome always includes the official support route. `HELPER_THREAD_WELCOME_TEMPLATE` customizes the introduction, but the support link and log-redaction reminder are appended even when that override is set. If the combined text exceeds Discord’s 4,000-character message budget, the support reminder is sent separately to preserve valid custom welcomes. Blank overrides use the default helper welcome. No environment changes are required for the updated routing.

3. Configure `wrangler.jsonc` D1 binding:

- set `d1_databases[0].database_id` to your real D1 database id
- keep `binding = "DB"`

4. Apply D1 migrations:

```bash
bun run db:apply:local
# or
bun run db:apply:remote
```

5. Run locally:

```bash
bun run dev
```

After the first Worker deployment, register the Discord commands with
`bun run commands:deploy` using the same bot credentials.

## Helper logs API

`GET /api/events` and `GET /api/threads` require `Authorization: Bearer <DEPLOY_SECRET>`. Update any scripts consuming these endpoints to send that header. Missing or incorrect credentials return HTTP 401; the endpoints also reject requests when `DEPLOY_SECRET` is unset.

The HTML index at `/` remains public and contains only endpoint links and filter documentation.

## Form review notifications

Configure forms in `forms.config.ts`. `reviewRoleId` controls who can accept or deny submissions; optional `reviewPingRoleId` selects the role notified on new submissions and defaults to `reviewRoleId`.

Discord and GitHub appeals plus moderator reports notify `1546936406272778271`, while Community Team (`1477360613125787678`) retains review access. ClawHub notifications and review access use `1509967254870298794`.

## Scripts

- `bun run dev` → `wrangler dev --env-file .env`
- `bun run deploy` → deploy worker locally with `.env`
- `bun run deploy:cf` → apply remote D1 migrations, then deploy Worker for Cloudflare Builds
- `bun run deploy:dry-run` → validate the Worker bundle without deploying
- `bun run commands:deploy` → explicitly register Discord commands using the configured bot credentials
- `bun run cf-typegen` → regenerate `worker-configuration.d.ts`
- `bun run typecheck` → TypeScript check
- `bun run test` → generate Forms styles, then run the test suite (requires ImageMagick and the WebP CLI tools)
- `bun run db:generate` → generate Drizzle SQL
- `bun run db:apply:local` / `db:apply:remote` → apply D1 migrations

## CI/CD

GitHub Actions runs frozen installs and typechecks for both Bun packages, a Worker dry-run build, and the full test suite on pull requests and pushes to `main`. These checks share one Ubuntu job with a 20-minute timeout; CI installs ImageMagick 7 and the WebP tools needed by the artwork tests. The workflow does not deploy or require deployment secrets.

Cloudflare Workers Builds deploys pushes to `main`. The deploy command should apply D1 migrations before deploying the Worker:

```bash
bun run deploy:cf
```

After the first deployment and whenever command definitions change, the release
operator registers them once from the deployed revision with the existing Discord
credentials in their local `.env` or environment:

```bash
bun run commands:deploy
```

Ordinary Worker requests and cron events no longer register commands automatically.
The existing secret-protected `/deploy` endpoint remains an explicit registration
alternative. Carbon's reconcile mode avoids rewriting unchanged global commands,
but still overwrites guild commands; running registration in each Worker isolate
can exhaust Discord's rate limit.
Ordinary Worker deployments without command changes do not need this step.

Drizzle only generates SQL migrations. Wrangler applies them to D1:

```bash
bun run db:generate
bun run db:apply:remote
```

## Shell Society retirement

This revision removes Shell Society nomination intake, voting buttons, expiry,
role grants, card recovery and the nomination-only 15-minute cron. Barnacle is the
destination for that workflow; its existing role welcome remains the welcome owner.
Social commands retain their original guild through `src/config/guild.ts`.

The D1 `nominations` and `nomination_approvals` tables and original migrations are
historical data, not active services. Their definitions live in
`src/db/archived-society.ts`, used only by Drizzle schema generation to prevent a
future migration from dropping history. The Worker does not import that archive.

Before production removal, retire nomination entry and drain `submitted` and
`granting` work, preserve a consistent export, and record the owner handoff to
Barnacle. Explicit command registration must remove Hermit's old command after
the Worker revision is deployed. Retain original review history; do not delete
tables or replay old role grants. A source commit alone does not verify the live
handoff or remove Discord registrations.

## Reddit moderation retirement

Reddit ban appeals, Reddit OAuth (including moderator report sign-in), and the
Devvit context/unban bridge have been removed. Existing Reddit review buttons
cannot accept or deny appeals after this revision is deployed.

Existing form submissions and the D1 `reddit_moderation_contexts` table remain
historical data. Its schema lives in `src/db/archived-reddit.ts`, used only by
Drizzle generation to preserve history; the Worker does not import it. Original
migrations remain unchanged. Reddit OAuth and Devvit environment variables are
no longer used.

## Clawtributor claim review

If saving a rejection fails, Hermit does not notify the applicant and restores the review buttons for another attempt. If Discord also rejects the message update, the reviewer receives an error explaining that the review could not be reopened automatically and needs moderator recovery.

## Gateway forwarder

The main bot runs as a Cloudflare Worker. Gateway events are forwarded by the Bun app in `forwarder/`, usually running on Krill's machine.

Forwarder setup:

```bash
cd forwarder
bun install
bun run dev
```

Forwarder production start:

```bash
cd forwarder
bun run start
```

Forwarder env:

```env
BASE_URL=
DEPLOY_SECRET=
DISCORD_CLIENT_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
FORWARDER_PRIVATE_KEY=
```

The Worker must have the matching public key:

```bash
bunx wrangler secret put FORWARDER_PUBLIC_KEY
```

## Automod webhooks

Concurrent automod events in the same Worker instance share the channel webhook lookup and creation. Failed attempts are cleared so a later event can retry; successful webhooks retain the existing 15-minute cache. Separate Worker instances still manage their own caches.

## Notes

- Answer Overflow base URL is hardcoded to `https://www.answeroverflow.com`.
- Helper thread monitor runs via Worker cron (`wrangler.jsonc` `triggers.crons`).
- The old Cloudflare Gateway Durable Object path is not the active gateway setup.

## ClawHub ban appeals

Appeal submissions keep only configured input fields; account and moderation context comes from the signed-in GitHub account. Before accepting an appeal, Hermit rechecks that its stored ClawHub account ID still belongs to that GitHub applicant. This also protects pending appeals submitted before intake validation was added. A missing or mismatched binding leaves the appeal pending without sending an unban request; ask the applicant to submit a new appeal. A temporary ClawHub lookup failure can be retried.

## GitHub summaries

GitHub summary requests accept repository names made from letters, digits, dots, underscores, and hyphens, excluding `.` and `..`. Path separators, URL escapes, query strings, and fragments are rejected before authentication or a GitHub request. Valid repositories retain the configured GitHub App installation authentication, with the existing anonymous fallback when no token is available.

GitHub App authentication accepts both the PKCS#1 (`BEGIN RSA PRIVATE KEY`) key downloaded from GitHub and PKCS#8 (`BEGIN PRIVATE KEY`) PEM keys in `GITHUB_APP_PRIVATE_KEY`. Configure it together with `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID`.
