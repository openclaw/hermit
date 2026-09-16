# Hermit (Cloudflare Worker)

Discord bot built with Carbon on Cloudflare Workers.

## Stack

- `@buape/carbon`
- Cloudflare Workers (`@buape/carbon/adapters/fetch`)
- Gateway forwarding: `forwarder/` Bun process using `GatewayForwarderPlugin`
- Cloudflare D1 + Drizzle ORM

## Setup

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

## Helper logs API

`GET /api/events` and `GET /api/threads` require `Authorization: Bearer <DEPLOY_SECRET>`. Update any scripts consuming these endpoints to send that header. Missing or incorrect credentials return HTTP 401; the endpoints also reject requests when `DEPLOY_SECRET` is unset.

The HTML index at `/` remains public and contains only endpoint links and filter documentation.

## Form review notifications

Configure forms in `forms.config.ts`. `reviewRoleId` controls who can accept or deny submissions; optional `reviewPingRoleId` selects the role notified on new submissions and defaults to `reviewRoleId`.

Discord, GitHub, and Reddit appeals plus moderator reports notify `1546936406272778271`, while Community Team (`1477360613125787678`) retains review access. ClawHub notifications and review access use `1509967254870298794`.

## Scripts

- `bun run dev` → `wrangler dev --env-file .env`
- `bun run deploy` → deploy worker locally with `.env`
- `bun run deploy:cf` → apply remote D1 migrations, then deploy Worker for Cloudflare Builds
- `bun run deploy:dry-run` → validate the Worker bundle without deploying
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

Drizzle only generates SQL migrations. Wrangler applies them to D1:

```bash
bun run db:generate
bun run db:apply:remote
```

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

## Notes

- Answer Overflow base URL is hardcoded to `https://www.answeroverflow.com`.
- Helper thread monitor runs via Worker cron (`wrangler.jsonc` `triggers.crons`).
- The old Cloudflare Gateway Durable Object path is not the active gateway setup.

## ClawHub ban appeals

Appeal submissions keep only configured input fields; account and moderation context comes from the signed-in GitHub account. Before accepting an appeal, Hermit rechecks that its stored ClawHub account ID still belongs to that GitHub applicant. This also protects pending appeals submitted before intake validation was added. A missing or mismatched binding leaves the appeal pending without sending an unban request; ask the applicant to submit a new appeal. A temporary ClawHub lookup failure can be retried.

## GitHub summaries

GitHub summary requests accept repository names made from letters, digits, dots, underscores, and hyphens, excluding `.` and `..`. Path separators, URL escapes, query strings, and fragments are rejected before authentication or a GitHub request. Valid repositories retain the configured GitHub App installation authentication, with the existing anonymous fallback when no token is available.
