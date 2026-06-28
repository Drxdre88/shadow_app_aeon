# Kairos — Synthesis Pipeline

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [chat](chat.md)

Synthesis turns flat accumulation into a layered, self-consolidating brain. Each stage reads the
substrate (and the stage below) and distils one tier up, writing back into `memories` with a
dedicated `streamClass`. All stages are per-user, idempotent per UTC day, soft-archive their
priors transactionally (never leaving a tier empty on a failed insert), and skip gracefully on
missing/undecryptable BYOK keys.

## Stages

### Archetypes (nightly, per Dominion)
`lib/kairos/archetypes.ts` → `runArchetypeSynthesisForDominion()` (`:220`), fanned out by
`runArchetypeSynthesisForUser()` (`:299`). Reads, per Dominion: last 14 days of non-pinned
substrate (≤80), pinned (≤30), all reflections (≤30, weighted), existing live archetypes
(continuity, ≤10), plus vision/mission/objectives/open board cards via `inspectDominion`. Emits
**3–7 master-node memories** (`type/streamClass='archetype'`). `persistArchetypes` archives prior
non-pinned + inserts in one transaction. Idempotency: `alreadyRanToday` checks for a live
archetype created today (filtering `isNull(archivedAt)` so a failed run doesn't permanently skip).
Cron: `archetype-synthesis`, **02:30 UTC**.

### Cortex (nightly, per Dominion — the living document)
`lib/kairos/cortex.ts` → `runCortexRegenForDominion()` (`:260`). Reads vision/mission/objectives
/ live board cards + all-time reflections (≤30) + **today's** live archetypes (≤12) + the prior
cortex (for `recent_shifts`). Emits **one** memory (`type='dominion_cortex'`, `streamClass='cortex'`)
— rendered markdown in `bodyMd`, structured payload in `sourceMetadata.cortex`. **Cross-job race
defense**: if a Dominion has activity but no archetype was synthesised today, it bails and defers
rather than anchoring to stale archetypes. Cron: `cortex-regen`, **03:00 UTC**.

### Aether (nightly, global self-model)
`lib/kairos/aether.ts` → `runAetherForUser()` (`:247`). The apex: one cross-Dominion self-model
per UTC day. `fetchAetherInputs` pulls the latest live cortex per active Dominion (deduped),
top-40 reflections, today's archetypes, and the prior Aether. Emits one memory
(`type/streamClass='aether'`, `dominionId=null`) — payload `{ thoughts[], tensions[], shifts[],
coreNarrative }` in `sourceMetadata.aether`, markdown in `bodyMd`. **Anti-drift leash**: any
thought with zero `sourceMemoryIds` is stripped before persist; if none survive, nothing is
written. Cron: `aether-regen`, **03:15 UTC**. Doc: `docs/kairos/27-aether-the-living-intelligence.md`.
Also has a BYOK-free path via the `/kairos-aether` skill + the `synthesis` MCP tools (Claude Code
as the cognition engine; `persistAether` accepts `source='claude'`).

### The Briefer (daily advisory, per Dominion)
`lib/kairos/briefer.ts` (prompt-only now; orchestration moved to the dispatcher + BRIEF recipe).
Writes one `streamClass='advisory'` memory per active Dominion per day, live board-aware, idempotent
on `briefer:{date}:{dominionId}`. Cron: `briefer`, **07:00 UTC**.

## Recipes + dispatcher

`lib/kairos/dispatch.ts` → `runRecipe()` (`:44`) is the single entry for synthesis writes: one
canonical `retrieveContext()`, routes by **surface** (`flat` for BYOK/cron vs `expanded` for
Claude Code), then primary write via `captureMemory` (externalId idempotency), optional extras,
and a `streamClass='trace'` audit row tied to the primary via `sourceMetadata.primaryMemoryId`
(for Oracle / Cartographer via `get_trace_history`). The registry (`recipes/registry.ts`) is a
static frozen map; **BRIEF** (`recipes/brief.ts`) is the sole registered recipe — the briefer
cron, `runBriefingNow`, and MCP `run_recipe` all route through it.

## Nightly cron cadence (`apps/web/vercel.json`, all gated on `CRON_SECRET`)

| UTC | Cron | What |
|---|---|---|
| 23:00 daily | `project-snapshot` | per-project snapshot + ephemeral lifecycle (compost) |
| 02:30 daily | `archetype-synthesis` | 3–7 archetypes / Dominion |
| 03:00 daily | `cortex-regen` | living cortex / Dominion |
| 03:15 daily | `aether-regen` | global Aether self-model |
| 04:00 daily | `embed-backfill` | drain missing/stale embeddings |
| 06:30 daily | `introspection` | staged `inbound` proposals / Dominion |
| 07:00 daily | `briefer` | one advisory / Dominion |
| Sun 03:00 | `memory-compaction` | weekly substrate count/report (stub) |
| Sun 05:00 | `memory-dedup` | weekly near-duplicate supersession |

The snapshot→archetypes→cortex→aether→embed→introspection→briefer ordering is deliberate: each
stage consumes the fresh output of the one before it, and the cross-job race defenses in
cortex/aether protect against a slow upstream job.

## Key files

- `lib/kairos/{archetypes,cortex,aether,briefer,introspection}.ts` (+ matching `*-prompt.ts`, `aether-types.ts`)
- `lib/kairos/dispatch.ts`, `recipes/{_recipe,registry,brief}.ts`, `retrieve.ts`, `_prompt-utils.ts`
- `apps/web/src/app/api/cron/*/route.ts`
- `apps/web/vercel.json` — cron schedule
