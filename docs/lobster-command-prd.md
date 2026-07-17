# Lobster Encounters

## Status

- Product status: Approved for implementation
- PRD date: July 17, 2026
- Implementation status: Active
- Slap technical prerequisite: Complete on `main` at `409bd7c`
- Product approval gate: Complete
- Source of truth: This document
- Durable progress state: `progress.txt`
- Delivery rule: Do not implement `/lobster`, create its schema, provision its
  production storage, or generate its production artwork until the blocking
  prerequisite is complete

## Summary

Add a guild-only `/lobster` command and `Release Lobster` user command to Hermit.
An authorized staff member selects a target, Hermit deploys one scientifically
recognized marine lobster species, and the target receives an interactive,
species-specific encounter.

The feature must represent every accepted, extant marine lobster species in the
frozen production taxonomy. Artwork must reflect each species' anatomy and may
use pinching, antenna strikes, tail-powered escapes, body checks, ambushes,
refusals, ceremonial appearances, or other species-appropriate behavior.

This is not a lobster-themed copy of `/slap`. It is a larger visual anthology
with materially different settings, media, compositions, casts, moods, and
actions.

## Background

Hermit's current fish slap feature uses a fixed fish-by-outcome scene matrix.
Although the scene count is large, its first artwork generation pass repeated a
narrow visual grammar: adult men, office or hearing-room interiors, similar
camera angles, and polished photorealistic action stills.

The lobster feature must not repeat that failure at a larger scale. Diversity
must be encoded in catalog metadata, generation manifests, quotas, and review
gates before production generation starts.

The 2019 *Updated Checklist of the World's Marine Lobsters* recognized 260
species across six families. The production count may differ because taxonomy
continues to change. Hermit will therefore use a dated, checksummed World
Register of Marine Species snapshot rather than a hardcoded historical count.

## Goals

1. Represent every species in the approved frozen marine lobster taxonomy.
2. Make anatomy and species identity materially affect each encounter.
3. Produce at least four approved, visibly distinct scenes per species.
4. Provide strong variation in medium, tone, environment, composition, palette,
   lighting, action, and adult cast.
5. Give the named target one durable, target-only response to the encounter.
6. Share cooldown enforcement with `/slap` so the commands cannot bypass one
   another.
7. Store production artwork in the repository and deliver it through the same
   immutable GitHub-to-Discord attachment path used by `/slap`.
8. Keep command execution deterministic, durable, idempotent, and guild-only.
9. Use Carbon components v2 for every Discord response and incident card.
10. Make taxonomy and artwork refreshes versioned and reproducible.

## Non-Goals

- Implementing or generating the feature before slap artwork remediation is
  approved.
- Treating every common name containing "lobster" as an included species.
- Including squat lobsters, freshwater crayfish, fossils, extinct species,
  synonyms, or subspecies in v1.
- Querying WoRMS during a Discord interaction.
- Giving every species an identical outcome matrix.
- Generating artwork from Discord avatars or attempting to depict real users.
- Allowing user installs, direct messages, or use outside the configured guild.
- Building a backoffice UI.
- Introducing a separate public object-storage architecture for lobster art.
- Serving production artwork directly as Discord external media.

## Pinchy Execution Contract

### Planning Classification

This is a large, multi-session product build. Future implementation must run
from this PRD and `progress.txt` using dependency-aware Pinchy coordinator
sessions. Regular implementation may not begin until `LOB-GATE-1` is complete.

The depth-0 parent owns this PRD, `progress.txt`, integration decisions, and all
Git operations. Coordinators own bounded workstreams. Depth-2 laps own one
bounded objective and may not mutate the PRD, progress state, AGENTS files, or
Git state.

### Status Vocabulary

Every execution item uses exactly one of these statuses:

- `pending`: Ready when its dependencies are complete.
- `in_progress`: Assigned to one active coordinator session.
- `complete`: Its acceptance criteria passed independent verification.
- `blocked`: At least one dependency or approval gate remains incomplete.

Before an item becomes `in_progress`, `progress.txt` must record its coordinator
owner, bounded scope, validation commands, and any disjoint file ownership.

### Work Graph

| ID | Status | Workstream | Dependencies | Ownership | Observable acceptance criteria |
|---|---|---|---|---|---|
| `LOB-GATE-1` | `complete` | Product approval | None | Product owner | LOB-5 through LOB-9 and every Product Gate Question are confirmed, rejected, or explicitly deferred; scientific and artwork approvers are named; explicit approval to begin implementation is recorded. |
| `LOB-TAX-1` | `complete` | Taxonomy | `LOB-GATE-1` | Taxonomy owner | A dated WoRMS source export, normalized catalog, query definition, citations, and raw and normalized checksums are committed; automated validation proves every included record satisfies the taxonomy rules. |
| `LOB-META-1` | `complete` | Species metadata | `LOB-TAX-1` | Domain-data owner | Every catalog species has complete anatomy, habitat, action, prohibited-action, vocabulary, scene, and accessibility metadata; validators reject anatomically invalid actions. |
| `LOB-DATA-1` | `complete` | Persistence and cooldowns | `LOB-GATE-1` | Persistence owner | Additive migrations and services persist deterministic encounters, message binding, responses, counters, and shared `/slap` cooldowns; retry, race, and idempotency tests pass. |
| `LOB-DISCORD-1` | `complete` | Commands and Carbon UI | `LOB-META-1`, `LOB-DATA-1` | Discord owner | `/lobster` and `Release Lobster` are registered in `src/index.ts`, explicitly guild-install and guild-context only, restricted to the three approved roles, and render only Carbon v2 components. |
| `LOB-RESP-1` | `complete` | Target responses | `LOB-DATA-1`, `LOB-DISCORD-1` | Interaction owner | Target-only `Return To Sender` and `Offer Butter` transitions are atomic, idempotent, deterministic, message-bound, and covered for concurrent clicks and unauthorized users. |
| `LOB-ART-PLAN` | `complete` | Artwork planning | `LOB-META-1` | Artwork pipeline owner | A deterministic manifest partitions the frozen catalog into disjoint batches of no more than 25 species, assigns at least four scenes per species, records prompt versions and quotas, and defines immutable repository paths. |
| `LOB-ART-BATCH-*` | `complete` | Artwork production | `LOB-ART-PLAN` | One artwork-batch owner per item | Each instantiated batch covers only its assigned species; every species has at least four approved `768x512` WebP scenes under `assets/lobster/scenes`; anatomy, file-size, provenance, diversity, and file-integrity checks pass. |
| `LOB-ART-QA` | `blocked` | Artwork corpus QA | All instantiated `LOB-ART-BATCH-*` items | Independent artwork QA owner | The complete corpus passes coverage, dimensions, checksums, reachability, anatomy, diversity quotas, accessibility, and perceptual-duplicate audits with named scientific and artwork sign-off. |
| `LOB-ASSET-1` | `blocked` | Discord asset delivery | `LOB-ART-QA` | Asset delivery owner | Production URLs are pinned to the immutable artwork commit on `raw.githubusercontent.com/openclaw/hermit`; Hermit validates bounded WebP bytes and uploads them to Discord as `attachment://` media with a compact failure fallback. |
| `LOB-VERIFY-1` | `blocked` | Integration verification | `LOB-DISCORD-1`, `LOB-RESP-1`, `LOB-ASSET-1` | Independent verification owner | Every requirement in Validation passes, including `bun test`, `bun run typecheck`, and `bun run deploy:dry-run`; no earlier completed item regresses. |
| `LOB-RELEASE-1` | `blocked` | Production release | `LOB-VERIFY-1` | Release owner | Staging smoke tests pass for invocation, responses, cooldowns, retries, and bots; required sign-offs are recorded; the reviewed commits are pushed to `main`; Cloudflare production build and CodeQL pass. |

`LOB-ART-BATCH-*` is a template, not permission to generate artwork. After
`LOB-ART-PLAN` passes, the parent must instantiate one tracked item per batch in
`progress.txt`, with a stable ID, exact species list, owner, dependencies,
status, and validation evidence.

Coordinator sessions should normally own two to five related items. Shared
schemas, migrations, generated catalogs, manifests, lockfiles, and Git
operations remain serialized. Item status advances only from actual repository
and validation evidence, never from an unverified session report.

## Taxonomy

### Included Families

The initial catalog covers accepted extant marine species in these six lobster
families:

1. Nephropidae
2. Enoplometopidae
3. Glypheidae
4. Palinuridae
5. Scyllaridae
6. Polychelidae

### Inclusion Rules

A catalog record is included only when the frozen WoRMS snapshot reports:

- Taxonomic rank exactly equal to `Species`.
- Accepted taxonomic status.
- Marine status.
- Extant status.
- Membership in one of the six approved families.

Synonyms resolve to the accepted species and do not receive separate selection
weight or artwork. Subspecies, fossils, extinct records, freshwater-only
records, brackish-only records, and unaccepted names are excluded.

### Snapshot Requirements

The taxonomy build must persist:

- Snapshot identifier and UTC creation timestamp.
- WoRMS AphiaID.
- Accepted scientific name and authority.
- Family, genus, and species classification.
- WoRMS status and marine/extinction flags.
- Source endpoint and query definition.
- Source citation.
- Raw export checksum.
- Normalized catalog checksum.

The runtime bundles the normalized snapshot. It never depends on a live WoRMS
request.

## Authorization

Both entry points are guild-install and guild-context only. Invocation requires
at least one of these roles:

| Role | ID |
|---|---|
| Community Team | `1477360613125787678` |
| Maintainer | `1457214688806047756` |
| Maintainer Guest | `1503268035908075590` |

Target-response buttons are restricted to the named target. Holding an
authorized invocation role does not allow someone else to respond for the
target.

## Command Surface

### Slash Command

`/lobster user:<user>`

### User Command

`Release Lobster`

Both entry points create the same durable encounter and use the same
authorization, cooldown, selection, and rendering paths.

## Encounter Workflow

1. An authorized member selects a target.
2. Hermit verifies guild jurisdiction, authorization, and shared cooldowns.
3. Hermit deterministically selects one species uniformly from the frozen
   catalog.
4. Hermit selects one approved asset for that species without allowing species
   with larger art packs to become more likely.
5. Hermit derives the encounter copy, metrics, and available target responses
   from species metadata and the selected scene.
6. Hermit persists the complete encounter before publishing its canonical
   Carbon card.
7. Hermit binds the Discord message to the stored encounter.
8. The named target may choose one response.
9. Hermit records the first valid response atomically and updates the canonical
   card.

Interaction retries must reproduce the same species, scene, copy, and metrics.

## Target Responses

The initial release provides two mutually exclusive responses:

### Return To Sender

The selected lobster redirects the encounter toward the original actor. Hermit
records and renders a species-appropriate counter-event using a separately
selected approved asset.

### Offer Butter

The lobster accepts or rejects a negotiated release according to deterministic
species-specific copy. This response closes the encounter without a
counter-event.

Only one response may win. Repeated clicks are idempotent. Bots have response
controls disabled.

## Shared Cooldowns

`/slap` and `/lobster` use one shared action-cooldown ledger:

| Dimension | Duration |
|---|---:|
| Actor | 30 seconds |
| Target | 90 seconds |
| Channel | 12 seconds |

A successful `/slap` blocks `/lobster`, and a successful `/lobster` blocks
`/slap`, for every applicable dimension. Concurrent requests must resolve
atomically.

Target responses do not consume or reset invocation cooldowns.

## Species Metadata

Each catalog entry must include:

- AphiaID.
- Scientific and display names.
- Family and broad body plan.
- Habitat and depth band.
- Geographic region when known.
- Claw, antenna, tail, and body-form capabilities.
- Permitted action families.
- Prohibited anatomical actions.
- Narrative vocabulary.
- Approved scene identifiers.
- Accessibility description fragments.

Species metadata controls behavior. A species without large claws cannot be
rendered pinching a person.

## Artwork Model

### Coverage

- Every species receives at least four approved production scenes.
- Visually prominent or culturally familiar species may receive up to eight.
- The expected initial corpus is approximately 1,040 to 2,080 images.
- Species selection remains uniform regardless of art-pack size.

### Output Specification

- Format: WebP.
- Dimensions: exactly `768x512`.
- Aspect ratio: `3:2`.
- Generation and final production output both use `768x512`; v1 does not
  generate or retain larger master renders.
- Color profile: sRGB.
- Metadata: stripped except required provenance metadata.
- Target average file size: 75 KB or less.
- Maximum file size: 120 KB.
- No readable text, brands, watermarks, or third-party characters.

### Visual Dimensions

Every asset manifest records:

- Species and family.
- Action.
- Environment.
- Historical or fictional era.
- Visual medium.
- Tone.
- Adult cast.
- Camera position and lens language.
- Composition.
- Lighting.
- Palette.
- Scene-family identifier.
- Generation prompt version.
- Human and automated review status.

### Required Visual Range

The corpus must deliberately cover:

- Naturalistic documentary photography.
- Cinematic action and comedy.
- Underwater and deep-sea horror.
- Film noir.
- Pulp adventure illustration.
- Gouache and watercolor illustration.
- Oil-painting tableaux.
- Inked comic panels without lettering.
- Cel animation.
- Stop-motion and miniature dioramas.
- Retro science fiction.
- Medieval and mythic fantasy.
- Fashion-editorial photography.
- Sports-broadcast imagery.
- Surreal collage.
- Vintage scientific-plate composition.

Settings must span natural habitats, beaches, reefs, ships, streets, transit,
markets, theaters, museums, arenas, castles, laboratories, festivals, deep-sea
vehicles, and fictional worlds. Offices and hearing rooms may appear only as a
small minority.

Adult human casts must vary gender presentation, skin tone, age, body type,
wardrobe, and role. Some scenes may feature robots, fantasy adults, or no humans
when the selected action remains legible.

### Diversity Quotas

- No visual medium exceeds 15% of the corpus.
- No environment family exceeds 10%.
- Office, boardroom, or hearing-room settings combined remain below 3%.
- No single cast pattern exceeds 5%.
- At least half of human scenes prominently include an adult woman.
- At least 20% of scenes use non-photorealistic media.
- At least 15% of scenes contain no conventional modern workplace.
- Consecutive assets for one species must differ in medium, environment,
  composition, and tone.
- Perceptual near-duplicates are rejected.

## Asset Storage And Delivery

Production assets use the same architecture as `/slap`.

- Final WebPs live under `assets/lobster/scenes/{aphiaId}/{sceneId}.webp`.
- The repository stores the complete production image corpus, manifests,
  prompts, prompt versions, checksums, and audit reports.
- Runtime URLs use
  `https://raw.githubusercontent.com/openclaw/hermit/{artworkRevision}/...`
  with an immutable 40-character commit SHA.
- Hermit fetches only the trusted repository path, validates bounded WebP
  bytes, and uploads the image to Discord as a message attachment.
- Carbon media galleries reference `attachment://...`, never the external URL
  directly.
- Missing or invalid artwork omits the gallery and renders a compact
  unavailable notice instead of leaving Discord media spinning.

## Discord Card

The canonical Carbon card includes:

- Encounter identifier.
- Scientific and display species names.
- Family.
- Artwork with meaningful alt text.
- Species-specific headline and narrative.
- Encounter metrics.
- Taxonomy snapshot identifier.
- Target-response status.
- `Return To Sender` and `Offer Butter` buttons when available.

No embed payloads or hand-built raw component objects are used.

## Data Requirements

Persist:

- Encounter ID and interaction ID.
- Guild, channel, and Discord message IDs.
- Actor and target IDs.
- Target bot status.
- Taxonomy snapshot ID.
- Species AphiaID, accepted name, display name, and family.
- Scene ID, immutable asset URL, and asset checksum.
- Narrative, headline, metrics, and accessibility description.
- Response type, response actor, response timestamp, and response result.
- Counter-event fields when applicable.
- Creation and message-binding timestamps.

Historical events must remain renderable after taxonomy or artwork refreshes.

## Integrity And Failure Handling

- Interaction retries reuse the persisted encounter.
- Component actions must match the stored guild, channel, message, target, and
  encounter identifiers.
- Only one target response may be recorded.
- Missing catalog or artwork entries fail privately before publishing.
- Failed Discord publication does not create an unbound reusable event.
- Failed card synchronization is logged and can be retried idempotently.
- A taxonomy refresh never mutates historical encounter records.

## Observability

Structured logs include:

- Encounter ID.
- Interaction ID.
- Snapshot ID.
- AphiaID and family.
- Scene ID.
- Actor, target, and channel cooldown decisions.
- Message-binding result.
- Target-response transition.
- Discord response status.

Prompts and private runtime credentials must not be logged.

## Validation

Automated validation must prove:

- Every included species has exactly one catalog record.
- Every species has at least four approved assets.
- Every asset URL is immutable and reachable.
- Every image is valid WebP at exactly `768x512`.
- Every image is at or below 120 KB.
- Checksums match the production objects.
- Species never use prohibited anatomical actions.
- Diversity quotas pass.
- Perceptual duplicate thresholds pass.
- Alt text exists for every scene.
- Shared cooldowns work in both command directions.
- Concurrent response attempts produce one terminal result.
- Unauthorized invocations and responses are rejected privately.
- `bun test`, `bun run typecheck`, and `bun run deploy:dry-run` pass.

## Release Gates

### Slap Prerequisite

| Gate | Status | Evidence |
|---|---|---|
| All 327 slap scenes regenerated and replaced | Complete | Artwork commit `da5edf3` |
| Every slap scene is exactly `768x512` | Complete | `tests/slapAssets.test.ts` and `assets/slap/scenes.manifest.json` |
| Diversity and file-size audits pass | Complete | 327 unique final hashes; 24,257,250 total bytes; 70,084 to 82,760 bytes per scene |
| Replacement corpus visually reviewed and corrected | Complete | Review-driven correction metadata is preserved in the generation manifest |
| Cache-busting revision deployed | Complete | URLs are pinned to immutable artwork commit `da5edf3` by commit `d164432` |
| Configured Cloudflare production build and CodeQL pass | Complete | Checks passed for `d164432` on July 17, 2026 |
| User approves the remediated slap experience and lobster execution | Complete | Explicit implementation approval recorded July 17, 2026 |

The technical slap remediation and lobster product approval gate are complete.

Production release additionally requires:

1. Approved taxonomy parent scope and snapshot.
2. Complete repository-hosted artwork corpus and immutable revision pin.
3. Complete species and artwork coverage.
4. Anatomy and diversity review sign-off.
5. A successful file-integrity and attachment-delivery audit of the complete
   corpus.
6. Discord staging smoke tests for command, counter, response, cooldown, and
   retry behavior.

## Product Decisions

| ID | Status | Decision |
|---|---|---|
| LOB-1 | Confirmed | The final artwork size is `768x512` WebP |
| LOB-2 | Confirmed | Every accepted extant marine species in the six approved families is represented |
| LOB-3 | Confirmed | Artwork is species-specific rather than a universal outcome matrix |
| LOB-4 | Confirmed | Slap artwork remediation blocks lobster implementation |
| LOB-5 | Confirmed | Each species receives four to eight production scenes |
| LOB-6 | Confirmed | Invocation uses the same three authorized roles as `/slap` |
| LOB-7 | Confirmed | `/slap` and `/lobster` share cooldowns |
| LOB-8 | Confirmed | Production artwork uses the same repository and Discord attachment architecture as `/slap` |
| LOB-9 | Confirmed | Target responses are `Return To Sender` and `Offer Butter` |

## Product Gate Decisions

1. Scientific anatomy approval: Peter Steinberger.
2. Final artwork approval: Hannes Rudolph.
3. Taxonomy refresh cadence: annual after v1, with urgent correction releases
   when accepted taxonomy or anatomy errors are identified.
4. Production artwork path: `assets/lobster/scenes`.
5. Production delivery: immutable raw GitHub revision fetched and re-uploaded
   to Discord as attachments, matching `/slap`.
6. Hermit, Rock Lobster, bots, and self-targets use the standard
   species-specific scene library in v1 rather than dedicated scene sets.
7. `Return To Sender` reuses the original species and selects a separate
   approved response asset.
8. Every species has equal selection probability in v1. Any rarity model is a
   separately approved post-v1 change.

## References

- World Register of Marine Species web services:
  `https://www.marinespecies.org/aphia.php?p=webservice`
- Updated checklist publication record:
  `https://scholars.ntou.edu.tw/handle/123456789/16132`
