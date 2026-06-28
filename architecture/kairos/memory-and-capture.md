# Kairos — Memory Substrate & Capture

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [synthesis](synthesis.md) · [chat](chat.md)

The substrate is one user-scoped table, `memories`, plus the ingress paths that feed it and the
hybrid retrieval that reads it back. Every data-layer function takes `userId` as a required
filter and never returns rows the user does not own.

## 1. The `memories` table

Schema in `apps/web/src/lib/db/schema.ts`; migrations `0015_kairos_summaries`,
`0021_memory_stream_class`, `0023_memory_embeddings`, `0024_memory_provenance`.

- **Display + body:** `title`, `aiTitle` (1–6 word headline), `summary`, `execSummary` (jsonb bullets), `bodyMd`.
- **`type`** (`memoryTypeSchema`, `validators.ts:319`): note, decision, idea, observation, session_summary, reflection, snapshot, inbound, advisory, achievement, session_event, fact, contact, external_event, archetype, dominion_cortex, aether.
- **`streamClass`** (`streamClass.ts`): idea, agentic, execution, reflection, cortex, archetype, advisory, trace, snapshot, aether. `createMemorySchema` deliberately does NOT expose `streamClass` — only internal callers set it; public writes default to `idea`. `type` and `streamClass` are orthogonal.
- **Embedding / confidence / provenance:** `embedding vector(1024)` + `embedding_model` (HNSW `vector_cosine_ops`); `confidence` (trust prior from the stream via `CONFIDENCE_BY_STREAM`, `memories.ts:52`); `source` (`manual`/`system`/`cron`/`claude`/`webhook`/`voice`) + `sourceMetadata` jsonb (carries `externalId`, `sessionId`, `repo`, `runId`, `citations`, …); typed-edge `links` jsonb; `pinned`, `archivedAt`, `supersededAt`/`supersededById`. FTS via a raw-SQL generated `fts tsvector` + GIN.

## 2. Dominion resolution order

`resolveDominionForMemory()` (`dominions.ts:323`), in strict order: (1) explicit `input.dominionId`;
(2) `project.dominionId`; (3) `dominionRepos` lookup by `sourceMetadata.repo`; (4) `null`. Runs
inside `createMemory()` only when `dominionId` is not already set. **Soft association** via
`dominion:<uuid>` tags (`dominionTags.ts`) lets one memory be *referenced* by many Dominions;
retrieval unions the FK leg and the tag leg (`inDominionScope`, `retrieve.ts:52`).

## 3. Capture paths (ingress)

All inbound writes funnel through `captureMemory()` (`memories.ts:731`) — normalises
`channel`→`source='webhook'` and enforces **externalId idempotency**. `createMemory()` also
enforces **sessionId idempotency** for `source='claude'` (`:647`).

- **Auto-capture (board / project)** — `lib/kairos/auto-capture.ts`: `captureBoardEvent` (snapshot/achievement), `captureProjectEvent`. Fire-and-forget, `source='system'`.
- **Project-snapshot cron** — `lib/kairos/project-snapshot.ts`: `runProjectSnapshotsForUser` (one `streamClass='snapshot'` memory per active project per day), plus `runEphemeralLifecycleForUser` — the nightly "compost" pass that archives snapshots past `SNAPSHOT_TTL_DAYS=7` / advisories past `ADVISORY_TTL_DAYS=14` (`lifecycle.ts`), stamping `archivedAt` (never deletes). Cron: `project-snapshot`, 23:00 UTC.
- **Quick capture + capture endpoint** — the FAB overlay and `POST /api/v1/memories/capture` (channel + externalId dedup).
- **Claude session-capture hook** — `apps/web/scripts/claude-session-capture.mjs` (a SessionEnd hook; also `--backfill`). Distils each finished session into a `type='session_summary'`, `source='claude'` memory; resolves the Aeon project from the repo slug; always exits 0. **Overhauled 2026-06-27:**
  1. **Child-session guard** — sessions spawned by Kairos's own hooks (the async summariser's headless `claude -p`, the optional `claude --print` cleanup) no longer capture themselves as junk. Primary guard: `AEON_HOOK_CHILD=1` env on spawned children (checked at `runFromHook`; set when the summariser/cleanup spawn); text-sentinel backstop `isAutomatedSession()` catches old backfill transcripts.
  2. **Stronger substance gate** (`processSession`) — keeps anything with real output (an Executive Summary, files touched, ≥`MIN_TOOL_USES` tools) AND genuine multi-turn design/planning sessions (≥`MIN_USER_TURNS` turns with ≥240 chars of user text); drops empty stubs and one-line throwaways.
  3. **Deterministic in-hook enrichment** — `deriveAiTitle()` always sets a floor `aiTitle`; `extractExecutiveSummary`/`parseExecBullets` pull `execSummary` from the mandated `## Executive Summary`. The async summariser (`~/.claude/hooks/summarise-memories`, outside this repo) is the fallback that upgrades prose; it now **drains the backlog in a looped batch of 12** instead of 3-at-a-time. Optional in-hook `claude --print` cleanup remains opt-in via `BRAIN_AI_CLEANUP=1`.
  The backfill path paces posts (~150ms), backs off exponentially on 429/5xx, aborts after 3 consecutive server errors.
- **Reflections (`kairos_reflect`)** — the operator's highest-weight signal. `captureReflection()` (`memories.ts:794`) bypasses `createMemorySchema` to lock `streamClass='reflection'` (confidence 0.9). MCP tool in `tools/reflections.ts`.
- **Guided introspection (propose-not-commit)** — `lib/kairos/introspection.ts`: reads recent substrate + cortex, asks the model for grounded proposals, filters to those citing real memory ids, writes each as a STAGED `type='inbound'`/`streamClass='agentic'` memory with `refers_to` provenance links. Proposals are never canonical: the operator **commits** via `acceptProposal()` (`memories.ts:1035`) — promotes to reflection/note/observation, re-stamps confidence, stamps superseded beliefs; dismissal is archival. Cron: `introspection`, 06:30 UTC. (Chaos for seeing, control for changing.)

## 4. The summary backlog + summariser

Captures land with a deterministic floor `aiTitle`/`execSummary` from the hook. Rows still
missing rich summaries surface via `list_memories_needing_summary` (MCP) +
`GET /api/v1/memories/needs-summary`; the async summariser hook drains that backlog (now batch
12, looped). There is no LLM on the server write path — enrichment happens at the hook /
summariser call site (and via the **Acolyte** lieutenant, see [chat.md](chat.md)).

## 5. Hybrid retrieval — FTS + pgvector

- **`retrieveContext()`** (`retrieve.ts:65`) — canonical fetch for recipes/chat. Returns `{ bundle, cortex, archetypes, substrate, traces }`. Substrate is top-5 over reflection/idea/agentic, 90-day window, reflections boosted. FTS via `websearch_to_tsquery` + `ts_rank_cd`; when `embeddingsEnabled()` it adds a vector leg (`hnsw.ef_search=100`, `ORDER BY embedding <=> $vec`) and fuses with Reciprocal Rank Fusion (`rrfFuse`, k=60). Best-effort: any vector error falls back to pure FTS.
- **`prepareContext()`** (`memories.ts:1357`) — generic budget-packed bundle (FTS + optional vector fused by `fuseHybrid`, + pinned + 1-hop graph walk + recency-decayed scoring). Backs `prepare_context` MCP + `GET /api/v1/memories/context`.

**Embeddings** (`lib/kairos/embeddings.ts`): one app-owned key — Voyage `voyage-3.5` @ 1024-dim
primary, OpenAI `text-embedding-3-small` (truncated to 1024) fallback; none → disabled, retrieval
is pure FTS. `backfillEmbeddings()` is idempotent/incremental (returns `remaining`);
`updateMemory()` nulls the vector on title/summary/body change so the row re-embeds. Cron:
`embed-backfill`, 04:00 UTC. Doc: `docs/kairos/22-semantic-hybrid-retrieval.md`.

## 6. Dedup

`dedupMemories()` (`memories.ts:1219`): a pgvector self-join finds pairs within cosine threshold
(`DEFAULT_DEDUP_THRESHOLD=0.97`), union-find clusters them, `pickCanonical` keeps
pinned > highest-confidence > newest, losers are **superseded** (never deleted). Only
machine-generated types auto-merge (`AUTO_DEDUP_TYPES=['session_event']`); operator-authored
types go through the propose-not-commit gate. Cron: `memory-dedup`, Sunday 05:00 UTC.

## Key files

- `apps/web/src/lib/db/schema.ts` — `memories` + Dominion tables
- `apps/web/src/lib/data/memories.ts` — capture / create / reflection / accept-proposal / search / backfill / dedup / prepareContext
- `apps/web/src/lib/data/{validators,dominions}.ts`
- `apps/web/src/lib/kairos/{streamClass,dominionTags,lifecycle,dedup,embeddings,retrieve,auto-capture,project-snapshot,introspection}.ts`
- `apps/web/scripts/claude-session-capture.mjs` — session-capture hook
