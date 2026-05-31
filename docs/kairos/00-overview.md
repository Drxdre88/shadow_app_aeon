# Aeon Brain — Overview

**Status:** Phase 1 drafting (started 2026-05-13)
**Owner:** Andrey
**Vision parent:** [`docs/AEON_MEMORY_KNOWLEDGE_BASE_IDEAS.md`](../AEON_MEMORY_KNOWLEDGE_BASE_IDEAS.md) — ideas #8 (Context Capsules) and #10 (MCP Memory Loop) are the strategic anchors. This folder is the *technical spec* that operationalises them.

---

## What we are building

A **markdown-first, hypergraph-native memory layer** inside Aeon that turns the existing schema into a unified brain — capturing Claude session insights, user notes, decisions and ideas, and serving them back as compact context packages to any AI assistant via MCP.

The end goal is a daily JARVIS-grade command centre. The Phase 1 deliverable is the substrate: a `memories` entity, four MCP tools, markdown round-trip, and a session-capture hook.

---

## The 2026 mental model (why this is not a vector DB project)

Three findings from May 2026 research drove the architecture:

1. **RAG is bifurcating, not dying.** Chunk-and-retrieve is dead. Two survivors: (a) Cache-Augmented Generation — load curated context directly into the window for corpora <1M tokens (NotebookLM, Claude Projects), and (b) hypergraph reasoning for large/structural corpora (GraphRAG, Palantir AIP). We sit firmly in pattern (a) for the foreseeable horizon.
2. **Markdown-first is the new orthodoxy.** Source-of-truth is `.md`, the index is a rebuildable shadow. Memsearch, Claude Code's own `MEMORY.md` + topic-files pattern, and most 2026 agent-memory implementations converge on this.
3. **Context engineering ≠ retrieval.** The loop is *write → compress → isolate → select → inject*. Gartner: 2026 is "the year of context."

**Concrete scaling thresholds (from the literature):**
- < 1k entries → ripgrep / Postgres LIKE
- 1k – 10k entries → BM25 / Postgres `tsvector`
- 10k+ → hybrid vector + BM25 (~70:30)
- Wiki sweet spot is 100–10k high-signal docs

A personal brain operating across realms will sit in that sweet spot for years. Therefore: **Postgres FTS in Phase 1. `pgvector` deferred to Phase 6 as a shadow index, not the primary substrate.**

---

## Why Aeon is the right home for this

Re-reading the existing schema with a memory-layer lens reveals Aeon is already ~80% of a mem0-style hybrid store:

| mem0 layer | Aeon equivalent |
|---|---|
| Key-value (facts/prefs) | `boardTasks`, `projects`, `userPreferences` |
| Graph (relationships) | `canvasNodes` + `canvasEdges` (typed-edge ready via `metadata jsonb`) + `taskDependencies` |
| Vector (semantic) | *Missing — not needed for years* |
| Daily-log substrate | `activityEvents` (populated, no UI) |
| Per-entity dialog log | `taskComments` |
| AI read/write surface | **66-tool MCP server** ← rare |

What's missing is positioning (a `memories` entity that lives *above* projects, scoped to the user), ingestion (a session-capture endpoint), and one context-engineering MCP tool (`prepare_context`).

---

## Design principles

1. **Markdown is canonical.** Every memory round-trips losslessly to `.md` with YAML frontmatter. The DB is the index; the markdown export is the source of truth a human can read in Notepad.
2. **User-scoped, not project-scoped.** A memory belongs to a person, can *optionally* link to a realm / project / task. This is the critical difference from `taskComments`.
3. **Hypergraph-ready from day one.** Memories link to memories, tasks, projects, realms via a typed-edge `links jsonb` column. No separate graph table needed yet — `canvasEdges` extends naturally when we promote memories to canvas nodes.
4. **No vectors in v1.** Postgres FTS (`tsvector` + GIN index). Embeddings come later as a shadow index, only when BM25 stops feeling smart.
5. **CAG over RAG.** `prepare_context(query, budget_tokens)` returns a single markdown package ready to drop into a Claude context window. Not a retrieval API.
6. **MCP-first.** Every capability ships as an MCP tool *and* a REST route (parity invariant). Voice/desktop/PWA clients all hit the same surface.

---

## What this is NOT

- Not a vector database project. `pgvector` is Phase 6, optional, behind a flag.
- Not a chat UI project. Phase 1 ships zero UI — it's substrate.
- Not a rewrite of `taskComments` or `activityEvents`. Those keep their roles. Memories are a new, user-scoped layer above them.
- Not a competitor to mem0 the SaaS. The product framing remains *project management* — this layer is the connective tissue that makes Aeon stickier.

---

## Phase deliverables (one-line summary)

| Phase | Deliverable | Status |
|---|---|---|
| **1** | `memories` table + 4 MCP tools + REST parity + markdown round-trip | drafting |
| **2** | `Stop`-hook session-capture into `/api/v1/memories` | spec'd |
| **3** | Typed `canvasEdges` + "promote memory to canvas" + heuristic link-suggest | spec'd |
| **4** | `prepare_context()` MCP tool (BM25 + graph walk + compress) | spec'd |
| **5** | Daily briefing cron + voice in/out (Web Speech API) | spec'd |
| **6** | Optional `pgvector` shadow index when entries exceed ~10k | deferred |

See `04-phase-roadmap.md` for the detailed slice.

---

## What to read next

- `01-schema.md` — the `memories` table, indexes, FTS setup
- `02-mcp-tools.md` — 4 tool signatures + REST mirror
- `03-markdown-format.md` — the canonical `.md` round-trip format
- `04-phase-roadmap.md` — Phase 1 → Phase 6 plan with effort estimates
