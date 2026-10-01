# Kairos P1 + P2 — how it's actually built (lane D)
**main @ 2ead786** (#134 memory engine, #135 hotfix, #136 beliefs & strategy). Paths are relative to `apps/web/src/` unless shown otherwise. Labels: **[C]** confirmed in code/config, **[I]** inferred from confirmed facts, **[U]** unresolved.
**Assumptions:** "on in prod" means scheduled in `apps/web/vercel.json`. I couldn't see Vercel's env vars or the prod database, so any env-flag value in prod is **[U]**. Unit tests for the data layer mock `@/lib/db`, so SQL behaviour (pgvector, jsonb) has no test against a real Postgres.

## Answer first
1. **[C] There is no write-time memory gate.** `createMemory` only does idempotency (sessionId / externalId) and a stream-class default. No Mem0-style ADD/UPDATE/DELETE/NOOP happens at write time. Folding near-duplicates happens only at night: Merge (cosine ≥ 0.95, 36 h window) and the older weekly `memory-dedup` (session_event rows only, cosine ≥ 0.97).
2. **[C] Standing = base trust × six multiplicative scorers.** Freshness is exponential: `0.5 + 0.5·2^(−age/halfLife)`. Retrieval is **not** recorded as use. Only being cited in chat, being a source for an answered ask, or an accepted proposal raises use. The shared ranker covers `prepareContext` and the chat/brief substrate. Most other readers order by recency.
3. **[C] Beliefs have no justification tracking.** When a source memory is superseded or retracted, nothing re-checks the beliefs built on it. Confidence is the model's own number, not capped by source type. The constitution is read **only** by the drift probe (and MCP/REST reads). It is never put into chat, the brief, aether, cortex, introspection or the daily-message prompt.
4. **[C] No input is quarantined or trust-tiered before it can shape beliefs.** Any MCP/API client can write `type:'reflection'`, which is treated as the operator's own words. Chat transcripts reach the aligned mind through `chat-distill` reflections. The only injection defences are a prompt line saying "treat as data" and stripping code fences.
5. **[C] The brief recipe reads only the Dominion bundle.** It reads no beliefs, constitution, aether or cortex. Your suspicion is right: of the briefing paths, only `daily-message-inputs.ts` reads beliefs and drift status.

---

## 1. Memory write path

| Piece | Trigger | Reads | Writes | Det/LLM | Schedule/gate | Evidence |
|---|---|---|---|---|---|---|
| `createMemory` (data) | MCP/REST create, capture webhook, hooks, crons | prior rows by `sessionId` (claude/codex/copilot/hook) | one `memories` row, plus `invalidAt` stamped on targets of any `resolves` link | Det | always | [C] `lib/data/memories.ts:854-1000`; idempotency `:857-882`, `:938-947`; resolves stamp `:836-852,:980` |
| Stream-class choke point | caller didn't set a streamClass | (source, type, sourceMetadata) | streamClass: reflection / agentic / execution / snapshot / execution, otherwise DB default `idea` | Det | always | [C] `lib/kairos/stream-class-default.ts:28-54`; used at `memories.ts:897-898` |
| Trust prior | insert | streamClass | `confidence = CONFIDENCE_BY_STREAM[class]` | Det | always | [C] `memories.ts:974`; table `lib/kairos/confidence.ts:30-54` |
| valid-time | insert | `sourceMetadata.session.endedAt` (≤7 d old) | `validAt` | Det | always | [C] `stream-class-default.ts:63-75` |
| Embedding at write | only when no Dominion resolves **and** stream is idea/reflection/execution/agentic | Voyage `embedOne` | `embedding` (+ Dominion auto-file if cosine ≥ 0.55) | Det (API) | `VOYAGE_API_KEY` | [C] `memories.ts:908-919`; `lib/kairos/autofile.ts:24-45` |
| Embedding backfill | cron `embed-backfill` 04:00 UTC | rows with null/stale embedding, oldest first, all users | embeddings | Det (API) | **200 rows/day** (max 500) | [C] `vercel.json`; `app/api/cron/embed-backfill/route.ts:43-46`; `memories.ts:1645-1690` |
| `captureMemory` | webhook/REST capture | externalId (live rows only) | delegates to createMemory; `channel` → source `webhook` | Det | always | [C] `memories.ts:1069-1102` |
| Write gate / dedup | — | — | — | — | **none at write time** | [C] no similarity check in `memories.ts:854-1000` |
| Nightly Merge | engine 01:30 | rows created ≤36 h ago, embedded, unpinned, not in excluded types/streams | newer `supersededAt/ById` → older; older `useCount+1`, `lastUsedAt` | Det | always | [C] `lib/kairos/engine/steps/merge.ts:18-38,46-51`; `lib/data/memory-candidates.ts:207-255` |
| Legacy dedup | `memory-dedup` Sun 05:00 | `session_event` pairs ≥0.97 | supersede **and** `invalidAt`, **no memory_ops** | Det | always | [C] `lib/kairos/dedup.ts:14,21`; `memories.ts:1709-1772` |

**Where docs and code disagree**
- **[C]** `stream-class-default.ts:4-6` says "every write path funnels through createMemory". It doesn't. Direct `insert(memories)` bypasses exist in `lib/data/ask.ts:385`, `beliefs.ts:201`, `concepts.ts:222`, `constitution.ts:143,247`, `constitution-drift.ts:81`, `dialogue.ts:302`, `mind-compare.ts:30`, `memories.ts:1159` (`captureReflection`), and in `lib/kairos/aether.ts:284`, `archetypes.ts:212`, `ask.ts:143`, `contradiction.ts:265`, `cortex.ts:284`, `introspection.ts:223`. None of these embed at write time.
- **[I]** Merge only looks at rows created ≤36 h ago that already have an embedding. Most rows are only embedded by the 04:00 backfill (≤200/day across all users). So once the backlog is over 200 rows/day, rows embedded more than 36 h after creation are **never merge-checked**.
- **[C]** Doc 32 §2.1 says "the day's new rows". The code uses a 36 h window capped at 200 rows (`merge.ts:19-20`).

**Tests:** `__tests__/stream-class-default.test.ts`, `engine/__tests__/merge.test.ts`, `data/__tests__/memory-candidates*.test.ts` (DB mocked), `__tests__/dedup.test.ts`.

## 2. Standing, fading, use, ranker

**Formula [C]:** `standing = clamp01(base × Π factors)`. Retired rows (superseded, archived, or `invalidAt ≤ now`) get 0. (`engine/standing.ts:9-27`)

| Scorer | Inputs | Factor | Evidence |
|---|---|---|---|
| base | streamClass | constitution .95, reflection .9, belief .8, concept .75, cortex/aether .7, idea/archetype .6, advisory .5, agentic .45, delta .4, execution .35, trace .3, snapshot .25; unknown .5 | [C] `confidence.ts:30-54`, `standing.ts:14-16` |
| SourceTrust | pinned, streamClass, `sourceMetadata.status` | ×1.25 pinned · ×1.15 reflection · ×0.6 pending proposal | [C] `engine/scorers/source-trust.ts:3-26` |
| Freshness | `max(validAt, lastUsedAt)` | `0.5+0.5·2^(−age/hl)` (**exponential**, floor 0.5) | [C] `engine/scorers/freshness.ts:24-33` |
| Usage | `useCount` | `1+0.05·min(n,6)` | [C] `engine/scorers/usage.ts:4-13` |
| Support | `sourceMetadata.engine.support.independentSupports` | `1+0.1·min(n,5)` | [C] `engine/scorers/support.ts:4-14` |
| Outcome | `engine.outcome.{positive,negative}` | `max(0.5, 1+0.15p−0.2n)` | [C] `engine/scorers/outcome.ts:4-15` |
| Challenged | count of pending rows whose `sourceMetadata.loserId = id` | ×0.8 if >0 | [C] `engine/scorers/challenged.ts`; `lib/data/memory-engine.ts:150-167` |

**Half-lives in days [C]** (`freshness.ts:5-18`): agentic/execution 21, idea 30, delta/snapshot 7, cortex/archetype/aether 30, concept 120, reflection 365. Any class not listed defaults to 30. That includes **belief, constitution, advisory and trace** (not in the doc 32 table). **[I]** So the constitution's standing halves toward its 0.5 floor every 30 days.

**Weigh step [C]** (`engine/steps/weigh.ts:46-123`; `data/memory-engine.ts:81-118`):
- Runs nightly at 01:30.
- Scores rows touched in the last 36 h (by updated, created or lastUsed time), then fills a rolling slice of the stalest rows (`standingAt NULLS FIRST`). Total cap is 2000 rows/night.
- Logs a `score` op only when the change is ≥ 0.05 and the row already had a score.

**Does use refresh standing?**
- **[C]** Use is recorded only by `reactUsed`, called from:
  - chat citations (`kairos/chat-turn-assistant.ts:346`)
  - an answered ask's sources (`kairos/ask.ts:361`)
  - proposal accept (`kairos/proposal-accept.ts:47`)
- **[C]** Retrieval itself (`prepareContext`, `retrieveContext`, `search_memories`, `search_brain`) records nothing.
- **[C]** Confirmation: Outcome +1 on accept (`proposal-accept.ts:46`) and on an answered ask (`ask.ts:359`). Outcome −1 on dismiss (`proposal-accept.ts:78`) and on an ask expiring after 72 h (`ask-mine.ts:413`).
- **[C]** Each reaction rescores that one row immediately (`kairos/reactions.ts:12-45` → `rescore.ts:44-85`).
- **[C]** Aligned-belief "reinforce" does **not** touch useCount, lastUsedAt or validAt. It only adds provenance and bumps updatedAt (`data/beliefs.ts:282-304`). **[I]** So restated beliefs still fade.
- **[I]** `confidence.ts:34` says beliefs are "provenance-weighted by the engine". No scorer reads provenance.

**Ranker [C]:** `rank = relevance × (0.5 + standing)`. Unscored rows fall back to `confidenceBoost × recencyMultiplier` (`kairos/ranking.ts:28-41`).

| Consumer | Uses ranker? | Evidence |
|---|---|---|
| `prepareContext` (MCP `prepare_context`, REST context) | Yes. But graph neighbours carry no standing or confidence, so they fall back to the old (P0) formula | [C] `memories.ts:2113-2119`, `:2094-2110` |
| `fetchSubstrate` (chat global/Dominion grounding, `search_brain`, dispatcher retrieval) | Yes: FTS-only branch, RRF branch, and rerank blend | [C] `retrieve.ts:363,382,400-403` |
| `search_memories` / REST search / `searchMemoriesFts` | **No**: ts_rank, then pinned, then createdAt | [C] `memories.ts:521-523` |
| `fetchCortex` / `fetchArchetypes` / `fetchAetherDoc` | **No**: newest first | [C] `retrieve.ts:155-222` |
| archetype, introspection, contradiction, cortex, aether input pools | **No**: createdAt desc | [C] `archetypes.ts:96-124`; `contradiction.ts:59-80`; `introspection.ts:53-61` |
| `listBeliefs(rank:'standing')`, concept candidates | Use the raw `standing` column in SQL, not the ranker | [C] `data/beliefs.ts:70-72`; `data/concepts.ts:63` |
| Brief recipe | No retrieval ranking at all (bundle only) | [C] `recipes/brief.ts:20-51` |

**Retrieval defects [C]:**
- `fetchSubstrate` filters `archivedAt` and `validAsOfNow` but **not `supersededAt`** (`retrieve.ts:283-292, 331-341`). Merge sets only `supersededAt` (`memory-candidates.ts:242-245`). **[I]** So rows Merge folded away (and superseded proposals) can still show up in chat/brief grounding, at standing factor 0.5.
- The 90-day substrate window exempts only `concept` (`retrieve.ts:46,407-409`). Beliefs and the **constitution** drop out of substrate retrieval 90 days after they are created.

**Tests:** `engine/__tests__/scorers.test.ts`, `standing.test.ts`, `weigh.test.ts`; `__tests__/ranking.test.ts`, `rescore.test.ts`, `reactions.test.ts`, `retrieve*.test.ts`; `data/__tests__/memory-reactions.test.ts`, `memory-engine.test.ts`.

## 3. Merge, Weigh, BackUp, Concepts

| Step (order `engine/registry.ts:22-30`) | Trigger | Reads → Writes | Det/LLM | Key rules |
|---|---|---|---|---|
| Merge | cron 01:30 daily | see §1 → supersede + reinforce older, `merge` op in the same transaction | Det | ≥0.95, same streamClass, older live row; skips vetoed; excludes concept/cortex/aether/archetype/reflection/inbound/advisory/belief/constitution (`merge.ts:22-38,66`) |
| Weigh | same | see §2 | Det | — |
| BackUp | same | pending `inbound` + `introspection:true` proposals (not contradiction, review_action or constitution_amendment), oldest first, cap 400 → status, streamClass, confidence | Det | [C] `memory-candidates.ts:39-66`; `back-up.ts:20-24,159-208` |
| OwnMind | same | unmirrored `backup/promote` ops (14 d lookback) → belief rows; retires mirrors of reverted promotions | Det | [C] `own-mind.ts:12-29`; `beliefs/mirror.ts:83-124` |
| Concepts | Sundays (UTC) only | plans and **enqueues** jobs; never calls a model | Det plan, **LLM** distil | [C] `engine/steps/concepts.ts:31-41` |

**BackUp independence rules [C]** (`back-up.ts:27-80`; `memory-candidates.ts:80-120`):
- A support is a live, non-meta, embedded row created **after** the proposal, with cosine ≥ 0.80, up to 50 rows.
- Dropped as non-independent: `source ∈ {cron, system}` unless its `kind` is hangar_mission, board_day or board_week; rows that link to or cite the proposal.
- Rows from the same session (`session.sessionId | sessionId | hangarSessionId`) collapse into one support, dated by the earliest row.
- **Promote** when supports ≥ 2 **and** distinct UTC days ≥ 2, unless vetoed. Result: `status:'promoted'`, streamClass `idea`, confidence 0.6 (`:82-84,170-186`).
- **Decay** after 21 days: archived (`:188-203`).
- Otherwise only `engine.support` is refreshed, with no op (`:205-208`).
- **[I]** Agent session summaries (source claude/codex/hook) count as independent "operator-world" evidence. The operator's own chat-distilled reflections (source `cron`) do **not**.

**Concepts [C]:**
- Per Dominion, take the top 600 live embedded rows by standing (excluding synth/proposal/belief types) (`data/concepts.ts:13-14,31-65`).
- Cluster greedily with **complete linkage**: cosine ≥ 0.82, cluster size 4–12 (`concepts/cluster.ts:7-10,50-107`).
- Match against existing concepts by member-set Jaccard ≥ 0.6 → **update in place**. Unchanged membership or a pinned concept is skipped. A cluster the operator already resolved is never re-proposed (`thinking/handlers/concept.ts:97-112`).
- Max 8 concept jobs per week (`concept.ts:42,145-154`).
- Clusters that are >50% reflections become **proposals** (`inbound`, `agentic`, `introspection:true`). **[I]** BackUp can then promote these into the own mind. Other clusters become `type/streamClass 'concept'` with `refers_to` links to members (`concept.ts:100-101,161-218`).
- **Naming [C]:** the LLM names concepts (`concepts/concept-prompt.ts`).
- **Split/merge [C]:** none. There is no split, no merge of two concepts, and no retirement when a cluster dissolves. The only lifecycle is update-in-place or create.
- **Where concepts are used [C]:** only through substrate retrieval (`retrieve.ts:51`). No synthesis prompt reads them: a grep of aether, cortex, brief, daily-message, introspection and chat-prompt finds none.

**Doc vs code:** doc 32 §2.4 says "update by member-set overlap", which matches. Doc 32 §3 says "archetypes, digest and chat follow in P2" — **[C]** there is no `archetypes` queue handler (`thinking/registry.ts:14-25`), and digest was replaced by `daily_message`.

**Tests:** `engine/__tests__/back-up.test.ts`, `merge.test.ts`, `own-mind-step.test.ts`, `concept-step.test.ts`, `memory-engine.test.ts`; `concepts/__tests__/*`; `thinking/__tests__/concept-handler.test.ts`; `data/__tests__/concepts.test.ts`; `app/api/cron/memory-engine/__tests__/route.test.ts`.

## 4. The memory_ops ledger and revert

**[C]** The ledger is append-only, written in the **same transaction** as each change (`data/memory-ops.ts:15-47`). The engine's `BufferedChangeLog` is now only the dry-run report, plus a last resort flagged as `changelog:<step>` (`engine/change-log.ts:8-39`; `memory-engine.ts:60-71`). Reverts go through MCP `revert_memory_op`, REST `…/memory-ops/[id]/revert`, or the chat tool `undo_kairos_change` (HMAC-confirmed) (`tools/memory-ops.ts:43`; `chat-tools.ts:308-329`).

| Op | Revertable? | What a revert does | Evidence |
|---|---|---|---|
| merge | Yes | restores both rows; decrements the older row's useCount relatively; stamps `vetoes.merge` | [C] `engine/revert.ts:66-84,119-123,135-146` |
| promote / decay (BackUp) | Yes | restores status/streamClass/confidence/archivedAt; stamps veto; the own-mind mirror is then retired the next night | [C] `revert.ts:26,127-146`; `data/beliefs.ts:393-404` |
| score | Technically yes | restores standing, but no veto, so the next Weigh overwrites it | [C] `revert.ts:23`; [I] |
| feedback (use) | Yes | relative useCount −1 | [C] `revert.ts:119-123` |
| feedback (outcome) | Yes | relative atomic jsonb delta | [C] `revert.ts:175-185`; `memory-reactions.ts:24-41` |
| concept_update | Yes | full snapshot restored, embedding nulled; refused if stale | [C] `revert.ts:155-171` |
| concept_create, revert | **No** | — | [C] `revert.ts:27` |
| belief-ledger (`step:'beliefs'`) and constitution ops | **No** (`before:null`) | — | [C] `data/beliefs.ts:273-280,296-303,421-428`; `revert.ts:69` |
| `reject` | dead: kind defined, never emitted | — | [C] `engine/types.ts:71`; no writer found |
| Not logged at all | — | legacy dedup, contradiction accept, acceptProposal supersedes, `update_memory`, archive, **hard delete**, cortex/aether archive-and-replace | [C] `memories.ts:1343-1372,1430-1438,1462-1571,1573-1579,1709-1772` |

**Tests:** `engine/__tests__/revert.test.ts`, `app/api/v1/kairos/memory-ops/__tests__/route.test.ts`, `app/api/__tests__/memory-ops-parity.test.ts`, `__tests__/chat-tools-undo.test.ts`.

## 5. Links between memories, memory evolution, association

| Mechanism | Exists? | Evidence |
|---|---|---|
| Manual linking | Yes: MCP `link_memory` / `addLink` (dedups edges; a `resolves` link invalidates its target) | [C] `tools/memories.ts:218`; `memories.ts:1374-1411` |
| Neighbour walk | Yes: recursive CTE over `links[]` (1–2 hops, reverse edges optional). Used by MCP `get_memory_with_neighbours`, REST, and `prepareContext` (1 hop, edge bonuses) | [C] `memories.ts:614-700,1874-1881,2030-2050` |
| Automatic links | Only from synthesis outputs: concepts `refers_to` members, beliefs `refers_to` provenance, contradiction `contradicts`, constitution `supersedes` | [C] `concept.ts:167`; `beliefs/types.ts:95`; `contradiction.ts:248`; `amendment.ts:154-158` |
| A-MEM-style updating of OLD memories when new related ones arrive | **No general mechanism.** Narrow cases only: Merge reinforces the older row on a near-verbatim repeat; aligned "reinforce" adds provenance to an old belief; a weekly concept update rewrites the concept in place; an accepted contradiction supersedes the loser | [C] see §1, §3, §7 |
| Associative strengthening of co-retrieved memories | **None** | [C] grep for co-retrieval/hebb finds nothing; nothing writes on retrieval (§2) |

## 6. How operator reactions flow

| Reaction | Standing | Beliefs | Ideas/proposals |
|---|---|---|---|
| Accept a proposal | Outcome +1, Usage +1, immediate rescore (`proposal-accept.ts:44-48`) | becomes `reflection` (or `idea` if typed as note) at confidence 0.9 (`memories.ts:1533-1551`). **[I]** It is then fed to `belief_extract` as the operator's words | status `accepted` |
| Dismiss a proposal | Outcome −1 + rescore (`proposal-accept.ts:76-79`) | none | archived. **[C]** Dismissed concept clusters are never re-proposed (`concept.ts:108-111`) |
| Ask answered / expired | +1 on the ask and Usage on its sources / −1 (`ask.ts:359-361`; `ask-mine.ts:413`) | the answer is written as a `reflection` (`ask.ts:150-152,317-323`) | — |
| Chat citation | Usage +1 (`chat-turn-assistant.ts:346`) | — | — |
| Revert of a promotion | restores the proposal + veto | own-mind mirror retired the next night (§4) | stays a pending guess |
| Constitution accept | — | new constitution version (§8) | — |

**[C]** There is no reaction path that touches a belief directly (no operator accept/dismiss for beliefs). Doc 34 §1 says the same ("no proposal/acceptance step for beliefs today").

## 7. Beliefs

**Schema [C]** (`beliefs/types.ts:23-36`, strict zod):
`{v:1, mind:'aligned'|'own', domain, dominionId, claim, reasons[], falsifier, sourceType:'operator'|'tool'|'inference', provenance[], status:'held'|'retired', confidence:0..1, supersedes?}`.
Stored as `type/streamClass 'belief'`, source `cron`, row confidence 0.8, links `refers_to` provenance (`:85-98`; `data/beliefs.ts:199-206`).

| Aspect | Aligned mind | Own mind |
|---|---|---|
| Trigger | `belief_extract` job: daily from 02:30Z, when there are new operator signals since the watermark; one in flight at a time (`thinking/handlers/belief-extract.ts:80-118`) | engine OwnMind step, nightly 01:30 |
| Reads | ≤60 oldest-first rows since the watermark where `streamClass='reflection' OR type='reflection' OR kind='board_day'`, plus ≤150 held aligned beliefs (`data/beliefs.ts:117-148`; `belief-extract.ts:94`) | `backup/promote` ops not yet mirrored (`data/beliefs.ts:330-359`) |
| LLM? | Yes: routine, or paid heavy-tier fallback via the sweep (`belief-extract.ts:176-192`) | No: claim = proposal title, reasons = first 3 sentences of its body, falsifier `'unknown — not yet stated'` (`beliefs/mirror.ts:22-59`) |
| Grounding | provenance must resolve to fed input ids; `targetId` must resolve to a held aligned belief; each target replaced at most once (`beliefs/extract-prompt.ts:138-174`) | provenance = proposal id + its citations |
| Revision | `replaces` → old row gets `supersededAt/ById`, `invalidAt`, status `retired`; `reinforces` → union provenance + links (`data/beliefs.ts:255-304`) | retired only when its promotion is reverted (`data/beliefs.ts:393-431`) |
| Confidence | **the LLM's 0–1 number, uncapped** (`extract-prompt.ts:100`; `belief-extract.ts:141`) | the proposal row's confidence, i.e. 0.6 after promotion (`mirror.ts:43-45`) |
| Idempotency | advisory lock + extractKey probe (`data/beliefs.ts:243-251`) | `mirroredFrom` + lock (`data/beliefs.ts:363-390`) |

- **[C] No justification tracking.** Nothing reads `belief.provenance` back to re-examine a belief. The only provenance readers are the reinforce write and the extract prompt (grep of `provenance` in `lib/kairos` and `lib/data`). A superseded or retracted source leaves its dependent beliefs held.
- **[C] Contradiction-scan never looks at beliefs.** Its type list is reflection/fact/decision/observation/note/idea (`memories.ts:1790`ish `BELIEF_TYPES`; `contradiction.ts:59-80`).
- **[C]** `sourceType:'tool'` is never written (only `operator` in `belief-extract.ts:138` and `inference` in `mirror.ts:54`). There is no confidence cap by source type.
- **Doc vs code [C]:** doc 34 §1 says the aligned mind is "never written from chat directly". Literally true, but `chat-distill` (02:00) uses an LLM to turn chat threads into `type:'reflection'` rows (`kairos/chat-distill.ts:122-135`), which `belief_extract` then reads as operator words.

**Tests:** `beliefs/__tests__/*`, `thinking/__tests__/belief-handlers.test.ts`, `data/__tests__/beliefs.test.ts`, `belief-exclusions.test.ts`, `app/api/__tests__/beliefs-parity.test.ts`.

## 8. Constitution

| Aspect | Built as | Evidence |
|---|---|---|
| Storage | `type` and `streamClass` both `constitution`, one live row (`supersededAt IS NULL`), `sourceMetadata.constitution = {version, principles[{n,text,reason}], acceptedFrom}` | [C] `data/constitution.ts:38-44`; `constitution/schema.ts:44-50` |
| Seed | cron `constitution-seed` Mon 04:20Z; drafts only if there is no live constitution **and** no pending amendment; uses its **own** paid-key call (duplicates `paid-fallback.ts`); output is a proposal (`inbound`, `introspection:true`, `kind:'constitution_amendment'`) | [C] `vercel.json`; `constitution/seed.ts:41-74`; `amendment.ts:51-77` |
| Amend | MCP `propose_constitution_amendment` / REST: full principle list against the current version | [C] `amendment.ts:88-99` |
| Accept | `acceptKairosProposal` → `applyAcceptedConstitutionAmendment`: refuses stale `basedOnVersion`; writes v+1, supersedes the old one, logs a `promote` op (`step:'constitution'`, not revertable) | [C] `proposal-accept.ts:34-42`; `amendment.ts:134-198` |
| Operator-only enforcement | MCP accept refuses (`tools/memories.ts:412-413`); REST refuses **only if the caller is a bearer token** (`app/api/v1/memories/[id]/accept/route.ts:39-40`); inbox action and Telegram are allowed. **No actor check** inside `acceptKairosProposal` itself | [C]; carry-over noted in `aeon_os/HANDOVER_0110.md` §5 |
| Excluded from BackUp | yes | [C] `memory-candidates.ts:59` |
| Other mutation paths | **[I]** an MCP/API client can archive (`update_memory archivedAt`) or hard-delete the live constitution row; no guard by type was found | [C] `memories.ts:1343-1372,1573-1579`; validator `validators/memory.ts:76-89` |
| Consumers | **only** the drift probe and the read surfaces (MCP/REST overview); never injected into any generation prompt | [C] grep of `getLiveConstitution`/`findLiveConstitutionRow` |

**[I]** A forged constitution through `create_memory` doesn't work. `createMemorySchema` has no `streamClass` field, and type `constitution` defaults to the `idea` stream (`stream-class-default.ts:28-54`), so it fails the live-row filter. A forged **belief** is accepted, though: `listBeliefs` only checks `type='belief'` plus a valid `sourceMetadata.belief` (`data/beliefs.ts:26,62-91`).

**Tests:** `constitution/__tests__/*`, `data/__tests__/constitution.test.ts`, `app/api/__tests__/constitution-parity.test.ts`, `app/api/cron/constitution-seed/__tests__/route.test.ts`.

## 9. Drift probes

| Aspect | Built as | Evidence |
|---|---|---|
| Probe set | 24 fixed questions in 6 categories (priorities, trade-offs, values, nature, autonomy, contradictions) with stable ids | [C] `constitution/probes.ts:26-56` |
| Trigger | `drift_probe` job, daily, needs a live constitution; once aether ran today or from 03:30Z; 2 h deadline; sweep paid fallback | [C] `thinking/handlers/drift-probe.ts:44-94` |
| Input | constitution principles + top 20 held beliefs by standing (either mind); ONE model call | [C] `:76-91` |
| Baseline | first run per (constitution id × embedding model) pins `drift_baseline` with int8-packed answer vectors | [C] `:146-169`; `constitution/drift.ts:60-80` |
| Comparison | per-probe cosine between tonight's answer embedding and the baseline; mean; alert if mean < 0.8 or ≥3 probes < 0.6 | [C] `drift.ts:7-52`; `drift-probe.ts:171-198` |
| On drift | stores an observation `drift_run` only. The daily message shows the mean and the top 2 flipped probes if the reading is ≤2 days old. **No other action** (no alert ping, no re-pin, no correction) | [C] `daily-message-inputs.ts:139-146` |

**Doc vs code:** doc 34 §2 says "re-pin only on constitution change". **[C]** The baseline key also includes the embedding model, so a model change re-pins too (`drift-probe.ts:50`).
**[I]** Belief changes and model sampling noise both move the answers, so the metric mixes belief churn with value drift.
**Tests:** `thinking/__tests__/drift-probe-handler.test.ts`, `constitution/__tests__/drift.test.ts`, `probes.test.ts`.

## 10. Mind compare, weekly review, daily message

| Job | Trigger / gate | Inputs | Outputs | LLM | Evidence |
|---|---|---|---|---|---|
| `mind_compare` | Mon ≥04:00Z, both minds non-empty; 3 h deadline; sweep fallback | all held aligned and own beliefs (≤300 each); greedy 1:1 pairing at cosine ≥0.82; ≤40 one-sided per side | ONE `observation` (`kind:'mind_compare'`): agree/diverge notes + notable one-sided beliefs. **Doesn't change beliefs** | LLM labels; pairing is deterministic | [C] `handlers/mind-compare.ts:48-80`; `beliefs/compare.ts:11-66,113-175` |
| `weekly_review` | Mon ≥05:00Z; 6 h deadline; sweep fallback | 7 days of board pages, objectives, belief changes (`listBeliefs status:'all'`), memory_ops summary, mind compare, asks, health | ≤5 `review_action` proposals (excluded from BackUp) + one `weekly_review` observation + one speak (`digest:true`, `kairos-weekly:<isoWeek>`) | LLM | [C] `handlers/weekly-review.ts:42-196`; `weekly-review/inputs.ts:216-311` |
| `daily_message` | job planned once briefs exist (deadline 07:55 London); cron `0 7,8 * * *` gated to London 08:00 | briefs (first 2 lines each), aether top 3, yesterday's board-day, backup promotions in 24 h, new belief rows in 24 h, drift ≤2 d, pending ask, synthesis rollup, mind compare on Mondays | message via `deliverKairosSpeak` (`digest:true`, `kairos-daily:<date>`), single-flight with `pg_try_advisory_xact_lock`. Order of preference: routine draft → paid key → deterministic | LLM (draft) | [C] `vercel.json`; `daily-message-inputs.ts:190-208`; `daily-message.ts:117-136,158-212`; `handlers/daily-message.ts:26-74` |

**Duplicated paths [C]:**
- `daily-message-inputs.ts` has its own belief and mind-compare queries (`:119-137,162-178`) instead of the `lib/data/beliefs.ts` readers.
- `fallbackConcept` hand-rolls its own paid-key call (`concept.ts:240-277`) instead of `paid-fallback.ts`; so does `constitution/seed.ts`.

**Tests:** `thinking/__tests__/weekly-review-handler.test.ts`, `daily-message-handler.test.ts`; `weekly-review/__tests__/*`; `__tests__/daily-message*.test.ts`; `app/api/cron/daily-message/__tests__/route.test.ts`.

## 11. Thinking queue

| Aspect | Built as | Evidence |
|---|---|---|
| Kinds | aether, cortex, concept, belief_extract, drift_probe, mind_compare, weekly_review, daily_message, chat | [C] `engine/types.ts:134-145`; `thinking/registry.ts:14-25` |
| PLAN_ORDER | cortex → concept → aether → belief_extract → drift_probe → mind_compare → weekly_review → daily_message → chat | [C] `thinking/queue.ts:44-47` |
| Planning | on every non-chat claim, and by the hourly sweep (`50 * * * *`) except concept and chat | [C] `queue.ts:167-200`; `app/api/cron/thinking-sweep/route.ts:52-67` |
| Sweep paid fallback | concept, belief_extract, drift_probe, mind_compare, weekly_review. ≤2 per run (`KAIROS_SWEEP_MAX_FALLBACKS`), 200 s budget | [C] `queue.ts:53-55,82-113,261-295` |
| Cron-owned fallback | cortex (03:00), aether (03:15), daily_message (08:00 London), chat (Telegram watchdog) | [C] `queue.ts:58-68` |
| Routine contract | claim gives system, prompt, validMemoryIds, claimToken; submit is parsed strictly with no repair; server grounds the output and mints ids | [C] `queue.ts:115-126,202-246` |
| What's live now | all crons in `vercel.json` (no flag). Telegram chat-on-Max is gated by `KAIROS_TELEGRAM_ROUTINE` (default off, `kairos/chat-routine.ts:57-60`). Handover says the routines on claude.ai aren't created yet, so everything runs on paid fallbacks | [C] config; prod env values and whether routines exist are **[U]** (`aeon_os/HANDOVER_0110.md` §3) |

**[I]** Any bearer MCP/REST client holding the operator's token can call `claim_thinking_job` / `submit_thinking_job` (`tools/thinking.ts:27-61`). It could submit `belief_extract` answers and so author aligned beliefs (`sourceType:'operator'`), limited only by id grounding.

**Tests:** `thinking/__tests__/queue.test.ts`, `handlers.test.ts`, `data/__tests__/thinking-jobs.test.ts`, `app/api/__tests__/thinking-parity.test.ts`, `app/api/cron/thinking-sweep/__tests__/route.test.ts`.

## 12. Security and provenance

| Question | Finding | Evidence |
|---|---|---|
| External content quarantined or trust-tiered before it shapes beliefs? | **No.** Provenance is only the stream-class prior. Any MCP/API/webhook caller can send `type:'reflection'`; it becomes stream `reflection` (confidence 0.9, ×1.15 trust) and an aligned-mind input | [C] `stream-class-default.ts:33`; `validators/memory.ts:54-74`; `data/beliefs.ts:129`; MCP `kairos_reflect` `tools/reflections.ts:31` |
| Chat or tool output reaching beliefs | chat → `chat-distill` reflections (source `cron`); dialogue reflections (source `claude`, `dialogue.ts:220-227,309-311`); board-day pages (card text) are explicit extract inputs | [C] |
| BackUp evidence | agent sessions (claude/codex/hook) count as independent support | [C] `back-up.ts:27-54` |
| Injection defence | `neutraliseFences` (``` → ''') only; "treat as data" lines in extract, compare and concept prompts; BEGIN/END data markers in chat board/recency context | [C] `_prompt-utils.ts:20-26`; `extract-prompt.ts:34`; `compare.ts:76`; `concept-prompt.ts:30`; `chat-board-context.ts:128`; `chat-recency-context.ts:146` |
| Structural defences | id grounding (models can't invent ids), zod schemas, operator-only constitution accept, undo ledger | [C] §7–§8 |

## 13. Legacy and parallel paths

| Path | Schedule | Relation to the engine | Evidence |
|---|---|---|---|
| introspection | 06:30 daily | feeds BackUp candidates (`inbound`, `agentic`, source `cron`); recency-ordered pool; direct insert | [C] `vercel.json`; `introspection.ts:200-223` |
| contradiction-scan | 05:00 daily | feeds Challenged (via `loserId`); probes non-belief types in a 7-day window; accepting supersedes the loser without memory_ops | [C] `contradiction.ts:36-80,216-265`; `memories.ts:1478-1524` |
| cortex-regen / aether-regen | 03:00 / 03:15 | parallel to queue handlers (routine first, cron fallback via `alreadyRanToday`); archive previous row and insert a new one (no ops); retrieved newest-first, not ranked | [C] `cortex.ts:270-293`; `aether.ts:274-292`; `retrieve.ts:155-222` |
| archetype-synthesis | 02:30 | not on the queue (no handler); recency pools | [C] `archetypes.ts:96-124`; `thinking/registry.ts` |
| memory-dedup | Sun 05:00 | duplicates Merge for `session_event`; no ops; sets `invalidAt` | §1 |
| micro-consolidate | 7×/day | writes `delta` (meta, never scored) | [C] `streamClass.ts:35` |
| chat-distill | 02:00 | writes reflections that feed `belief_extract` | §7 |

## 14. Briefer rewire (P2 card item)

**[C] Not done.** `recipes/brief.ts:20-51` builds its prompt from `ctx.retrieval.bundle` only: vision, mission, objectives, projects, recent memories, board tasks.
- The dispatcher's `retrieveContext` call passes no query (`dispatch.ts:49-53`), so the substrate is empty (`retrieve.ts:251`, needs ≥3 chars). The cortex and archetypes it fetches are ignored.
- The recipe's `reads: ['cortex','archetype','execution','reflection']` (`brief.ts:91`) is a declaration only.
- Beliefs, constitution and aether are read only by `daily-message-inputs.ts` (beliefs, promotions, drift, aether top-3, mind compare) and by `weekly-review/inputs.ts` (belief changes, mind compare).

## Known gaps, TODOs, dead and duplicated code
- **[C]** `TODO/FIXME` grep of `lib/kairos` finds one hit: `chat-turn-reply.ts:197` (DB access outside `lib/data`).
- **Dead [C]:** `MemoryOpKind 'reject'` (`types.ts:71`); belief `sourceType:'tool'`; reverting a `score` op (overwritten the next night).
- **Duplicated [C]:**
  - Merge vs legacy dedup.
  - daily-message's own belief queries.
  - seed.ts and concept.ts paid-call copies.
  - Two recency curves: `confidence.ts` (90 d on updatedAt) and `recencyMultiplier` (14 d on createdAt), both still live for unscored rows.
- **Scale [C]:** Weigh caps at 2000 rows/night (dry run showed `first-scored 1902`, per the handover). BackUp caps at 400 candidates/night. Embedding backfill runs once a day at 200 rows.

## Open questions and next checks
- **[U]** Prod env (`KAIROS_TELEGRAM_ROUTINE`, sweep limits, `VOYAGE_API_KEY`) and whether the claude.ai routines exist. Check: Vercel env + `thinking_jobs.claimed_by` distribution.
- **[U]** Embedding lag in prod. Check: `count(*) where embedding is null and created_at > now()-'2 days'`. This tells you whether Merge's 36 h window is starving.
- **[U]** How often superseded rows appear in chat grounding. Check: `select count(*) from memories where superseded_at is not null and invalid_at is null and stream_class in (substrate streams)`.

---

## Executive Summary

I traced how Kairos's memory and belief system actually works in the code, as opposed to what the design docs promise. The foundations are solid: memories are scored, fade over time, can be undone, and get folded together at night, and Kairos keeps two sets of beliefs side by side. But several of the "living memory" features are thinner than the docs suggest, and a few pieces are built but not yet wired into anything that uses them.

**Key points:**
- 🟡 Kairos only "learns" from use when it cites a memory in chat, uses it to answer a question, or you accept a suggestion. Simply looking something up doesn't count, and similar memories are never strengthened together.
- 🔴 The constitution is only used by the nightly drift check. It never shapes chat, the morning brief or any other message. Older beliefs and the constitution also stop being found by chat search after about 90 days.
- 🔴 Anything written as a "reflection" through the API, chat summaries, or other agents is treated as your own words when beliefs are formed. Nothing checks where it came from, and beliefs aren't re-examined when the memories they rest on are later corrected.
- ⚠️ I couldn't save the report to the research folder because I'm limited to reading in this role. Next useful check: confirm the production settings and whether new memories are being searchable fast enough for nightly duplicate-folding to work.
