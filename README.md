# hermit

A Discord bot built with [Carbon](https://carbon.buape.com).

Repository: https://github.com/openclaw/hermit

## Setup

### 1. Discord Developer Portal

Go to your application → **Bot** → **Privileged Gateway Intents** and enable:

- ✅ **Server Members Intent**
- ✅ **Message Content Intent**

### 2. Environment Variables

Create a `.env` file:
```env
BASE_URL="your-base-url"
DEPLOY_SECRET="your-deploy-secret"
DISCORD_CLIENT_ID="your-client-id"
DISCORD_PUBLIC_KEY="discord-public-key"
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_DEV_GUILDS="guild-id-1,guild-id-2"  # optional: dev guild IDs for faster command deployment
```

### 3. Invite the Bot to Your Server

1. Go to your app → **OAuth2 → URL Generator**
2. Under **Scopes** check: `bot`, `applications.commands`
3. Under **Bot Permissions** check: `Manage Roles`, `Send Messages`, `Read Message History`, `Manage Messages`
4. Copy the generated URL, open it in your browser, and authorize it to your server

### 4. Install and Run

```bash
bun install
bun run dev    # development (hot reload)
bun run start  # production
```

The SQLite database is created automatically at `data/hermit.sqlite` on first start. Override the path with the `DB_PATH` env var.

### 4. Configure the Onboarding System

After the bot is running, use these slash commands to configure the onboarding pipeline:

```
/onboarding-config set communityStaffRoleId:<id>
/onboarding-config set publicAnnouncementChannelId:<id>
/onboarding-config set modLogChannelId:<id>
```

For each team (`discord_mod`, `vc_mod`, `helper`, `configurator`):

```
/team-config set --team <team> channelId:<id>
/team-config set --team <team> leadUserId:<id>
/team-config set --team <team> trialRoleId:<id>
/team-config set --team <team> fullRoleId:<id>
```

## Commands

- `/github` - Look up an issue or PR (defaults to openclaw/hermit)

## Gateway Events

The bot listens for the following Gateway events:
- AutoModeration Action Execution - Sends keyword-based responses

## AutoMod Responses

Edit `src/config/automod-messages.json` to map keywords to messages. Use `{user}` to mention the triggering user.

## License

MIT