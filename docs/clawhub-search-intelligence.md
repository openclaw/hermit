# ClawHub weekly search intelligence receiver

Companion to [CLAW-768](https://linear.app/my-openclaw/issue/CLAW-768) under
[CLAW-724](https://linear.app/my-openclaw/issue/CLAW-724).

## Boundary and ownership

`POST /api/clawhub-search-intelligence/weekly` accepts ClawHub's frozen
`search_intelligence_weekly_v4` digest and previously frozen v3, v2 and
`plugin_search_weekly` digests. It uses the existing `CLAWHUB_HERMIT_TOKEN`
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

## Plugin and skill evidence

[CLAW-893](https://linear.app/my-openclaw/issue/CLAW-893) adds named `plugins` and
`skills` catalogs. Each carries its own company opportunities, official gaps,
movers and up to five Featured recommendations, plus search coverage and adoption
snapshot freshness. The complete v2 JSON payload is capped at 30,000 UTF-8 bytes.

ClawHub's shared recommendation owner supplies candidate order and eligibility.
Hermit displays separate search/adoption support, counts, periods and freshness;
it never computes a combined score or changes Featured. Search-only recommendations
need at least three matched searches in the completed week. Adoption-supported
recommendations may show lower aggregate demand, but each displayed query detail
still needs three searches. Details are capped at three queries per candidate,
with an explicit omission count. Missing search evidence stays `null`.

Current adoption snapshots may describe a different period from the completed
search week. External observations carry their own `sourceObservedAt`; unknown
source periods and unavailable metrics stay null. Lifetime counts are labeled as
lifetime counts. Search metadata failure does not erase independently hydrated
adoption evidence. Human quality, security and category-coverage review remains
required before featuring anything.

Legacy payload validation and rendering are retained for frozen retries. Both
versions use the same origin/week receipt identity: v2 cannot replace an already
claimed legacy week or cause a second message for it. Deploy receiver support
before enabling the v2 sender. A read-only report/dry run does not call this POST
endpoint; invoking it requests delivery.

## Monthly Featured lineups (v4)

V4 carries 16 slots per catalog. Plugins reserve eight editorial slots and use
eight deduplicated telemetry slots; skills use 16 telemetry slots. ClawHub owns
eligibility and order: installs across 30 completed UTC days, then installs in the
final seven days, then stable artifact ID. Search counts, downloads, official
status and current Featured membership do not improve that order. Editorial
reservations retain their rationale; pending entries stay pending instead of
being replaced with telemetry choices. A changed editorial revision is visibly
stale and requires a regenerated report before approval.

Each catalog carries the exact monthly window, aggregate scan start/end, scanned
and imported row counts, and import dataset provenance. The scan is not an atomic
snapshot. Search evidence still has its separate completed-week window and query
privacy threshold. Missing adoption stays unavailable, not zero. Hermit neither
re-ranks the report nor publishes Featured selections.

The complete wire payload remains capped at 30,000 bytes, including all Featured
evidence even when Discord does not display it. Pre-cutoff v4 reports retain the
compact linked-name/30-day-install formatter, pending-slot warnings and full-report
button. Each part uses at most 4000 text characters and 40 components.

V4 freezes the complete digest hash and ordered rendered-part hashes at the same
origin/week key. Each part reuses the existing message receipt, nonce and
uncertain-send reconciliation owner at a derived part key. Only all confirmed
parts yield overall success. A rejected part may retry; confirmed earlier parts
are skipped. An uncertain part must reconcile before later parts can proceed.
A changed report or rendering manifest conflicts instead of silently replacing a
partially delivered week. Frozen v1/v2/v3 payloads retain their original validation,
rendering, hashes and single-message receipts. Deploy receiver support before
sending v4. Read-only dry runs must not call the delivery endpoint.

### Discord Featured presentation cutover

For v4 weeks ending **2026-11-02T00:00:00Z or later**, new delivery claims show
both catalogs' weekly search totals, source counts, coverage, classification,
company opportunities, official gaps and movers. Featured recommendations move
to the separate advisory review workflow; the Discord formatter never changes
Featured membership. Strict full-payload validation, privacy thresholds and
trusted-origin checks still apply. Bounded Carbon pages retain every supplied
search row; oversized search links open the full report instead.

The original full digest still owns the hash, origin/week key and part nonces.
An existing incomplete cutoff-week receipt can resume the unchanged legacy
formatter only when the original payload hash **and ordered legacy part hashes**
match. The atomic delivery owner chooses the winning manifest; it never replaces
an existing claim. Changed payloads and unknown incomplete manifests still
conflict, and uncertain sends still require reconciliation. No manual proof that
the cutoff week is unclaimed is needed.

Pre-cutoff producer-frozen reports use the byte-identical old formatter even
when first received after cutover. V1/v2/v3 behavior is unchanged. The cutoff is
an immutable UTC week identity, independent of request time or environment
settings. A rollback must retain this selector and both formatters for the
retained receipt lifetime; deploying a formatter-only historical revision after
new claims exist can conflict with their manifests.

## Delivery state and failure semantics

No migration is needed. The existing D1 `keyValue` primary key stores one receipt
per trusted origin and UTC week, plus v4 part receipts when applicable. Legacy
message records contain a version, canonical digest
hash, delivery status, start timestamp, and confirmed Discord message ID; receipts
contain no query text. Reads use a `first-primary` D1 session. Atomic
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

Receiver tests also cover both catalogs, rare query suppression, independent
adoption hydration, frozen legacy replay, cross-version receipt collisions and
v2 response-loss recovery. Local upgrade proof can use persistent Wrangler D1
and a mock Discord transport; that demonstrates receipt continuity, not actual
Discord delivery. The full artwork suite requires ImageMagick.

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
