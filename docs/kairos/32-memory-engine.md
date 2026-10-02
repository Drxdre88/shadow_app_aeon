# 32 — The Memory Engine and the Thinking Queue (P1)

Owner plan: `aeon_os/HANDOVER_2909.md` (addendum 3009) and `research/kairos_2909/vision/engine.md` + `max.md`.
P1 of "close the loops": memories stop being a pile and start being *weighed, aged, backed up, merged and
learned from*; the thinking moves to a queue a Claude Max routine can serve, with the paid key as fallback.

## 1. Two numbers per memory

- **standing** (stored, `memories.standing`, 0..1): how much Kairos trusts and values this memory overall.
  Recomputed nightly by the engine and immediately when the operator reacts. `NULL` = never scored →
  readers fall back to `confidence × recencyMultiplier` (P0 behaviour).
- **relevance** (per query): RRF / rerank score. Final retrieval rank = `relevance × standingFactor`.

`standing = clamp01(base × Π factors)` where `base = CONFIDENCE_BY_STREAM[streamClass]` and each factor comes
from one composable **Scorer** (`lib/kairos/engine/scorers/*`):

| Scorer | Factor |
|---|---|
| SourceTrust | pinned ×1.25; operator reflection ×1.15; own guess (proposal pending) ×0.6 |
| Freshness | `0.5 + 0.5·2^(−age/halfLife)` with age from `max(validAt, lastUsedAt)`; half-life per class: agentic/execution 21d, idea 30d, delta/snapshot 7d, cortex/archetype/aether 30d, concept 120d, reflection 365d |
| Usage | `1 + 0.05·min(useCount, 6)` |
| Support | `1 + 0.1·min(independentSupports, 5)` (lineage-aware, see §3) |
| Outcome | `1 + 0.15·positive − 0.2·negative`, floored at 0.5 |
| Challenged | open contradiction against it ×0.8 |

Superseded / invalid / archived rows get standing 0 and are never rescored.

## 2. The loop (nightly `/api/cron/memory-engine`, 01:30 UTC; `MemoryEngine.runNight`)

1. **Gate/Merge** — the day's new rows with embeddings: cosine ≥ 0.95 to an older live row of the same user
   and stream class → the newer is linked `supersedes`-style as a *reinforcement* of the older (older gets
   `useCount+1`, newer superseded), logged `merge`. Never for reflections or pinned rows.
2. **Weigh + Age** — recompute standing for rows touched in the last 36h plus a rotating id-hash bucket of
   the rest (each row re-examined about every 6 nights). A standing is written only when it moved ≥ 0.05 from
   the **stored** value (so small drifts accumulate and cross later), always with a `score` op; first scores
   are written without one. Writes go in 100-row transactions (0.17).
3. **BackUp (candidate tier)** — pending introspection/contradiction proposals are *candidates* (both
   producers retired in 0.17; the backlog drains). Works in chunks of 25 (support searches 5 at a time, one
   transaction per chunk). A candidate
   is **promoted** when ≥ 2 independent supports exist on ≥ 2 distinct UTC days, where a support is a live
   non-meta memory created after the proposal whose embedding cosine ≥ 0.80 to it, and **independent** means:
   not written by Kairos itself (`source ∉ {cron,system}` unless a Hangar mission or board page), not the
   same session (`sourceMetadata.session.sessionId`), not citing the proposal. Promoted → `status:'promoted'`,
   streamClass `idea`, logged `promote` ("I now believe X" — the operator can veto = revert). Candidates older
   than 21 days without enough support → `status:'decayed'`, archived, logged `decay`.
4. **Concepts** (weekly, Sunday) — spec 26 §4: per Dominion greedy cosine clustering (≥ 0.82, size ≥ 4),
   distil via the thinking queue (`kind:'concept'`), write `type:'concept'`, `streamClass:'concept'`,
   `refers_to` member links; re-run updates by member-set overlap. The nightly step only **plans + enqueues**
   the jobs — it never calls a model (the cron's time budget is shared with every step); the thinking-queue
   sweep owns the API fallback for jobs the routine does not answer.
5. Every change goes through the **ChangeLog** → `memory_ops` (append-only), **flushed after each step** so a
   function timeout never leaves applied writes without their trail; a flush failure is reported as
   `changelog:<step>` in `failedSteps`, keeps the ops buffered for the next flush, and never stops later steps
   (dry runs never flush). `revertMemoryOp(opId)` restores the `before` snapshot and stamps `reverted_at`: both
   rows for a merge, the full concept snapshot (title, body, summary, confidence, links, tags, sourceMetadata;
   embedding re-nulled to re-embed) for a `concept_update`, the counters (relative, atomic) for an outcome
   `feedback`. A revert that would change nothing is refused (`not_revertable`). A promote/decay/merge revert
   is the operator's veto. Undo is via Claude's `revert_memory_op` tool (MCP) or the REST route — the evening
   digest points there; there is no Telegram reply command.

Reactions (immediate, not nightly): a memory cited in a chat answer, used by an answered ask, or accepted
as a proposal → `lastUsedAt=now, useCount+1` (**Usage**, `recordMemoryUse` in `lib/data/memory-reactions.ts`); a dismissed proposal/ask → Outcome negative;
an accepted one → Outcome positive. Each logged `feedback`, in the same transaction as its write.

## 3. Thinking queue (`thinking_jobs`)

Cron posts jobs (`status:'queued'`, `deadline_at`), a **Claude Max routine** claims them through the Aeon MCP
(`claim_thinking_job` → context pack + instructions; `submit_thinking_job` → raw model text), the server
validates, grounds, mints ids and persists through the kind's **handler**. A sweep marks expired jobs and runs
the handler's **API fallback** (the existing BYOK generator), then the deterministic fallback if that fails.
The server never calls Claude with plan credentials (Anthropic terms); Claude comes to the brain.

Handlers (`lib/kairos/thinking/handlers/*`): `aether`, `cortex` (P1), `concept` (P1); archetypes, digest and
chat follow in P2. Idempotency: `unique(user_id, external_key)`, e.g. `aether:2026-10-01`.

**Fallback without a sweep for aether/cortex:** the existing 03:00/03:15 crons stay in place. A routine that
answered first leaves today's cortex/aether row, so the cron's `alreadyRanToday` guard skips; if the routine
never came, the cron runs on the paid key exactly as before. Jobs are planned lazily on `claim` when their
prerequisites are met (cortex after today's archetypes; aether after today's cortex rows or the cortex
deadline), so one routine run can drain the whole night in order. An hourly sweep marks expired jobs
`expired` (aether/cortex) or runs the handler fallback (concept).

## 4a. Shared metadata keys (read by the scorers, written by the lanes)

- `sourceMetadata.engine.outcome = { positive, negative }` — operator reactions (accept/answer/cite vs dismiss/veto).
- `sourceMetadata.engine.support = { independentSupports, distinctDays }` — written by BackUp for candidates.
- `sourceMetadata.status` on proposals: `pending` → `promoted` | `decayed` | `accepted` | `dismissed`.
- `sourceMetadata.engine.vetoes = { [op]: { opId, at } }` — one slot per op kind (`promote` | `decay` | `merge`),
  written by a revert of that op; BackUp skips promote if `vetoes.promote`, decay if `vetoes.decay`; Merge skips
  if `vetoes.merge` — so a revert is not redone the next night. The legacy single-slot
  `engine.veto = { op, opId, at }` is still read (never written).

Routine playbook: `docs/kairos/33-thinking-routine.md` (what the routine reads and does each run).

## 4. Data

Migration `drizzle/0039_kairos_memory_engine.sql` (applied by `scripts/apply-memory-engine-migration.mjs`,
declared in `schema.ts`, checked by `verify-schema-drift.mjs`): `memories.standing`, `standing_at`,
`last_used_at`, `use_count`; tables `memory_ops`, `thinking_jobs`. Memory type `concept` + stream class
`concept` are varchar values (no DDL).

## 5. P2.5 — Ground and protect (Kairos 0.14, 01/10)

Research and gap list: `research/kairos_0110/00_verdict.md` (G1–G9).

**Origin, fixed at write.** Every memory written through `createMemory` / `captureMemory` /
`captureReflection` / `acceptProposal` carries `sourceMetadata.origin = { kind, via }` (`lib/kairos/origin.ts`):
`operator` (owner session UI, REST with session cookie, Telegram, ask answers, accepts from the inbox/Telegram)
· `activity` (board day/week pages, Hangar missions) · `agent` (every MCP tool, REST with a bearer key, session
hooks, dialogue reflections, accepts through MCP/bearer REST) · `kairos` (Kairos syntheses; chat-distill and
introspection take `derivedOriginKind` of their inputs, so a pool with external content yields `external`) ·
`external` (webhook capture, imports). Clients can never set it; the row's `source` caps it. Unlabelled
(pre-0.14) rows are inferred from `source` by `inferOriginKind`.

**Standing.** SourceTrust boosts a reflection only for operator origin (×1.15; activity/agent ×1, kairos ×0.9,
external ×0.7 on any class). Half-lives: belief 365 d, advisory 14 d, trace 7 d; the constitution never fades.

**Gate/Merge** now looks at rows created in the last 96 h (was 36 h; cap 400/night, oldest first) because most
rows are embedded only by the 04:00 UTC backfill, after the 01:30 engine run.

**BackUp** additionally needs `anchoredSupports ≥ 1`: at least one independent support of operator or activity
origin (stored in `engine.support.anchoredSupports`). AI-written material alone can't confirm Kairos's guesses.

**Recheck** (new step; night order is Merge → Weigh → OwnMind → Recheck → BackUp → Concepts, so the cheap belief
steps run before BackUp, which can exhaust the time budget while a proposal backlog drains; a promotion is mirrored
the night after). Up to 200 held beliefs a night whose provenance memory was deleted,
archived, invalidated, or superseded with no live survivor are flagged `belief.recheck = { since, lostSources }`
and their confidence × 0.7 (floor 0.1), op `recheck` (revertable; the revert records
`engine.vetoes.recheck.lostSources`). A Merge supersession is not a loss: provenance is remapped to the survivor
(op `feedback`). An own-mind belief with no provenance left is retired (op `retire`). With budget left after
the loss check, `recheck` also **normalises legacy beliefs**: when the stored `sourceType` differs from what the
live provenance origins give, or confidence exceeds that type's cap, it sets the computed type, caps confidence
(never raises it), stamps `belief.normalisedAt`, and writes one revertable `feedback` op (`after.normalised: true`);
reverting records `engine.vetoes.normalise`.

**Retrieval.** Chat grounding (`retrieve.ts` FTS, vector and trace legs), `prepareContext` neighbours and its
pinned leg exclude superseded and invalidated rows. The 90-day substrate window exempts `concept`, `belief` and
`constitution`.
