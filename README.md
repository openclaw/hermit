# Hermit (Cloudflare Worker)

Discord bot built with Carbon on Cloudflare Workers.

## Stack

- `@buape/carbon`
- Cloudflare Workers (`@buape/carbon/adapters/fetch`)
- Gateway plugin: `CloudflareGatewayPlugin` + `CloudflareGatewayDurableObject`
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

## Scripts

- `bun run dev` → `wrangler dev --env-file .env`
- `bun run deploy` → deploy worker
- `bun run cf-typegen` → regenerate `worker-configuration.d.ts`
- `bun run typecheck` → TypeScript check
- `bun run db:generate` → generate Drizzle SQL
- `bun run db:apply:local` / `db:apply:remote` → apply D1 migrations

## Notes

- Answer Overflow base URL is hardcoded to `https://www.answeroverflow.com`.
- Helper thread monitor runs via Worker cron (`wrangler.jsonc` `triggers.crons`).
