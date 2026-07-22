# Lobster Encounters V2

## Status

- Product status: Approved for implementation
- PRD date: July 21, 2026
- Replaces the runtime experience defined by `docs/lobster-command-prd.md`
- Existing persistence, cooldown, command, taxonomy, and media-delivery architecture remains in use
- The current production command stays available during implementation

## Product Definition

To lobster someone is to unleash a scientifically recognized marine lobster that
inflicts a clear, named crustacean consequence.

The feature is entertainment first. Scientific information must sharpen the joke,
explain why the selected action is plausible, or reveal something memorable about
the species. Taxonomy must never obscure who acted, who was targeted, or what
happened.

## Experience Contract

Every initial encounter must make these facts understandable without interpretation:

1. Who deployed the lobster.
2. Who got lobstered.
3. Which lobster species appeared.
4. What consequence the target received.
5. What the target can do next.

The first viewport of the Discord card must prioritize:

1. Target and outcome.
2. Encounter artwork.
3. Punchline and consequence metrics.
4. One concise, evidence-backed nerd note.
5. Target response controls.

Scientific name, family, AphiaID, snapshot identity, and citations remain available
but are secondary.

## Tone

Copy should be:

- immediately legible;
- dry, absurd, and administratively overconfident;
- specific to the selected species or action;
- witty without becoming a wall of text;
- informative without reading like generated taxonomy documentation.

The recurring scientific joke is:

> Why this was scientifically allowed

The answer must be short, accurate, and derived from bundled evidence.

## Outcome Families

Existing anatomy-safe scene actions map to a user-facing consequence:

| Scene action | User-facing consequence |
|---|---|
| `pinch` | Claw-clamped |
| `antenna-strike` | Antenna-whipped |
| `large-chela-stand-off` | Claw-cornered |
| `antenna-stand-off` | Antenna-cornered |
| `multi-chela-stand-off` | Outnumbered by claws |
| `subchelate-stand-off` | Technically cornered |
| `antenna-plate-refusal` | Flatly rejected |
| `tail-escape` | Outmaneuvered |
| `refusal` | Rejected by lobster |
| `ceremonial-display` | Formally judged |
| `editorial-observe` / `editorial-pose` | Deeply judged |

Direct-contact and confrontation scenes are primary outcomes. Refusal, ceremony,
observation, and escape remain available as uncommon comedic reversals.

## Selection

- Species selection remains uniform across the frozen taxonomy.
- Initial encounters always use the species' designated reviewed primary scene.
- Each primary scene must show an unmistakable target relationship and consequence.
- Weighted selection applies only to supporting scenes and return encounters.
- Return encounters use only actions marked safe for a redirected response.
- Selection remains deterministic for interaction retries.

## Card

The initial card should follow this hierarchy:

```text
@target GOT LOBSTERED

CLAW-CLAMPED - European lobster

@actor released the lobster. It secured a legally defensible grip on
@target and declined to provide a release schedule.

MENACE: 84%
SHELL SHOCK: 71%
DIGNITY REMAINING: 19%
ESCAPE CHANCE: 8%

WHY THIS WAS SCIENTIFICALLY ALLOWED
Family evidence supports enlarged first-leg claws. The taxonomy office approved
the clamp.
```

The exact copy varies deterministically by outcome.

## Target Responses

The named non-bot target may choose exactly one response regardless of role:

- `Lobster Them Back`: redirects the same species toward the original actor using
  a distinct approved scene and explicit counter-consequence.
- `Bribe With Butter`: produces an accepted or rejected settlement with a clear
  comedic result.

The card must explicitly state that only the named target may choose.

## Species Dossier

Every encounter includes an `Open Lobster Dossier` link.

The public dossier route is `/lobsters/:aphiaId` and contains:

- display and scientific names;
- family and body plan;
- the encounter artwork;
- anatomy-supported actions;
- a concise witty species summary;
- known habitat, depth, and geographic information;
- an explicit indication when those values are unknown;
- the official bundled WoRMS source link and citation.

The dossier is rendered with React SSR and does not require authentication.

## Artwork V2

The existing 1,056-scene anthology remains valid supporting material.

V2 introduces one designated primary-action binding per species:

- exactly 264 primary bindings;
- all 264 primary scenes are generated as new, non-destructive assets;
- `768x512` WebP;
- the lobster and target relationship must be immediately legible;
- a visible consequence or confrontation must be present;
- anatomy and behavior remain limited to committed evidence;
- no avatars or attempts to depict actual Discord users;
- current scenes may be reused only when they satisfy the primary-action contract.

Existing neutral, ceremonial, observational, refusal, and escape scenes remain
available for dossier galleries and return scenes.

Every primary binding records separate review results for target relationship,
action clarity, humor, anatomy, and final art. Pending or failed review blocks the
strict primary-art release gate.

## Acceptance Criteria

- Initial card tests assert actor, target, outcome, consequence metrics, nerd note,
  target instruction, and dossier link.
- Selection tests prove strong outcomes dominate while every available action
  remains reachable.
- Every species resolves to one valid primary scene.
- Target responses remain atomic, idempotent, and message-bound.
- Dossier routes return `200` for known AphiaIDs and `404` for unknown IDs.
- Dossier links use committed source URLs rather than constructing unverified
  external URLs.
- `bun test`, `bun run typecheck`, `bun run deploy:dry-run`, and strict artwork QA
  pass before release.
