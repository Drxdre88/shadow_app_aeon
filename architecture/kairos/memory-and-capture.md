# Kairos — Memory Substrate & Capture

> Part of the Aeon architecture set — index: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · siblings: [overview](overview.md) · [synthesis](synthesis.md) · [chat](chat.md)

The substrate is one user-scoped table, `memories`, plus the ingress paths that feed it and the
hybrid retrieval that reads it back. Every data-layer function takes `userId` as a required
filter and never returns rows the user does not own. State as of Kairos 0.15 (`origin/main` 9477bb1).

## 1. The `memories` table

Schema in `apps/web/src/lib/db/schema.ts`; migrations `0015_kairos_summaries`,
`0021_memory_stream_class`, `0023_memory_embeddings`, `0024_memory_provenance`,
**`0025_memory_valid_time`** (bi-temporal), **`0039_kairos_memory_engine`** (standing + ops + jobs).
0.14/0.15 added no DDL: origin, belief re-check and idea metadata are all `sourceMetadata` jsonb.

- **Display + body:** `title`, `aiTitle` (1–6 word headline), `summary`, `execSummary` (jsonb bullets), `bodyMd`.
- **`type`** (`memoryTypeSchema`, `lib/data/validators/memory.ts`): note, decision, idea, observation, session_summary, reflection, snapshot, inbound, advisory, achievement, session_event, fact, contact, external_event, archetype, dominion_cortex, aether, concept, belief, constitution. The idea tournament also writes **`idea_candidate`** (`IDEA_CANDIDATE_TYPE`, `lib/kairos/ideas/types.ts:28`) by direct insert. It is not in the public schema.
- **`streamClass`** (`lib/kairos/streamClass.ts`, 14): idea, agentic, execution, reflection, cortex, archetype, advisory, trace, snapshot, aether, delta, concept, belief, constitution. `META_STREAM_CLASSES = trace | delta | snapshot` are excluded by every synthesis/engine/chat reader. `createMemorySchema` deliberately does NOT expose `streamClass`; only internal callers set it. `type` and `streamClass` are orthogonal.
- **Memory-engine columns (0039):** `standing` (0–1), `standing_at`, `last_used_at`, `use_count`; sibling tables `memory_ops` (undo ledger) and `thinking_jobs` (queue). See [synthesis.md](synthesis.md) §Thinking queue.
- **Embedding / confidence / provenance:** `embedding vector(1024)` + `embedding_model` (HNSW `vector_cosine_ops`); `confidence` (stream prior, `CONFIDENCE_BY_STREAM`, `lib/kairos/confidence.ts:30`); `source` (`manual`/`system`/`cron`/`claude`/`codex`/`copilot`/`webhook`/`voice`/`import`/`hook`) + `sourceMetadata` jsonb. It carries `origin` (§1a), `externalId`, `sessionId`, `client`, `repo`, `citations`, `kairosSpeak`, `chatDistill`, `kairosAutoFiled.similarity`, `belief` (§8), `idea` (§10), `engine.*`. Also typed-edge `links` jsonb, `pinned`, `archivedAt`, `supersededAt`/`supersededById`, and FTS via a generated `fts tsvector` + GIN.
- **Bi-temporal validity (0025):** `validAt` / `invalidAt` = when the claim was true **in the world**; `supersededAt` = when we **learned** it changed. `getBeliefTrail()` (`memories.ts:810`) walks the supersession chain both ways and backs MCP `get_belief_trail` + `GET /api/v1/memories/[id]/trail`.
- **Read-time confidence decay (`lib/kairos/confidence.ts`):** `HALF_LIFE=90d`, `FLOOR=0.5`, `WEIGHT=0.6`, decays off `updatedAt`; pinned rows are exempt. The same function drives galaxy brightness.

## 1a. Origin: who wrote the row (0.14)

Contract: `lib/kairos/origin.ts`; spec: docs/kairos/32 §5. Origin is stamped at write as `sourceMetadata.origin = { kind, via? }`.
Trust follows the origin, never the wording.

| kind | `ORIGIN_TRUST` (`origin.ts:24`) | Meaning |
|---|---|---|
| `operator` | 1.0 | the owner's own words through an owner-authenticated surface |
| `activity` | 0.8 | machine records of real work (`sourceMetadata.kind` = `board_day`/`board_week`/`hangar_mission`) |
| `agent` | 0.7 | an AI client acting for the owner (MCP, bearer REST, session hooks) |
| `kairos` | 0.5 | Kairos's own synthesis (crons, thinking jobs) |
| `external` | 0.3 | ingested third-party content (`webhook`, `import`) |

- **Trusted surfaces pass it as `MemoryWriteOptions.origin`**, never through zod input. Any client-supplied `sourceMetadata.origin` is overwritten, because `origin` is spread last (`memories.ts:969`, `:1216`). The surfaces are:
  - UI server actions → `operator/ui` (`lib/actions/memories.ts:110,117`)
  - REST create/update/capture/accept: bearer → `agent/rest`, session cookie → `operator/rest-session` (`app/api/v1/memories/route.ts:67`, `[id]/route.ts:41`, `capture/route.ts:34`, `[id]/accept/route.ts:44`)
  - MCP memory/reflection/accept tools → `agent/mcp` (`tools/memories.ts:126,167,417`, `tools/reflections.ts:53`)
  - Inbox ask answers → `operator/ask` (`lib/actions/kairos-inbox.ts:25`). Chat/Telegram ask answers are `operator/ask`, or `kairos/ask-distilled` when distilled (`chat-turn-reply.ts:118`). The `askKairos` default is `agent/ask` (`ask.ts:139`).
  - Dialogue reflections → `agent/dialogue` (`dialogue.ts:213`)
- **Source cap:** `resolveWriteOrigin()` (`memories.ts:51`) lowers a trusted origin to `inferOriginKind(source)` when that is less trusted. So a session-cookie webhook capture is still `external`, and the cap reads `source` only, because `sourceMetadata.kind` is client-settable. With no trusted origin, the row is inferred from `(source, sourceMetadata)` (`origin.ts:53`). `manual`/`voice` infer to operator, `cron`/`system` to kairos, `claude`/`codex`/`copilot`/`hook` to agent, `import`/`webhook` to external, and the activity kinds to activity. Pre-0.14 rows are inferred the same way at read time (`originKindOf`).
- **Derived origin:** `derivedOriginKind()` (`origin.ts:82`) takes the lowest-trust input and is never above `kairos`. It is used by chat-distill over thread roles (`chat-distill.ts:127`) and by introspection over its input pool via `findMemoryOriginKinds` (`introspection.ts:228`). A pool containing external content therefore yields `external`.
- **Edits lower it:** `updateMemory()` (`memories.ts:1408`): a patch that actually changes `title`/`bodyMd`/`summary`/`type` (`ORIGIN_CONTENT_FIELDS`, `:1406`) re-labels the row to the lower-trust of its current origin and the writer's. The writer defaults to `agent/update`. The previous label is kept as `sourceMetadata.priorOrigin`, and the read and write happen under one `FOR UPDATE` lock. `acceptProposal()` (`memories.ts:1572`) stamps `operator/accept` by default (bearer surfaces pass `agent`) and keeps Kairos's label as `priorOrigin`.
- **Stream default:** `type='reflection'` from `import`/`webhook` no longer earns the reflection stream (`stream-class-default.ts:21,36`).

## 2. Dominion resolution order

`resolveDominionForMemory()` (`dominions.ts:328`), in strict order: (1) explicit `input.dominionId`;
(2) `project.dominionId`; (3) `dominionRepos` lookup by `sourceMetadata.repo`; (4) **content-based
auto-filing** (`lib/kairos/autofile.ts`); (5) `null`. Soft association via `dominion:<uuid>` tags
(`dominionTags.ts`) lets one memory be referenced by many Dominions. Retrieval unions the FK leg and the tag
leg (`inDominionScope`, `retrieve.ts:73`).

**Auto-filing:** applies only to `AUTO_FILE_STREAMS = {idea, reflection, execution, agentic}`. It embeds
`title+summary+body`, and `classifyDominionByContent()` (`memories.ts:1058`) scans live cortex rows with an **exact
in-process cosine**, deliberately not HNSW, because post-filtering left ~1 cortex row per Dominion. A similarity ≥
`KAIROS_AUTO_FILE_MIN_SIM` (default 0.55, clamped 0.3–0.95) assigns `dominionId`, a soft tag, and a
`kairosAutoFiled.similarity` stamp. The embedding is stored either way. Any failure leaves the row unfiled; capture never breaks.

## 3. Capture paths (ingress)

All inbound writes funnel through `captureMemory()` (`memories.ts:1120`), which maps `channel` to
`source='webhook'` and enforces **externalId idempotency**. `createMemory()` (`memories.ts:901`) enforces
**client + sessionId idempotency** and stamps origin (§1a).

**Capture choke point:** `lib/kairos/stream-class-default.ts` → `defaultStreamClass(source, type, sourceMetadata)`
picks the stream when none is given (explicit always wins). `validAt` comes from `sourceMetadata.session.endedAt`
when that is ≤7 days old. **Session record v1** lives at `sourceMetadata.session` (`lib/kairos/session-record.ts`,
mirrored by `apps/web/scripts/session-record.mjs`).

| Path | File | What it writes |
|---|---|---|
| Mission memory | `lib/kairos/mission-memory.ts` | Hangar result → ONE `session_summary` (`externalId hangar:{sessionId}`), origin `activity` |
| Board feed | `lib/kairos/board-feed{,-render}.ts` | 23:00Z `project-snapshot` cron: `board_day`/`board_week` digests (`achievement`/`agentic`), origin `activity` |
| `card_notes` nudge | `ask-mine` cron (04:30Z) | asks for missing card context; answers append to the card/vault description; asks expire after 72h |

- **Auto-capture** (`lib/kairos/auto-capture.ts`): `captureBoardEvent` and `captureProjectEvent`. These are fire-and-forget with `source='system'`.
- **Project-snapshot cron** (`project-snapshot.ts`, 23:00Z): one `snapshot` per active project per day. The compost pass (`lifecycle.ts`) archives snapshots older than 7 days and advisories older than 14 days, and never deletes.
- **Quick capture + capture endpoint**: the FAB and `POST /api/v1/memories/capture` (channel + externalId dedup).
- **Coding-agent session capture** (`apps/web/scripts/claude-session-capture.mjs`): normalises Claude, Codex and Copilot transcripts into `session_summary` rows (origin `agent` by source).
  - A durable local job queue is drained by one global-lock worker, with bounded retries and per-client receipts that make backfill idempotent. Copilot reads `~/.copilot/session-store.db`.
  - When the server rejects an unknown source, the client falls back to `source='hook'` with `originalSource` kept.
  - Server writes take a transaction-scoped capture lock.
  - Guards: the `AEON_HOOK_CHILD=1` child-session guard and the `isAutomatedSession()` backstop. The substance gate requires real output or a multi-turn design session.
  - Deterministic `aiTitle`/`execSummary` are set in the hook. The async summariser (outside this repo) drains the backlog 12 at a time.
  - Contract: [docs/kairos/05-session-capture.md](../../docs/kairos/05-session-capture.md).
- **Reflections (`kairos_reflect`)**: `captureReflection()` (`memories.ts:1187`) locks `streamClass='reflection'` (confidence 0.9). Origin is the surface's: MCP gives `agent`. The stream says what the row is; the origin says whose words it is.
- **Chat distillation** (`chat-distill` cron, 02:00Z, `lib/kairos/chat-distill{,-prompt}.ts`):
  - Distils operator-stated signal from each thread's prior-day turns into `reflection`/`cron` rows, capped at 5 per thread per day, with `externalId chat-distill:{date}:{threadId}:{n}`.
  - Origin is `derivedOriginKind` of the turn roles (`cron:chat-distill`).
  - A per-thread failure writes a cron-failure trace.
- **Kairos speaks** (`/api/v1/kairos/speak`): `inbound`/`system` rows with `kairosSpeak:true`. `listRecentKairosSpeaks()` (`memories.ts:1350`) backs the interrupt throttle.
- **Guided introspection (propose-not-commit)** (`lib/kairos/introspection.ts`, cron 06:30Z, gated by `KAIROS_RAW_INTROSPECTION`, doc 35 §9):
  - Writes STAGED `inbound`/`agentic` proposals with `refers_to` links. Origin is derived from the input pool (`cron:introspection`).
  - The operator commits via `acceptProposal()` (`memories.ts:1572`); dismissal archives.
  - Idea-tournament survivors (§10) use the same inbox lane.

## 4. The summary backlog + summariser

Captures land with a deterministic floor `aiTitle`/`execSummary`. Rows still missing rich summaries surface via
`list_memories_needing_summary` (MCP) and `GET /api/v1/memories/needs-summary`, and the async summariser drains them. There is no LLM on
the server write path (see also the **Acolyte** lieutenant in [chat.md](chat.md)).

## 5. Hybrid retrieval — the full pipeline

**Pipeline:** FTS + vector legs → RRF fuse (k=60) → confidence-decay weight → reflection bonus → rerank
pool of 12 → Voyage `rerank-2.5` (`lib/kairos/rerank.ts`; any error keeps the prior order) → top-5. **Shared ranker**
(`lib/kairos/ranking.ts`): `rankScore = relevance × standingFactor`, where `standingFactor = 0.5 + standing` for scored rows,
otherwise `confidenceBoost × recencyMultiplier`.

- **`retrieveContext()`** (`retrieve.ts:99`) is the Dominion-scoped fetch for recipes and chat. It returns `{ bundle, cortex, archetypes, substrate, traces }`.
  - The substrate covers `SUBSTRATE_STREAMS = reflection, idea, agentic, concept, belief, constitution` (`retrieve.ts:53`).
  - **Liveness (0.14):** every grounding leg (FTS, vector and traces) applies `substrateLive()` (`retrieve.ts:408`): not archived, `supersededAt IS NULL`, valid now. Merge supersedes without `invalidAt`, so `validAsOfNow` alone missed merged rows. Archived `idea_candidate` traces never ground.
  - **90-day window:** `inSubstrateWindow()` (`retrieve.ts:419`) exempts `WINDOW_EXEMPT_STREAMS = concept, belief, constitution` (`:417`). Retired beliefs and replaced constitution versions still drop out via liveness.
  - The vector leg (`hnsw.ef_search=100`) is best-effort and falls back to pure FTS.
- **`retrieveGlobalContext()`** (`retrieve.ts:120`): whole-brain retrieval. `dominionId=null` makes scope TRUE and the latest Aether stands in for cortex. It powers unanchored chat.
- **`prepareContext()`** (`memories.ts:2110`): a budget-packed bundle (FTS + optional vector via `fuseHybrid`, pinned rows, a 1-hop graph walk). Since 0.14 its pinned leg uses `listMemories({ liveOnly: true })` (`:2147`; filter at `listMemories`, `:154`). Its walk uses `getNeighbours({ liveOnly: true })` (`:2161`; SQL at `getNeighbours`, `:654`), which drops superseded/invalidated neighbours. Browse surfaces keep history (`liveOnly` defaults off). MCP `search_memories` is a separate path with no rerank.

**Embeddings** (`lib/kairos/embeddings.ts`): Voyage `voyage-3.5` @1024 is primary and OpenAI `text-embedding-3-small` (truncated) is the fallback;
with neither, retrieval is pure FTS. `updateMemory()` nulls the vector on content change. Cron `embed-backfill` runs at 03:25Z (04:00Z before 0.16)
(≤200/day), after the 01:30Z engine, which is why Merge looks back 96 h.

## 6. Dedup

`dedupMemories()` (`memories.ts:1832`) runs a pgvector self-join at cosine `0.97`, clusters with union-find, and keeps
pinned > highest-confidence > newest. Losers are **superseded**, never deleted. Only `session_event` auto-merges.
Cron `memory-dedup` runs Sundays at 05:00Z.

## 7. Memory engine (0039; 0.14 order)

Cron `memory-engine`, **01:30 UTC**, has a 230s budget, always writes a trace, and supports `?dryRun=1`. **Night order**
(`buildNightSteps`, `lib/kairos/engine/registry.ts:27`): **Merge → Weigh → OwnMind → Recheck → BackUp → Concepts**.
The cheap belief steps run before BackUp, which is slow (one transaction + support query per candidate) and can
exhaust the budget while a backlog drains. A promotion made tonight is mirrored the next night.

| Step | Does |
|---|---|
| Merge | folds a near-verbatim repeat (cosine ≥ 0.95, same stream) into the OLDER live row (`useCount+1`). Window: rows created in the last **96 h** and embedded (`MERGE_WINDOW_HOURS`, `merge.ts:31`), oldest first, cap **400**/night (`:34`). Never touches reflection, concept/cortex/aether/archetype, inbound, advisory, belief or constitution |
| Weigh | `standing = clamp01(base × Π factors)`; scorers `source-trust`, `freshness`, `usage`, `support`, `outcome`, `challenged` |
| OwnMind | mirrors engine promotions into own-mind beliefs (`beliefs/mirror.ts`, confidence capped as `inference`); retires mirrors of reverted promotions |
| Recheck | belief truth maintenance (§8), ≤ `RECHECK_CAP` 200/night (`recheck.ts:33`) |
| BackUp | pending introspection/idea proposals: ≥2 independent supports on ≥2 UTC days **and ≥1 anchored** → promoted to `idea`; no backing in 21 days → decay (archived); ≤400/night |
| Concepts | Sundays only — enqueues `concept` thinking jobs |

- **SourceTrust by origin** (`scorers/source-trust.ts:9`): a reflection's factor follows its origin: operator ×1.15, activity/agent ×1, kairos ×0.9, external ×0.7. A non-reflection with external origin gets ×0.7 (`EXTERNAL_FACTOR`, `:18`). Pinned ×1.25 and pending-proposal ×0.6 are unchanged.
- **Freshness half-lives** (`scorers/freshness.ts`): belief **365 d** (`:18`), constitution **never fades** (`Infinity`, `:19`), advisory **14 d** (`:21`), trace **7 d** (`:22`). Others: reflection 365, concept 120, idea/cortex/archetype/aether 30, agentic/execution 21, delta/snapshot 7, default 30. The anchor is `max(validAt, lastUsedAt)`.
- **BackUp anchor** (`steps/back-up.ts`): `summariseSupport()` (`:70`) counts `anchoredSupports`, meaning supports whose origin is `operator` or `activity`. A collapsed session counts as anchored if any of its rows is. `shouldPromote()` (`:97`) requires `PROMOTE_MIN_ANCHORED = 1` (`:27`), so AI-written material alone cannot back Kairos up. The count is stored in `engine.support.anchoredSupports`.

Every live change writes its `memory_ops` row **in the same transaction** (`engine/change-log.ts`). Op kinds
(`lib/data/validators/memory-ops.ts`) now include **`recheck`** and **`retire`** (`:18–19`). Any op is revertible via
MCP `revert_memory_op`, REST `POST /api/v1/kairos/memory-ops/[id]/revert`, or chat `undo_kairos_change`
(`engine/revert.ts`).

- Reverting `promote`/`decay`/`merge`/`recheck`/`retire` leaves a veto slot `engine.vetoes[op]` (`revert.ts:26`). A reverted recheck also remembers its `lostSources`, and a reverted normalisation is vetoed as `normalise`.
- Belief ops (`recheck`/`retire`/`feedback`) restore a partial `belief` snapshot plus row dates and links, and are stale if the belief has moved on (`:29`).
- **Reactions** (`lib/kairos/reactions.ts`) trigger an immediate rescore (`rescore.ts`, applied when |Δ| ≥ 0.05).

## 8. Belief ledger — two minds

Beliefs are `type/streamClass='belief'` rows. `sourceMetadata.belief` is `BeliefV1` (`beliefs/types.ts`) and now
carries optional `recheck = { since, lostSources[{id, state}] }` and `normalisedAt`.

| Mind | Source |
|---|---|
| Aligned (operator's) | `belief_extract` thinking job distils stated beliefs; inputs exclude external origin (`mayShapeBeliefsSql`, `lib/data/belief-inputs.ts:33`) and are labelled by author |
| Own (Kairos's) | `OwnMindStep` mirrors engine promotions; always `sourceType: 'inference'` |

- **Source type and cap (0.14, docs/kairos/34 §8):** `sourceType` comes from the provenance origins, not from the model (`sourceTypeOf`, `beliefs/support.ts:19`). Any operator-origin source makes it `operator` (cap **0.95**), agent/activity `tool` (**0.8**), anything else `inference` (**0.6**) (`BELIEF_CONFIDENCE_CAP`, `origin.ts:112`). A reinforcement recomputes type and cap over the union provenance, so the operator's words upgrade a belief, and it clears any re-check flag (`reinforcedBelief`). An inference-only claim may not replace an operator/tool belief (`mayReplace`, `support.ts:31`). It lands as a new held belief, and its `promote` op records `replaceRefused` (`lib/data/beliefs.ts:309`).
- **Recheck step** (`engine/steps/recheck.ts`, data `lib/data/belief-recheck.ts`):
  - It checks held beliefs whose provenance memory is missing, archived, invalidated, or superseded with no live survivor.
  - A Merge supersession is not a loss: provenance and links are remapped to the survivor (op `feedback`).
  - A real loss sets `belief.recheck` and multiplies confidence by 0.7 with a 0.1 floor (`RECHECK_PENALTY`/`FLOOR`, `support.ts:14–15`), op `recheck`.
  - An own-mind belief with no provenance left is retired (`invalidAt=now`, op `retire`).
  - **Legacy normalisation** uses the leftover budget (`planNormalise`, `recheck.ts:132`). It sets the computed `sourceType` and caps confidence (never raises it), then stamps `normalisedAt`, op `feedback` with `after.normalised: true`.
- **Retire action:** the next `belief_extract` lists up to 20 flagged aligned beliefs. A flag alone is enough to plan the job, and beliefs with a reverted retire are not re-asked. The model may reaffirm (reinforce), replace, or `retire { targetId, reason }`, and only flagged beliefs can be retired (`writeAlignedBeliefs`, `beliefs.ts:254`, retire at `:334`). A retire sets `invalidAt`, status `retired`, and writes a revertable op `retire`.
- Weekly `mind_compare` pairs same-topic beliefs at cosine ≥ 0.82. `list_beliefs` now exposes `sourceType` and `recheck`. The weekly belief diff (`lib/data/belief-diff.ts`) reads un-reverted ops of steps `beliefs`/`recheck`/`own_mind`.

## 9. Constitution

`lib/kairos/constitution/*`: exactly ONE live `constitution` version; a new version supersedes the old. It never fades
(§7) and is exempt from the 90-day window (§5). It is seeded by `constitution-seed` (Mon 04:20Z). Amendments are proposals that
**only the operator accepts** (Will inbox or Telegram, `proposal-accept.ts`). MCP/bearer REST accept refuses them (403).
Drift probes, conscience checks and the answer-time conscience block are covered in [synthesis.md](synthesis.md) / [chat.md](chat.md).

## 10. Idea tournament archive (0.15)

Spec: docs/kairos/35. The `idea_generate` → `idea_judge` thinking jobs run nightly (flow in [synthesis.md](synthesis.md)).
The substrate side is `writeTournament()` (`lib/data/ideas.ts:175`). It runs in one transaction under an advisory lock
on `(user, idea_tournament:<date>)`, and a double submit returns the existing ids. All rows carry
`origin = { kind: 'kairos', via: 'cron:idea-tournament' }` (`IDEA_ORIGIN`, `ideas.ts:22`), `sourceMetadata.idea` (`IdeaMeta`), and their embedding.

| Row | Shape |
|---|---|
| Survivor (1–3/night) | `type 'inbound'`, `streamClass 'agentic'`, `source 'cron'`, `sourceMetadata { introspection: true, kind: 'idea', status: 'pending', citations, idea, origin }`, `refers_to` links to evidence, tags `proposal, idea` |
| Non-survivor | `type 'idea_candidate'`, `streamClass 'trace'`, `source 'cron'`, **archived on write**, `idea.status` = eliminated reason (repeat / ungrounded / contradicted / already_known / not_different / ranked_out) |

- Survivors are ordinary inbox proposals. They reach the own mind only through BackUp, under the anchored-support rule (§7), and never through the tournament itself. Archived candidates never ground retrieval and are never scored. They exist for the novelty gate (`findNearestIdeaNeighbours`, `ideas.ts:65`), which scans the whole idea archive including archived rows.
- **Outcomes:** every accept/dismiss path (inbox, Telegram, MCP, REST) goes through `lib/kairos/proposal-accept.ts`. After the reactions it calls `recordIdeaOutcome()` (`ideas.ts:359`) best-effort. This is one `jsonb_set` that stamps `idea.outcome` (`accepted`|`dismissed`) + `idea.outcomeAt`, found by id so it survives the accept retyping the row. `inferIdeaOutcome()` (`ideas.ts:277`) covers older rows: an archived pending row counts as dismissed, and BackUp promote/decay is not an operator outcome. Readers: `listIdeaOutcomes`, `listDirectionStats`, `listSurvivorsSince`, `listSurvivorEmbeddingsBetween`.

## Key files

- `apps/web/src/lib/db/schema.ts` — `memories` + Dominion tables
- `apps/web/src/lib/data/memories.ts` — capture / create / update (origin) / reflection / accept-proposal / search / dedup / prepareContext
- `apps/web/src/lib/kairos/origin.ts` — origin kinds, trust, inference, derived origin, belief source-type caps
- `apps/web/src/lib/data/{validators,dominions}.ts`
- `apps/web/src/lib/kairos/{streamClass,stream-class-default,session-record,dominionTags,lifecycle,dedup,embeddings,retrieve,auto-capture,project-snapshot,introspection,confidence,rerank,rrf,autofile,ranking,reactions,rescore,proposal-accept,chat-distill,cron-trace,mission-memory,board-feed}.ts`
- `apps/web/src/lib/kairos/{engine,beliefs,constitution,concepts,ideas}/` — memory engine (incl. `steps/recheck.ts`), two minds, constitution, concepts, idea tournament
- `apps/web/src/lib/data/{memory-engine,memory-ops,memory-candidates,memory-reactions,memory-rescore,beliefs,belief-inputs,belief-recheck,belief-diff,concepts,constitution,constitution-drift,mind-compare,ideas,idea-inputs}.ts`
- `apps/web/scripts/{claude-session-capture,session-record,session-capture-queue,session-capture-drain,copilot-session-capture-backfill,session-transcript,copilot-session-transcript}.mjs` + `{claude,codex,copilot}-session-capture-dispatch.mjs` — session-capture pipeline
