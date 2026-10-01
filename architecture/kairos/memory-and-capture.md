# Kairos — Memory Substrate & Capture

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [synthesis](synthesis.md) · [chat](chat.md)

The substrate is one user-scoped table, `memories`, plus the ingress paths that feed it and the
hybrid retrieval that reads it back. Every data-layer function takes `userId` as a required
filter and never returns rows the user does not own.

## 1. The `memories` table

Schema in `apps/web/src/lib/db/schema.ts`; migrations `0015_kairos_summaries`,
`0021_memory_stream_class`, `0023_memory_embeddings`, `0024_memory_provenance`,
**`0025_memory_valid_time`** (bi-temporal), **`0039_kairos_memory_engine`** (standing + ops + jobs).

- **Display + body:** `title`, `aiTitle` (1–6 word headline), `summary`, `execSummary` (jsonb bullets), `bodyMd`.
- **`type`** (`memoryTypeSchema`, `lib/data/validators/memory.ts`): note, decision, idea, observation, session_summary, reflection, snapshot, inbound, advisory, achievement, session_event, fact, contact, external_event, archetype, dominion_cortex, aether, **concept, belief, constitution**.
- **`streamClass`** (`lib/kairos/streamClass.ts`, 14): idea, agentic, execution, reflection, cortex, archetype, advisory, trace, snapshot, aether, **delta, concept, belief, constitution**. `META_STREAM_CLASSES = trace | delta | snapshot` are excluded by every synthesis/engine/chat reader. `createMemorySchema` deliberately does NOT expose `streamClass` — only internal callers set it; public writes default via the capture choke point (§3). `type` and `streamClass` are orthogonal.
- **Memory-engine columns (0039):** `standing` (0–1), `standing_at`, `last_used_at`, `use_count` (+ `memories_standing_idx`); sibling tables `memory_ops` (undo ledger) and `thinking_jobs` (queue) — see [synthesis.md](synthesis.md) §Thinking queue.
- **Embedding / confidence / provenance:** `embedding vector(1024)` + `embedding_model` (HNSW `vector_cosine_ops`); `confidence` (trust prior from the stream via `CONFIDENCE_BY_STREAM`, `memories.ts:52`); `source` (`manual`/`system`/`cron`/`claude`/`codex`/`copilot`/`webhook`/`voice`) + `sourceMetadata` jsonb (carries `externalId`, `sessionId`, `client`, `repo`, `runId`, `citations`, `kairosSpeak` for speaks-first deliveries, `chatDistill` provenance, `kairosAutoFiled.similarity`, …); typed-edge `links` jsonb; `pinned`, `archivedAt`, `supersededAt`/`supersededById`. FTS via a raw-SQL generated `fts tsvector` + GIN.
- **Bi-temporal validity (0025, PR #72):** `validAt` (NOT NULL, defaultNow) / `invalidAt` (nullable) = when the claim was true **in the world**; `supersededAt` = when we **learned** it changed. Read path: `getBeliefTrail()` (`memories.ts:744`) walks the supersession chain both directions and returns nodes with `validFrom`/`invalidFrom`; backs MCP `get_belief_trail` + `GET /api/v1/memories/[id]/trail`. `getGraphForUser` projects `invalidAt` so the galaxy is bi-temporal-aware.
- **Read-time confidence decay (PR #73, `lib/kairos/confidence.ts`):** `HALF_LIFE=90d`, `FLOOR=0.5`, `WEIGHT=0.6`, decays off `updatedAt` (deliberately distinct from the 14-day retrieval recency signal); pinned rows exempt. The same function drives galaxy brightness, so search and the galaxy always agree.

## 2. Dominion resolution order

`resolveDominionForMemory()` (`dominions.ts:323`), in strict order: (1) explicit `input.dominionId`;
(2) `project.dominionId`; (3) `dominionRepos` lookup by `sourceMetadata.repo`; (4) **content-based
auto-filing** (PR #76, `lib/kairos/autofile.ts`); (5) `null`. Runs inside `createMemory()` only when
`dominionId` is not already set. **Soft association** via `dominion:<uuid>` tags (`dominionTags.ts`)
lets one memory be *referenced* by many Dominions; retrieval unions the FK leg and the tag leg
(`inDominionScope`, `retrieve.ts:52`).

**Auto-filing (step 4) detail:** only for `AUTO_FILE_STREAMS = {idea, reflection, execution,
agentic}` (machine-synthesis streams never auto-file). Embeds `title+summary+body`, then
`classifyDominionByContent()` (`memories.ts:902`) scans live cortex rows with an **exact in-process
cosine** (deliberately NOT HNSW — the index post-filtered to ~1 cortex row per Dominion silently
returns nothing). Similarity ≥ `KAIROS_AUTO_FILE_MIN_SIM` (env, default 0.55, clamped 0.3–0.95)
→ assign `dominionId` + soft `dominion:<id>` tag + `sourceMetadata.kairosAutoFiled.similarity`
audit stamp. The computed embedding is stored on the row either way (instantly vector-searchable).
Below-threshold / any failure → unfiled; capture never breaks.

## 3. Capture paths (ingress)

All inbound writes funnel through `captureMemory()` (`memories.ts:963`) — normalises
`channel`→`source='webhook'` and enforces **externalId idempotency**. `createMemory()`
(`memories.ts:800`) also enforces **client + sessionId idempotency** across Claude, Codex, Copilot, and compatibility-fallback captures.

**Capture choke point:** `lib/kairos/stream-class-default.ts` → `defaultStreamClass(source, type, sourceMetadata)` picks the stream when the caller gives none (explicit always wins), and `validAt` is taken from `sourceMetadata.session.endedAt` when it is within 7 days. **Session record v1** lives at `sourceMetadata.session` (`lib/kairos/session-record.ts`, mirrored by `apps/web/scripts/session-record.mjs`; required `v`, `client`, `sessionId`).

| Path | File | What it writes |
|---|---|---|
| Mission memory | `lib/kairos/mission-memory.ts` | Hangar mission result → ONE `session_summary` (`externalId hangar:{sessionId}`) |
| Board feed | `lib/kairos/board-feed{,-render}.ts` | inside the 23:00Z `project-snapshot` cron, for projects with `settings.kairosFeed` = `daily`/`weekly`: `board_day`/`board_week` digests (`type='achievement'`, `streamClass='agentic'`) |
| `card_notes` nudge | `ask-mine` cron (04:30Z) | asks for missing card context; answers are appended to the card (or vault) description; asks expire after 72h |

- **Auto-capture (board / project)** — `lib/kairos/auto-capture.ts`: `captureBoardEvent` (snapshot/achievement), `captureProjectEvent`. Fire-and-forget, `source='system'`.
- **Project-snapshot cron** — `lib/kairos/project-snapshot.ts`: `runProjectSnapshotsForUser` (one `streamClass='snapshot'` memory per active project per day), plus `runEphemeralLifecycleForUser` — the nightly "compost" pass that archives snapshots past `SNAPSHOT_TTL_DAYS=7` / advisories past `ADVISORY_TTL_DAYS=14` (`lifecycle.ts`), stamping `archivedAt` (never deletes). Cron: `project-snapshot`, 23:00 UTC.
- **Quick capture + capture endpoint** — the FAB overlay and `POST /api/v1/memories/capture` (channel + externalId dedup).
- **Coding-agent session-capture hook** — `apps/web/scripts/claude-session-capture.mjs` normalises Claude, Codex, and Copilot transcripts into `type='session_summary'` memories with matching source provenance. Every SessionEnd first writes a durable local job and exits; a machine-wide lock lets one drain worker process jobs sequentially, with bounded HTTP and whole-job retries plus persistent failure logs. Per-client success receipts make restart and SessionStart backfill idempotent. Copilot reads completed sessions from `~/.copilot/session-store.db`; SessionStart queues up to five recent sessions without receipts. Until a deployed Aeon accepts a new first-class source, the client retries as `source='hook'` while preserving `sourceMetadata.client` and `originalSource`. Server writes take a transaction-scoped capture lock, so simultaneous deliveries for the same user/client/session converge on one memory. The hook resolves the Aeon project from the repo slug and always exits 0. Claude backfill remains available through `--backfill`. **Overhauled 2026-06-27:**
  1. **Child-session guard** — sessions spawned by Kairos's own hooks (the async summariser's headless `claude -p`, the optional `claude --print` cleanup) no longer capture themselves as junk. Primary guard: `AEON_HOOK_CHILD=1` env on spawned children (checked at `runFromHook`; set when the summariser/cleanup spawn); text-sentinel backstop `isAutomatedSession()` catches old backfill transcripts.
  2. **Stronger substance gate** (`processSession`) — keeps anything with real output (an Executive Summary, files touched, ≥`MIN_TOOL_USES` tools) AND genuine multi-turn design/planning sessions (≥`MIN_USER_TURNS` turns with ≥240 chars of user text); drops empty stubs and one-line throwaways.
  3. **Deterministic in-hook enrichment** — `deriveAiTitle()` always sets a floor `aiTitle`; `extractExecutiveSummary`/`parseExecBullets` pull `execSummary` from the mandated `## Executive Summary`. The async summariser (`~/.claude/hooks/summarise-memories`, outside this repo) is the fallback that upgrades prose; it now **drains the backlog in a looped batch of 12** instead of 3-at-a-time. Optional in-hook `claude --print` cleanup remains opt-in via `BRAIN_AI_CLEANUP=1`.
  The backfill path paces posts (~150ms), backs off exponentially on 429/5xx, aborts after 3 consecutive server errors.
  Installation, verification, and the contract for adding another client live in [docs/kairos/05-session-capture.md](../../docs/kairos/05-session-capture.md).
- **Reflections (`kairos_reflect`)** — the operator's highest-weight signal. `captureReflection()` (`memories.ts:1026`) bypasses `createMemorySchema` to lock `streamClass='reflection'` (confidence 0.9). MCP tool in `tools/reflections.ts`.
- **Chat distillation (PR #89)** — nightly `chat-distill` cron (02:00 UTC, before archetypes): skims each kairos-chat thread's prior-UTC-day turns (Telegram included), BYOK-distils **operator-stated** signal only into `type='reflection'`/`source='cron'` memories (cap 5/thread/day, `externalId chat-distill:{date}:{threadId}:{n}`, `sourceMetadata.chatDistill` provenance). Anchored threads keep their Dominion; unanchored/Telegram threads auto-file. **Per-thread failures now write a cron-failure trace** (`writeCronFailureTrace`, `cronName:'chat-distill'`, `reason:'thread_distill_failed'`) instead of failing silently (docs/kairos/31, B1). `lib/kairos/chat-distill{,-prompt}.ts`.
- **Kairos speaks (`/api/v1/kairos/speak`, PR #85/#88)** — Kairos-initiated messages persist as `type='inbound'`/`source='system'` with `sourceMetadata.kairosSpeak:true` (Will-inbox item + Telegram fan-out). `listRecentKairosSpeaks()` (`memories.ts:1174`) backs the route's interrupt throttle (archived speaks still count).
- **Guided introspection (propose-not-commit)** — `lib/kairos/introspection.ts`: reads recent substrate + cortex, asks the model for grounded proposals, filters to those citing real memory ids, writes each as a STAGED `type='inbound'`/`streamClass='agentic'` memory with `refers_to` provenance links. Proposals are never canonical: the operator **commits** via `acceptProposal()` (`memories.ts:1299`) — promotes to reflection/note/observation, re-stamps confidence, stamps superseded beliefs; dismissal is archival. Cron: `introspection`, 06:30 UTC. (Chaos for seeing, control for changing.)

## 4. The summary backlog + summariser

Captures land with a deterministic floor `aiTitle`/`execSummary` from the hook. Rows still
missing rich summaries surface via `list_memories_needing_summary` (MCP) +
`GET /api/v1/memories/needs-summary`; the async summariser hook drains that backlog (now batch
12, looped). There is no LLM on the server write path — enrichment happens at the hook /
summariser call site (and via the **Acolyte** lieutenant, see [chat.md](chat.md)).

## 5. Hybrid retrieval — the full pipeline

**Pipeline (post PRs #73/#75):** FTS + vector legs → RRF fuse (k=60) → **confidence-decay weight**
(`confidenceBoost`, applied to the fused score) → reflection bonus → **rerank pool of 12** →
**Voyage `rerank-2.5` cross-encoder** (`lib/kairos/rerank.ts`; no key / any error → null, caller
keeps prior order) → top-5.

**Shared ranker (`lib/kairos/ranking.ts`):** every retrieval path orders by `rankScore = relevance ×
standingFactor`, where `standingFactor = 0.5 + standing` for engine-scored rows (0.5–1.5) and
falls back to `confidenceBoost × recencyMultiplier` for unscored rows.

- **`retrieveContext()`** (`retrieve.ts`) — canonical Dominion-scoped fetch for recipes. Returns `{ bundle, cortex, archetypes, substrate, traces }`. Substrate over reflection/idea/agentic, 90-day window. FTS via `websearch_to_tsquery` + `ts_rank_cd`; when `embeddingsEnabled()` adds the vector leg (`hnsw.ef_search=100`, `ORDER BY embedding <=> $vec`). Best-effort: any vector error falls back to pure FTS.
- **`retrieveGlobalContext()`** (`retrieve.ts:106`) — **whole-brain retrieval** (PR #75): `dominionId=null` collapses scope predicates to TRUE, the latest Aether doc stands in for per-Dominion cortex. Same confidence+rerank pipeline. Powers the unanchored chat (see [chat.md](chat.md)).
- **`prepareContext()`** (`memories.ts:1754`) — generic budget-packed bundle (FTS + optional vector fused by `fuseHybrid`, + pinned + 1-hop graph walk + recency-decayed scoring). Backs `prepare_context` MCP + `GET /api/v1/memories/context`. **MCP `search_memories` is a separate path — no rerank there.**

**Embeddings** (`lib/kairos/embeddings.ts`): one app-owned key — Voyage `voyage-3.5` @ 1024-dim
primary, OpenAI `text-embedding-3-small` (truncated to 1024) fallback; none → disabled, retrieval
is pure FTS. `backfillEmbeddings()` is idempotent/incremental (returns `remaining`);
`updateMemory()` nulls the vector on title/summary/body change so the row re-embeds. Cron:
`embed-backfill`, 04:00 UTC. Doc: `docs/kairos/22-semantic-hybrid-retrieval.md`.

## 6. Dedup

`dedupMemories()` (`memories.ts:1535`): a pgvector self-join finds pairs within cosine threshold
(`DEFAULT_DEDUP_THRESHOLD=0.97`), union-find clusters them, `pickCanonical` keeps
pinned > highest-confidence > newest, losers are **superseded** (never deleted). Only
machine-generated types auto-merge (`AUTO_DEDUP_TYPES=['session_event']`); operator-authored
types go through the propose-not-commit gate. Cron: `memory-dedup`, Sunday 05:00 UTC.

## 7. Memory engine (0039, PR #134)

Cron `memory-engine`, **01:30 UTC**; 230s budget, always writes a trace; `?dryRun=1` previews.
Steps run in registry order (`lib/kairos/engine/registry.ts`, `engine/steps/*`):

| Step | Does |
|---|---|
| Merge | folds a near-verbatim repeat (cosine ≥ 0.95, same stream class) into the OLDER live row as reinforcement (`useCount+1`) |
| Weigh | recomputes `standing = clamp01(base × Π scorer factors)`; scorers `source-trust`, `freshness`, `usage`, `support`, `outcome`, `challenged` (`engine/scorers/*`) |
| BackUp | Kairos's pending introspection proposals: ≥2 supports on ≥2 UTC days → promoted to `idea`; no backing in 21 days → decays (archived); ≤400 candidates/night |
| OwnMind | mirrors engine promotions into Kairos's own beliefs (`beliefs/mirror.ts`); retires mirrors of reverted promotions |
| Concepts | Sundays only — enqueues `concept` thinking jobs, writes nothing itself |

Every live change writes its `memory_ops` row **in the same transaction** (`engine/change-log.ts`);
any op is revertible via MCP `revert_memory_op`, REST `POST /api/v1/kairos/memory-ops/[id]/revert`,
or chat `undo_kairos_change` (`engine/revert.ts`). A reverted promote/decay/merge leaves a per-op
veto slot (`sourceMetadata.engine.vetoes[op]`) so the next night does not redo it. **Reactions** (`lib/kairos/reactions.ts` → `lib/data/memory-reactions.ts`) trigger an
immediate rescore (`lib/kairos/rescore.ts`, applied only when |Δ| ≥ 0.05).

## 8. Belief ledger — two minds

Beliefs are `type/streamClass='belief'` rows in `memories` (no dedicated table).

| Mind | Source |
|---|---|
| Aligned (operator's) | `belief_extract` thinking job distils stated beliefs from the substrate |
| Own (Kairos's) | `OwnMindStep` (`beliefs/mirror.ts`) mirrors engine promotions |

Weekly `mind_compare` pairs same-topic beliefs at cosine ≥ 0.82 (`beliefs/compare.ts`) and records
agreements/divergences; read via MCP `list_beliefs` / `get_mind_comparison`.

## 9. Constitution

`lib/kairos/constitution/*`: exactly ONE live `constitution` version; a new version supersedes the
old. Seeded by `constitution-seed` (Mon 04:20 UTC). Amendments arrive as proposals
(`propose_constitution_amendment`); **only the operator accepts** — in the Will inbox or Telegram
(`lib/kairos/proposal-accept.ts`). MCP `accept_proposal` and bearer REST accept refuse amendments
(403). Drift probes (`constitution/probes.ts`, `drift.ts`) — see [synthesis.md](synthesis.md).

## Key files

- `apps/web/src/lib/db/schema.ts` — `memories` + Dominion tables
- `apps/web/src/lib/data/memories.ts` — capture / create / reflection / accept-proposal / search / backfill / dedup / prepareContext
- `apps/web/src/lib/data/{validators,dominions}.ts`
- `apps/web/src/lib/kairos/{streamClass,dominionTags,lifecycle,dedup,embeddings,retrieve,auto-capture,project-snapshot,introspection,confidence,rerank,rrf,autofile,contradiction,chat-distill,cron-trace}.ts` — `cron-trace` failure input gained `finishReason` + bounded `rawExcerpt` (docs/kairos/31, A6)
- `apps/web/src/lib/kairos/{stream-class-default,session-record,mission-memory,board-feed,board-feed-render,ranking,reactions,rescore,proposal-accept}.ts`
- `apps/web/src/lib/kairos/{engine,beliefs,constitution,concepts}/` — memory engine, two minds, constitution + drift, concept clustering
- `apps/web/src/lib/data/{memory-engine,memory-ops,memory-candidates,memory-reactions,memory-rescore,beliefs,concepts,constitution,constitution-drift,mind-compare}.ts`
- `apps/web/scripts/session-record.mjs` — hook-side mirror of session record v1
- `apps/web/scripts/claude-session-capture.mjs` — shared session-capture pipeline
- `apps/web/scripts/{claude,codex,copilot}-session-capture-dispatch.mjs` — short-lived durable-queue lifecycle dispatchers
- `apps/web/scripts/session-capture-{queue,drain}.mjs` — receipts, spool, global drain lock, retry diagnostics
- `apps/web/scripts/copilot-session-capture-backfill.mjs` — receipt-aware Copilot SessionStart recovery
- `apps/web/scripts/{session-transcript,copilot-session-transcript}.mjs` — transcript normalization and Copilot SQLite reader
