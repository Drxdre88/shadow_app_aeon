# Kairos — Synthesis Pipeline

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [chat](chat.md)

Synthesis turns flat accumulation into a layered, self-consolidating brain. Each stage reads the
substrate (and the stage below) and distils one tier up, writing back into `memories` with a
dedicated `streamClass`. All stages are per-user, idempotent per UTC day, soft-archive their
priors transactionally (never leaving a tier empty on a failed insert), and skip gracefully on
missing/undecryptable BYOK keys.

## Stages

### Chat distillation (nightly, per user — feeds the chain)
`lib/kairos/chat-distill.ts` → `runChatDistillForUser()`. Runs FIRST (02:00 UTC, before
archetypes): every kairos-chat thread with turns on the prior UTC day (Telegram included, ≤80
msgs/thread) is BYOK-distilled (`taskType 'reflect'`, standard tier) into **operator-voice
reflections** (cap 5/thread/day, zero valid; externalId `chat-distill:{date}:{threadId}:{n}`;
per-thread failure isolation; `dryRun` mode). Archetype synthesis then reads them as part of its
weighted reflections — chat reaches the brain the same night. Cron: `chat-distill`, **02:00 UTC**
(route has a 240s deadline guard under the 300s budget; skipped users reported, recoverable via
date-backfill). PR #89.

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
| 02:00 daily | `chat-distill` | day's chat threads → operator reflections (PR #89) |
| 02:30 daily | `archetype-synthesis` | 3–7 archetypes / Dominion |
| 03:00 daily | `cortex-regen` | living cortex / Dominion |
| 03:15 daily | `aether-regen` | global Aether self-model |
| 04:00 daily | `embed-backfill` | drain missing/stale embeddings |
| 05:00 daily | `contradiction-scan` | auto-contradiction detection (`contradiction.ts`) |
| 06:30 daily | `introspection` | staged `inbound` proposals / Dominion |
| 07:00 daily | `briefer` | one advisory / Dominion |
| Sun 03:00 | `memory-compaction` | weekly substrate count/report (stub) |
| Sun 05:00 | `memory-dedup` | weekly near-duplicate supersession |

The snapshot→**chat-distill**→archetypes→cortex→aether→embed→**contradiction-scan**→introspection→briefer
ordering is deliberate: each stage consumes the fresh output of the one before it, and the
cross-job race defenses in cortex/aether protect against a slow upstream job. **11 crons total**
(the brain-tick is a cloud routine, not a Vercel cron — see [chat.md](chat.md) §1b).

## Model tiers, caching, output caps (PR #84 + `1512228`)

- **Tier routing** (`lib/ai/route-task.ts` DEFAULT_POLICIES): mechanical JSON synthesis
  (`archetype`/`cortex`/`contradiction`) runs **standard** tier; judgment tasks
  (`brief`/`advisory`/`aether`) stay **heavy**. `chat`/`reflect`/`code`/`shell_heavy` standard;
  `classify`/`summarise`/`voice` cheap.
- **Prompt caching**: every synthesis call site passes `cacheSystem: true` — the static system
  prompt rides an Anthropic `cache_control: ephemeral` breakpoint (`provider.ts`), no-op on other
  providers. Guardrail: cache hits require a byte-exact static system string — never interpolate
  per-run values into it.
- **Temperature**: removed from all nightly synthesis call sites (current-gen models 400 on
  non-default temp); only chat (0.5) and chat-distill (0.1) still pass one.
- **Output caps genuinely bind since 2026-07-17**: `toSdkArgs` now maps `maxTokens` →
  `maxOutputTokens` (AI SDK v5 rename; the old key was silently dropped, so every stated cap —
  archetypes 3000, cortex 3000, aether 4000, brief 1200 — was aspirational until the fix).

## Key files

- `lib/kairos/{archetypes,cortex,aether,briefer,introspection,contradiction,chat-distill}.ts` (+ matching `*-prompt.ts`, `aether-types.ts`), `cron-trace.ts`
- `lib/kairos/dispatch.ts`, `recipes/{_recipe,registry,brief}.ts`, `retrieve.ts`, `_prompt-utils.ts`
- `apps/web/src/app/api/cron/*/route.ts`
- `apps/web/vercel.json` — cron schedule
