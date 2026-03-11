# Hermit

Hermit is the OpenClaw Discord bot built on [Carbon](https://carbon.buape.com), Bun, and SQLite.

It handles:

- Discord slash commands and message-context moderation actions
- helper-thread onboarding and thread-length enforcement
- keyword-based automod responses
- announcement crossposting for selected channels
- local event and helper-thread state persistence in SQLite
- a read-only local dashboard for helper events and tracked threads

Repository: [openclaw/hermit](https://github.com/openclaw/hermit)

## Runtime Overview

Hermit runs as a gateway-first Discord bot:

- Bun is the runtime and package manager
- Carbon handles command registration, gateway events, and Discord API access
- Drizzle manages the SQLite schema and migrations
- SQLite stores helper event history and tracked helper thread state
- A small Bun HTTP server exposes read-only operational visibility

Main entrypoint: [src/index.ts](src/index.ts)

## Features

- `/github` looks up GitHub issues and pull requests
- `Solved (Mod)` marks a thread as solved in Answer Overflow and closes it
- `/say ...` posts common guidance and documentation links
- `/helper ...` posts helper-thread moderation messages and closes threads
- `/role ...` toggles specific server roles
- helper-thread creation triggers a welcome message and thread tracking
- a background monitor warns on long threads and auto-closes very long ones
- automod rules can repost/redact matching messages and send guidance replies
- selected announcement channels are auto-crossposted

## Requirements

- Bun
- a Discord application and bot token
- access to the target Discord server
- SQLite filesystem access for `DB_PATH`

## Installation

1. Install dependencies:

```bash
bun install
```

2. Create a `.env` file.

Recommended variables:

```env
DISCORD_CLIENT_ID="your-client-id"
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_DEV_GUILDS="guild_id_1,guild_id_2"

ANSWER_OVERFLOW_API_KEY="your-answer-overflow-api-key"
ANSWER_OVERFLOW_API_BASE_URL="https://www.answeroverflow.com"

HELPER_THREAD_WELCOME_PARENT_ID="123456789012345678"
HELPER_THREAD_WELCOME_TEMPLATE="Welcome to helpers. Please include expected vs actual behavior, what you already tried, and relevant logs/code."
THREAD_LENGTH_CHECK_INTERVAL_HOURS="2"

DB_PATH="data/hermit.sqlite"
DRIZZLE_MIGRATIONS="drizzle"

HELPER_LOGS_HOST="127.0.0.1"
HELPER_LOGS_PORT="8787"
```

3. Apply migrations:

```bash
bun run db:migrate
```

4. Start Hermit:

```bash
bun run dev
```

## Scripts

- `bun run dev` starts Hermit in watch mode
- `bun run start` starts Hermit normally
- `bun run typecheck` runs TypeScript without emitting files
- `bun run db:migrate` applies Drizzle migrations to SQLite
- `bun run db:generate` generates Drizzle migration files from the schema

## Environment Variables

### Required

- `DISCORD_CLIENT_ID`: Discord application client ID
- `DISCORD_BOT_TOKEN`: Discord bot token

### Optional

- `DISCORD_DEV_GUILDS`: comma-separated guild IDs for dev command registration
- `ANSWER_OVERFLOW_API_KEY`: required for `Solved (Mod)` to call Answer Overflow
- `ANSWER_OVERFLOW_API_BASE_URL`: defaults to `https://www.answeroverflow.com`
- `HELPER_THREAD_WELCOME_PARENT_ID`: parent forum or helper channel whose new threads should receive the welcome message
- `HELPER_THREAD_WELCOME_TEMPLATE`: overrides the default helper welcome text
- `THREAD_LENGTH_CHECK_INTERVAL_HOURS`: enables the helper thread monitor when set to a positive number
- `DB_PATH`: SQLite database path, defaults to `data/hermit.sqlite`
- `DRIZZLE_MIGRATIONS`: migration directory, defaults to `drizzle`
- `HELPER_LOGS_HOST`: host for the read-only helper dashboard, defaults to `127.0.0.1`
- `HELPER_LOGS_PORT`: port for the read-only helper dashboard, defaults to `8787`; set to `0` to disable it
- `SKIP_DB_MIGRATIONS`: set to `1` to skip automatic migration-on-startup

## Commands

### `/github`

Looks up a GitHub issue or pull request and returns:

- title and state
- repo and author
- labels
- description summary
- recent comments
- pull request change stats when applicable

Options:

- `number` required
- `user` optional, defaults to `openclaw`
- `repo` optional, defaults to `hermit`

Available in:

- guilds
- bot DMs

Source: [src/commands/github.ts](src/commands/github.ts)

### `Solved (Mod)`

Message-context moderation action that:

- posts the chosen solution message to Answer Overflow
- adds a checkmark reaction to the solved message
- archives and locks the thread
- records a `mark_solution` helper event in SQLite

Permissions:

- `ManageMessages`
- `ManageThreads`

Requires:

- `ANSWER_OVERFLOW_API_KEY`

Source: [src/commands/solvedMod.ts](src/commands/solvedMod.ts)

### `/say`

Posts common canned guidance messages.

Subcommands:

- `guide`
- `server-faq`
- `help`
- `user-help`
- `model`
- `stuck`
- `ci`
- `answeroverflow`
- `pinging`
- `docs`
- `security`
- `install`
- `blog-rename`

Available in:

- guilds
- bot DMs

Source: [src/commands/say.ts](src/commands/say.ts)

### `/helper`

Helper-channel moderation utilities.

Subcommands:

- `warn-new-thread`: posts the long-thread warning message
- `close`: posts the close message, archives the thread, and locks it
- `close-thread`: same behavior as `close`

These commands also emit helper events into SQLite.

Source: [src/commands/helper.ts](src/commands/helper.ts)

### `/role`

Toggles specific hard-coded server roles.

Current subcommands:

- `showcase-ban`
- `clawtributor`

Permissions:

- command requires `ManageRoles`
- runtime access also checks that the invoking member has the hard-coded `communityStaff` role

Source: [src/commands/role.ts](src/commands/role.ts)

## Gateway Events And Background Behavior

### Ready

On startup, Hermit logs the connected username and starts the helper thread monitor when configured.

Source: [src/events/ready.ts](src/events/ready.ts)

### Thread Create Welcome

When a new thread is created under `HELPER_THREAD_WELCOME_PARENT_ID`, Hermit:

- stores the thread in `tracked_threads`
- records a `thread_welcome_created` event
- posts the helper welcome message

Source: [src/events/threadCreateWelcome.ts](src/events/threadCreateWelcome.ts)

### Thread Length Monitor

When `THREAD_LENGTH_CHECK_INTERVAL_HOURS` is set, Hermit polls tracked helper threads with `setInterval`.

Behavior:

- loads open tracked threads from SQLite
- fetches the Discord thread live
- updates message counts and close state
- warns at more than `100` messages
- warns again at more than `150` messages
- posts a close notice and archives/locks at more than `200` messages

Configured messages live in:

- [src/config/threadLengthMessages.ts](src/config/threadLengthMessages.ts)

Source: [src/services/threadLengthMonitor.ts](src/services/threadLengthMonitor.ts)

### AutoModeration Action Execution

Hermit listens to automod keyword actions and can:

- repost the triggering content through a webhook
- redact the matched trigger in the repost
- send a follow-up warning/guidance message
- optionally include a role mention in the guidance message

Automod rule configuration lives in:

- [src/config/automod-messages.json](src/config/automod-messages.json)

Message template placeholders:

- `{user}`
- `{keyword}`
- `{content}`

Source: [src/events/autoModerationActionExecution.ts](src/events/autoModerationActionExecution.ts)

### Auto Publish Message Create

Hermit auto-crossposts messages from a fixed set of announcement channel IDs.

Source: [src/events/autoPublishMessageCreate.ts](src/events/autoPublishMessageCreate.ts)

## Database

Hermit uses SQLite via Bun and Drizzle.

Database bootstrap: [src/db.ts](src/db.ts)

Schema definition: [src/db/schema.ts](src/db/schema.ts)

### Tables

#### `keyValue`

Generic key/value storage with:

- `key`
- `value`
- `createdAt`
- `updatedAt`

#### `helper_events`

Operational event log for helper-related actions.

Fields:

- `id`
- `event_type`
- `thread_id`
- `message_count`
- `event_time`
- `command`
- `invoked_by_id`
- `invoked_by_username`
- `invoked_by_global_name`
- `received_at`
- `raw_payload`

Typical event types:

- `mark_solution`
- `helper_command`
- `thread_welcome_created`

#### `tracked_threads`

Persistent helper-thread state used by the monitor.

Fields:

- `id`
- `thread_id`
- `created_at`
- `last_checked`
- `solved`
- `warning_level`
- `closed`
- `last_message_count`
- `received_at`
- `raw_payload`

## Migrations

Drizzle configuration: [drizzle.config.ts](drizzle.config.ts)

Migration runner: [src/scripts/migrate.ts](src/scripts/migrate.ts)

Committed SQL migrations live under:

- [drizzle/](drizzle)

On startup, Hermit automatically applies migrations unless `SKIP_DB_MIGRATIONS=1`.

## Read-Only Helper Logs HTTP Server

Hermit starts a small Bun HTTP server for local visibility into helper activity.

Default address:

- `http://127.0.0.1:8787`

Routes:

- `GET /`: dashboard UI for helper events
- `GET /api/events`: JSON event listing
- `GET /api/threads`: JSON tracked-thread listing

Supported `GET /api/events` query params:

- `eventType`
- `command`
- `threadId`
- `invokedBy`
- `from`
- `to`
- `limit` up to `500`

Supported `GET /api/threads` query params:

- `threadId`
- `solved`
- `closed`
- `limit` up to `500`

Source: [src/server/helperLogsServer.ts](src/server/helperLogsServer.ts)

## Configuration Files

- [src/config/automod-messages.json](src/config/automod-messages.json): automod trigger-to-response mapping
- [src/config/threadLengthMessages.ts](src/config/threadLengthMessages.ts): warning and auto-close helper thread messages

## Development Notes

- Hermit is Bun-first; `package-lock.json` is intentionally not used
- command registration and gateway listeners are wired in [src/index.ts](src/index.ts)
- helper events and tracked-thread writes are internal; the HTTP server is read-only
- the thread-length scheduler is interval-based, not cron-based

## Verification

Useful local checks:

```bash
bun run typecheck
bun run db:migrate
bun run dev
```

## License

MIT
