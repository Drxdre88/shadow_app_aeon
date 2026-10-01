# Kairos — Synthesis Pipeline

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [memory-and-capture](memory-and-capture.md) · [chat](chat.md)

Synthesis turns flat accumulation into a layered, self-consolidating brain. Each stage reads the
substrate (and the stage below) and distils one tier up, writing back into `memories` with a
dedicated `streamClass`. All stages are per-user, idempotent per UTC day, soft-archive their
priors transactionally (never leaving a tier empty on a failed insert), and skip gracefully on
missing/undecryptable BYOK keys.

## Stages

**Parse reliability (docs/kairos/31, `feat/kairos-synthesis-reliability`).** The four standard-tier
generators (archetypes, cortex, introspection, contradiction) each wrap `extractJsonBlock → zod
.parse()` in `parseWithRepair` (`_prompt-utils.ts`): on a parse/schema failure they re-prompt the
SAME provider **once** with the raw text + validation error as a user-turn message
(`buildRepairPrompt`, generalised from aether's 07-09 one-shot retry, `aether.ts:305-357`), then
fail via `ParseRepairError`. Failure traces now carry `finishReason` (truncation vs malformed
content), a bounded 500-char `sourceMetadata.rawExcerpt`, and split `parse_failed:syntax` vs
`parse_failed:schema`. No temperature reintroduced — reliability is the repair path, not sampling.

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
on `briefer:{date}:{dominionId}`. Cron: `briefer`, **06:15 UTC** (feeds the 08:00 London daily message).

### Daily Message (guaranteed daily voice — replaces the Evening Digest)
`lib/kairos/daily-message{,-inputs,-prompt}.ts`. One GUARANTEED message at **08:00 Europe/London**
to the Will inbox + Telegram via `deliverKairosSpeak` with the **`digest:true` register** (see
[chat.md](chat.md) §1b). Cron `daily-message` fires `0 7,8 * * *` UTC and is gated by
`isLondonHour(now, 8)` so exactly one run lands across BST/GMT. Idempotent on
`externalId kairos-daily:{londonDate}` plus a transaction-scoped advisory lock. Body source, in
order: the routine's `daily_message` thinking-job draft → paid BYOK key → deterministic template.
Shows drift-probe results. A Telegram failure records `sent_inbox_only` and a
`telegram_not_delivered` trace. (The 18:00 UTC Evening Digest and `lib/kairos/digest.ts` are deleted.)

### Weekly review (Mondays)
`lib/kairos/weekly-review/{inputs,prompt,render}.ts` + `weekly_review` thinking job (Mon ≥05:00Z):
≤5 `review_action` proposals + one observation + one speak.

### Drift probes (constitution)
`lib/kairos/constitution/{probes,drift}.ts`: 24 fixed probes; the first run sets a baseline, then
nightly `drift_probe` runs compare per-probe cosine. Alert when mean < 0.8 or ≥3 probes < 0.6
("flipped"). Results surface in the daily message. Seeded by `constitution-seed` (Mon 04:20 UTC).

## Thinking queue (`thinking_jobs`, docs/kairos/33)

`lib/kairos/thinking/{queue,registry,deadlines,paid-fallback}.ts` + `handlers/*`. Cognition is
queued as jobs (statuses queued → claimed → done | failed | expired | fallback; unique
`(userId, externalKey)`) that a Claude Max **routine** claims and submits via MCP/REST; anything
unanswered by its deadline falls back to the paid BYOK key.

| Kind | Planned | Deadline → fallback |
|---|---|---|
| `cortex` | after archetypes | 02:58Z → `cortex-regen` 03:00 |
| `aether` | after cortex | 03:13Z → `aether-regen` 03:15 |
| `concept` | Sundays (engine Concepts step) | 6h → sweep |
| `belief_extract` | ≥02:30Z | 4h → sweep |
| `drift_probe` | after aether or ≥03:30Z | 2h → sweep |
| `mind_compare` | Mon ≥04:00Z | 3h → sweep |
| `weekly_review` | Mon ≥05:00Z | 6h → sweep |
| `daily_message` | once briefs exist | 07:55 London → own cron |
| `chat` | Telegram webhook only | watchdog → paid key (see [chat.md](chat.md)) |

**Routines (claude.ai, owner-created):** *Kairos thinking* 02:40Z nightly · *Kairos morning*
06:30Z (optional) · *Kairos chat* API-trigger only, behind `KAIROS_TELEGRAM_ROUTINE=1`.
**`thinking-sweep`** (hourly :50) plans every kind except `concept`/`chat`, expires overdue jobs and
runs the paid fallback for sweep kinds (max 2 per run, 200s budget).

## Recipes + dispatcher

`lib/kairos/dispatch.ts` → `runRecipe()` (`:44`) is the single entry for synthesis writes: one
canonical `retrieveContext()`, routes by **surface** (`flat` for BYOK/cron vs `expanded` for
Claude Code), then primary write via `captureMemory` (externalId idempotency), optional extras,
and a `streamClass='trace'` audit row tied to the primary via `sourceMetadata.primaryMemoryId`
(for Oracle / Cartographer via `get_trace_history`). The registry (`recipes/registry.ts`) is a
static frozen map; **BRIEF** (`recipes/brief.ts`) is the sole registered recipe — the briefer
cron, `runBriefingNow`, and MCP `run_recipe` all route through it.

## Cron cadence (`apps/web/vercel.json`, all gated on `CRON_SECRET`)

| UTC | Cron | What |
|---|---|---|
| 23:00 daily | `project-snapshot` | per-project snapshot + board feed + ephemeral lifecycle (compost) |
| 01:30 daily | `memory-engine` | Merge → Weigh → BackUp → OwnMind → Concepts (see [memory-and-capture.md](memory-and-capture.md) §7) |
| hourly :50 | `thinking-sweep` | plan / expire / paid-fallback thinking jobs |
| 02:00 daily | `chat-distill` | day's chat threads → operator reflections (PR #89) |
| 02:30 daily | `archetype-synthesis` | 3–7 archetypes / Dominion |
| 03:00 daily | `cortex-regen` | living cortex / Dominion (fallback for the `cortex` job) |
| 03:15 daily | `aether-regen` | global Aether self-model (fallback for the `aether` job) |
| 04:00 daily | `embed-backfill` | drain missing/stale embeddings |
| 04:30 daily | `ask-mine` | Kairos Asks + `card_notes` nudges |
| Mon 04:20 | `constitution-seed` | seed / maintain the live constitution |
| 05:00 daily | `contradiction-scan` | auto-contradiction detection (`contradiction.ts`) |
| Sun 05:00 | `memory-dedup` | weekly near-duplicate supersession |
| 06:15 daily | `briefer` | one advisory / Dominion |
| 06:30 daily | `introspection` | staged `inbound` proposals / Dominion |
| 06:45 daily | `synthesis-health` | nightly trace rollup → one idempotent `SYNTHESIS_HEALTH` memory (externalId `synthesis-health:{date}`); one stage per `cronName` (`BRIEF` → `briefer`; incl. `thinking-sweep`, `daily-message`, `memory-engine`); a stage failing 2 consecutive UTC nights fires ONE batched Telegram ops alert. Pure SQL, no LLM/BYOK. (docs/kairos/31) |
| 07:00 + 08:00 daily | `daily-message` | guaranteed 08:00 London speak (London-hour gate picks one) |
| :15 at 6,9,12,15,18,21,23 | `micro-consolidate` | intraday per-Dominion `delta` fold (skip-if-quiet <3 new; hour-bucket externalId) |

The snapshot→**engine**→**chat-distill**→archetypes→cortex→aether→embed→**contradiction-scan**→briefer→introspection→health→daily-message
ordering is deliberate: each stage consumes the fresh output of the one before it, and the
cross-job race defenses in cortex/aether protect against a slow upstream job. **17 crons total**
(the `memory-compaction` stub and the 18:00 `digest` are gone; the brain-tick and the thinking
routines are claude.ai cloud routines, not Vercel crons — see [chat.md](chat.md) §1b).

## Live Mind layer (2026-07-24 — intraday awareness + incident lifecycle)

- **Micro-consolidation** (`micro-consolidate.ts`): 6×/day, per active Dominion, folds new
  memories + board deltas since the last cortex reading into ONE `streamClass='delta'` memory
  (`type='observation'` — deliberately NOT `snapshot`, which the ephemeral lifecycle would TTL
  and reclassify). Skip-if-quiet (<3 new), hour-bucketed `externalId` idempotency, heavy tier.
  Cortex/aether prompts consume the latest delta (or a live counts line) as a "## Today so far"
  user-prompt section — `recentShifts` grounded in same-day events, not re-derived cold.
- **Incident lifecycle**: new `resolves` link type (`memoryEdgeTypeSchema`). A memory carrying
  `resolves` links stamps its targets' `invalidAt` (same-user, first-resolution-wins), and the
  `validAsOfNow` bi-temporal gate is now applied to archetype/cortex/aether input fetches and
  the traces retrieval leg — a resolved incident exits synthesis and briefing in one cycle
  instead of narrating for weeks (the post-heal hysteresis of 07-24).
- **Quality-over-cost retier** (operator directive 2026-07-24): every cognition path
  (archetype/cortex/contradiction/chat/reflect/daily-message/delta + the always-heavy brief/aether)
  runs the heavy tier (Opus). Mechanical lanes (classify/summarise/voice) stay cheap. Prompt
  caching unchanged.

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

- `lib/kairos/{archetypes,cortex,aether,briefer,introspection,contradiction,chat-distill,daily-message,daily-message-inputs}.ts` (+ matching `*-prompt.ts`, `aether-types.ts`), `cron-trace.ts` (+ `finishReason`/`rawExcerpt` inputs), `version.ts` (`KAIROS_VERSION` — version log in `docs/kairos/CHANGELOG.md`)
- `lib/kairos/thinking/` (queue, registry, deadlines, paid-fallback, 9 handlers), `weekly-review/`, `constitution/` (seed, probes, drift, amendment)
- `lib/kairos/synthesis-health.ts` — daily trace rollup + 2-strike alert (docs/kairos/31)
- `lib/kairos/dispatch.ts`, `recipes/{_recipe,registry,brief}.ts`, `retrieve.ts`, `_prompt-utils.ts` (now holds the shared `parseWithRepair`/`buildRepairPrompt`/`ParseRepairError` helpers)
- `apps/web/src/app/api/cron/*/route.ts`
- `apps/web/vercel.json` — cron schedule
