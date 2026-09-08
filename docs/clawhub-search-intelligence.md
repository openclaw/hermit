# ClawHub weekly search intelligence receiver

Companion to [CLAW-768](https://linear.app/my-openclaw/issue/CLAW-768) under
[CLAW-724](https://linear.app/my-openclaw/issue/CLAW-724).

## Boundary and ownership

`POST /api/clawhub-search-intelligence/weekly` accepts ClawHub's frozen
`plugin_search_weekly` digest. It uses the existing `CLAWHUB_HERMIT_TOKEN`
(fallback `CLAWHUB_BAN_APPEALS_TOKEN`) and `CLAWHUB_SITE_URL` trusted-origin
configuration. Destination is `formSettings.clawhubAppealReviewChannelId`, the
`maintainer-clawhub` channel. No role or user is mentioned.

ClawHub owns query normalization, aggregate privacy thresholds, authoritative
`isOfficial === true` gap calculations, enrichment/classification, UTC week
selection, and the Monday 09:00 America/Los_Angeles schedule. Hermit validates and
delivers facts; it never classifies a query or assigns official status.

The request has a 64 KiB streaming byte limit and exact recursive field
allowlists. Digest source counts use `clawhubWeb` / `openclawControlUi` keys (the
observation source enum remains hyphenated in ClawHub). Counts are nonnegative
safe integers and source counts must sum to the total. Rows are capped at five
per section; query text at 256 UTF-16 code units, company/display names at 120,
package names at 160, and same-origin credential-free HTTP(S) links at 2048.
All ordinary rows require current-week searches >= 3; gap/company rows also
require official gaps >= 3. Movers require at least three searches in either
whole week, including drops to zero. Rare-in-both-weeks movers are suppressed.
The company confidence floor is 0.8. No extra user/device/session/request fields
are accepted, retained, or logged.

Coverage is required: `dataThrough`, `collectionStartedAt`, `gapStart`, `gapEnd`
are nullable timestamps, with gap endpoints paired. The message identifies
unknown/partial collection history, explicit gaps, unavailable enrichment, and
capped input. Empty initial history is not described as a complete-week total.

Carbon V2 `Container` / `TextDisplay` components carry all content. The message
stays below 4000 text characters; whole rows that do not fit are replaced by a
dashboard pointer, never cut links or Markdown. Text is escaped, mentions are
neutralized, and `allowed_mentions.parse` is empty. A localhost trusted dashboard
origin produces a visible **LOCAL PREVIEW** heading.

## Delivery state and failure semantics

No migration is needed. The existing D1 `keyValue` primary key stores one receipt
per trusted origin and UTC week. The record contains a version, canonical digest
hash, delivery status, start timestamp, and confirmed Discord message ID; it
contains no query text. Reads use a `first-primary` D1 session. Atomic
`INSERT ... ON CONFLICT DO NOTHING RETURNING` and compare-and-swap updates fence
concurrent requests and freeze the weekly payload.

| State / event | Receiver behavior |
| --- | --- |
| First request | Claim durably **before** Discord POST. |
| Concurrent fresh claim | HTTP 409, no additional POST. |
| Confirmed receipt | HTTP 200 `{ok:true, delivered:true, weekEnd}`; no additional POST, even after the sender loses its HTTP response. |
| Changed payload for the same week | HTTP 409, no POST. |
| Explicit Discord 4xx rejection, excluding 408 | Persist retryable state; HTTP 502. A subsequent request may atomically claim another attempt. |
| Timeout, network/5xx failure, or malformed success | Persist uncertainty; HTTP 503, never blindly repost. |
| Crash after POST / failed receipt save | The durable sending claim remains. After two minutes, retries reconcile channel history read-only. |
| Uncertain/stale claim, matching bot message found | Compare expected component text, configured bot author, and send time; persist its ID and return success. |
| History missing, inaccessible, truncated, or unmatched | HTTP 503; no POST. Requires operational reconciliation, not clearing the weekly key and retrying. |
| D1 claim/write unavailable | Non-2xx; no success claim without a persisted receipt. |

History reconciliation scans at most five pages of 100 messages, ignores messages
older than the claim (with a one-minute clock allowance), and rejects copies from
other authors. The service needs channel View/Read Message History permissions
as well as Send Messages. The existing Carbon client uses `queueRequests:false`.

Each POST also uses a stable 25-character nonce and `enforce_nonce:true`.
[Discord documents this deduplication only for the past few minutes](https://docs.discord.com/developers/resources/message#create-message).
It is defense in depth, **not durable exact-once delivery**. In particular, an
uncertain request with no discoverable receipt may remain blocked rather than
risk a duplicate. Do not expire or reset these keys as routine cleanup.

## Validation and proof

Public-handler tests use actual SQLite-backed D1 and replace only Discord HTTP.
They cover authentication, nested field/URL/count/threshold rejection, real Carbon
serialization, simultaneous delivery, repeat delivery, rejected-send retry,
response loss, pre-send D1 failure, post-send receipt failure, bounded/negative
history reconciliation, coverage, preview labels, and render limits.

Commands:

```sh
bun test tests/searchIntelligenceApi.test.ts
bun run typecheck
bun run test
bun run deploy:dry-run
```

Local validation: 13 focused receiver tests (105 assertions), typecheck, and
deployment dry-run pass. After installing the existing artwork suite's
ImageMagick prerequisite, the full Hermit suite passes: 300 tests across 35
files, 184,958 assertions (114.70 seconds). No artwork source changes were needed.

Executable real-service proof (never deploys or registers commands):

```sh
bun scripts/proof-search-intelligence.ts --prepare /tmp/claw-768-hermit-proof
# Run the following only through the managed token flow; reuse the SAME directory.
bun scripts/proof-search-intelligence.ts --send /tmp/claw-768-hermit-proof /path/to/frozen-digest.json
```

`--prepare` has passed against real local Wrangler D1 without sending anything.
`--send` requires the frozen digest's dashboard/links to use the trusted localhost
origin. It verifies the configured test bot identity and actual destination,
invokes this production handler twice, reads the real Discord message and durable
receipt, and saves `evidence.json` with status codes, components, no-mention facts,
and the Discord link. It does not print tokens or message headers. Proof uses
Patrick's configured OpenClaw test bot, not the deployed production Hermit bot.
Production Hermit token/configuration and deployment remain separate gates;
local/test-bot proof must never be presented as production deployment proof.
