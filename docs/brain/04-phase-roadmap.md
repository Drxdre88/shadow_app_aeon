# Aeon Brain — Phase Roadmap

| Phase | Theme | Effort | Status |
|---|---|---|---|
| **1** | Memory substrate (table + 4 MCP tools + markdown round-trip) | ~1 week | drafting (this folder) |
| **2** | Claude session capture via global `Stop` hook | ~1 day | spec'd |
| **3** | Typed canvas edges + memory↔canvas promotion + heuristic link-suggest | ~1 week | spec'd |
| **4** | `prepare_context()` MCP tool — CAG packing with budget | ~1 week | spec'd |
| **5** | Daily briefing cron + voice in/out (Web Speech API) + `/brain` UI | ~2 weeks | spec'd |
| **6** | `pgvector` shadow index (only if BM25 ceiling hit) | ~1 week | deferred |

Total to JARVIS-grade MVP: **~3–4 weeks of focused work** (excluding Phase 6).

---

## Phase 1 — Memory substrate

**Cards in Aeon (PBI Queue, P9: Brain / Memory label):**

1. `Schema: memories table + Drizzle + migration` — DB foundation
2. `Data layer: lib/data/memories.ts` — CRUD + FTS query + graph walk
3. `Validators: extend lib/data/validators.ts` — Zod schemas for all memory ops
4. `Server actions: lib/actions/memories.ts` — auth-guarded wrappers
5. `REST API: /api/v1/memories/*` — 7 routes (CRUD + search + export + import)
6. `MCP tools: create_memory + search_memories + link_memory + get_memory_with_neighbours` — 4 tools wired
7. `Markdown export: lib/data/memoriesMarkdown.ts` — YAML frontmatter round-trip, zip stream
8. `Parity test: memories-parity.test.ts` — MCP↔REST drift lock

**Done definition for Phase 1:**
- `npm run typecheck` green
- `npm run test` green including new parity test
- `POST /api/v1/memories` creates a memory and returns it
- `GET /api/v1/memories/search?q=…` returns ranked results
- Round-trip: `GET /export` → unzip → modify one file → `POST /import` → diff is empty
- All four MCP tools callable from Claude with a freshly-issued API key

**Out of scope for Phase 1:**
- Any UI (`/brain` route lands in Phase 5)
- Session-capture hook (Phase 2 — depends on REST being live)
- Canvas integration (Phase 3)
- `prepare_context()` (Phase 4)
- Vectors (Phase 6 if needed)

---

## Phase 2 — Session capture

**Single change.** A `Stop` hook in `~/.claude/settings.json` that, after each Claude session, POSTs a structured summary to `/api/v1/memories`:

```jsonc
{
  "title": "<repo>: <one-line subject>",
  "bodyMd": "<full session summary as markdown>",
  "summary": "<one-liner>",
  "type": "session_summary",
  "source": "claude",
  "realmId": "<from CLAUDE.md hint or last-used>",
  "projectId": null,
  "sourceMetadata": {
    "repo": "<git remote name>",
    "branch": "<branch>",
    "sessionId": "<claude session uuid>",
    "filesTouched": ["…"],
    "commits": ["…"]
  },
  "tags": ["session", "<repo>"]
}
```

**Hook script:** PowerShell on Windows + bash on POSIX. Reads the transcript path, asks Claude (via `claude --print`) for a 5-bullet summary + one-line subject, then `curl`'s the JSON.

**Card:**
- `Hook: global Stop session-capture into /api/v1/memories`

**Why now and not Phase 1.** Phase 2 depends on the REST surface from Phase 1 being deployed. It is the minimum work to make the brain *fill itself*.

---

## Phase 3 — Hypergraph activation

**Schema change.** Add `edge_type` and target-kind discriminators to `canvas_edges`:

```sql
ALTER TABLE canvas_edges
  ADD COLUMN edge_type varchar(30) NOT NULL DEFAULT 'relates',
  ADD COLUMN source_kind varchar(20) NOT NULL DEFAULT 'canvas_node',
  ADD COLUMN target_kind varchar(20) NOT NULL DEFAULT 'canvas_node';
```

`source_node_id` / `target_node_id` become nullable when `*_kind ≠ 'canvas_node'`, and a polymorphic `source_id` / `target_id` resolves against the appropriate table.

**Capability.**
- "Promote memory to canvas" action — turns a memory into a `canvas_nodes` row with `metadata.memory_id` backref.
- Auto-suggest edges via heuristics (shared tags, same realm, co-occurring in same `source_metadata.session_id`). Not embeddings — explicit signal first.

**Cards:**
- `Schema: typed canvas_edges + polymorphic targets`
- `Data: promote_memory_to_canvas / link suggestions via heuristics`
- `UI: canvas node renders memory body on hover` (Phase 3.5, optional)

---

## Phase 4 — `prepare_context()`

**The single MCP tool that makes Aeon a brain.** Given a query and a token budget, return a markdown package ready to drop into a Claude context window.

```ts
prepare_context({
  query:       string,
  budgetTokens?: number,    // default 4000
  realmId?:    uuid,
  includeBoard?: boolean,   // default false — also include active board state
  includeActivity?: boolean // default false — also include last 7d activity log
}) → { contextMd: string, tokensUsed: number, sources: Array<{id, title, score}> }
```

**Algorithm.**
1. BM25 over `memories.fts` (+ `taskComments.content` + `boardTasks.description` if `includeBoard`). Top-K (K = ~30).
2. Walk `memories.links` 1 hop from top hits. Add neighbours scored by edge type (`supports` > `refers_to` > `relates` > `contradicts`).
3. Sort by composite score (BM25 + recency + pin status).
4. Pack into budget: first `pinned` items, then `summary`-only entries until budget half-full, then full `body_md` for top remaining hits.
5. Return a single markdown document with `## Pinned`, `## Most relevant`, `## Related` sections.

**Card:**
- `MCP: prepare_context tool + REST mirror`

This is what users will actually use day-to-day. Everything before this is plumbing.

---

## Phase 5 — JARVIS surface

**Three parallel tracks:**

a. **Daily briefing.** Vercel cron at 07:00 user-local → calls `prepare_context("daily briefing")` → renders markdown → publishes to user's Pusher channel → PWA push notification with a deep link.

b. **Voice in/out.** Web Speech API (free, browser-native) for STT (creates memories via existing REST) and TTS (reads daily briefing). Whisper-via-server is a Phase 5.5 upgrade for accuracy.

c. **`/brain` route.** Single-page UI — left panel: memory list with FTS search; centre: memory editor; right panel: graph view (existing `canvasView` adapted to render memory neighbours). Pinned memories always visible. New-memory composer auto-tags by realm context.

**Cards:**
- `Cron: daily briefing — prepare_context → Pusher → PWA push`
- `Voice: Web Speech API STT + TTS for /brain`
- `UI: /brain route — list + editor + graph`
- `PWA: register memory channel + handle push notification routing`

---

## Phase 6 — `pgvector` shadow index (deferred)

**Trigger condition.** Either (a) memory count exceeds ~10,000, *or* (b) Phase 4 user-feedback says BM25 misses semantically-close memories often enough to be a problem.

**Implementation.**
- Enable `pgvector` extension on Neon (`CREATE EXTENSION vector`)
- Add `embedding vector(1536)` column to `memories` (nullable)
- Background job: backfill embeddings for existing memories using OpenAI `text-embedding-3-small` (cheap, fast)
- New embedding written on every `create_memory` / `updateMemory` body change
- Modify `search_memories` to support hybrid mode: `BM25 score × 0.7 + cosine_similarity × 0.3`, RRF rerank
- Embeddings remain a *shadow* — markdown export ignores them, import does not require them

**Why deferred.** Adds operational cost (embedding API calls), increases p95 write latency, and complicates the export contract — for an upside that doesn't manifest until corpus scale. Premature.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `links jsonb` graph walk slow at 10k+ memories with dense edges | Medium | Extract to a `memory_links` join table in Phase 3 if `EXPLAIN ANALYZE` shows pain. Migration is mechanical (jsonb → rows). |
| Session-capture hook spams the brain with low-value summaries | High | Phase 2 adds a quality gate — Claude rates its own summary 1–5, only ≥3 are posted. User can tune threshold in `CLAUDE.md`. |
| Markdown round-trip drifts as new fields are added | Medium | Parity test in Phase 1 fails CI on round-trip diff. New fields without `.md` representation fail the contract. |
| Voice interface (Phase 5) brittle across browsers | Medium | Web Speech API is OK in Chromium-based PWAs (Edge, Chrome Android). iOS Safari is the gap — voice-out works (SpeechSynthesis), voice-in degrades to a "tap to dictate native keyboard" fallback. |
| Scope creep — features migrate out of "board PM" identity | High | Brain ships as a separate top-level surface (`/brain`), not as a board feature. Marketing copy stays focused on PM until Phase 5 ships and the brain is provably useful. |

---

## Open questions for the next session

1. **Should `memories` be its own table, or should it be implemented as `boardTasks` in a synthetic "Brain" project?** The latter reuses every existing tool, the former gives proper user-scoping and a clean FTS column. **Current call: new table** — the user-scoping difference is too important to fudge.
2. **What's the auth model for cross-realm memory search?** A memory has `realm_id` nullable — should `search_memories` return cross-realm hits by default? **Current call: yes, with optional `realmId` filter** — the brain is *the user's*, not the realm's.
3. **Should Phase 1 include the markdown import path, or defer it to Phase 2?** Export is trivially shippable; import touches conflict resolution. **Current call: export in Phase 1, import in Phase 1.5** — gives the durability story without blocking on edge cases.
