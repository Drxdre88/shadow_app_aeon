# Aeon Brain — Canonical Markdown Format

The DB is the index. The `.md` export is the **source of truth a human can hold in their hand.** Round-trip fidelity is the litmus test: import the export back and every byte that matters must survive.

---

## Single-memory `.md` shape

```markdown
---
id: 7e4a8b32-9c1d-4ef0-a5b7-2c8d3e6f1a90
title: "RAG bifurcation — cache vs hypergraph"
type: observation
source: claude
created: 2026-05-13T14:32:11Z
updated: 2026-05-13T14:32:11Z
realm: AI Engineering
project: null
task: null
tags:
  - context-engineering
  - 2026-research
  - architecture
pinned: false
source_metadata:
  repo: shadow_app_aeon
  branch: main
  session_id: 9e1c-...
  files_touched: 0
  commits: []
links:
  - type: supports
    target_kind: memory
    target: 1c2d3e4f-...
    note: prior note on Memsearch shadow-index pattern
  - type: refers_to
    target_kind: url
    target: https://arxiv.org/abs/2504.19413
summary: |
  Standard RAG is bifurcating in 2026: cache-augmented generation under
  1M tokens, hypergraph retrieval beyond. Chunk-and-retrieve is dead.
---

# RAG bifurcation — cache vs hypergraph

The 2026 consensus across mmntm.net, callstack, and the akitaonrails review
is that standard chunk-and-retrieve RAG is being subsumed into two
distinct patterns:

1. **Cache-Augmented Generation (CAG)** — under ~1M tokens, just load the
   corpus into the model's context window. NotebookLM and Claude Projects
   are the canonical examples.

2. **Hypergraph retrieval** — over ~1M tokens and structurally complex,
   use typed-edge knowledge graphs with iterative reasoning. Microsoft
   GraphRAG and Palantir AIP are production references.

The middle ground — chunk + embed + top-k retrieve — is what is dying.
It solved a constraint (small context windows) that no longer exists.

## Implications for Aeon

A personal brain at 100–10,000 entries sits firmly in CAG territory.
Postgres FTS plus a graph walk over `memories.links` plus `summary`-field
compression covers every retrieval need we have until the corpus grows
past ~10k. Embeddings remain optional, deferred to Phase 6.
```

### Why this exact shape

| Choice | Rationale |
|---|---|
| YAML frontmatter | Human-skimmable, parser-ubiquitous, git-diff-friendly. Same format Claude Code's auto-memory uses. |
| `id` in frontmatter | Round-trip identity. Import looks up by id, falls back to create-by-content-hash on collision. |
| `realm` / `project` / `task` as *names* (not UUIDs) | Human-readable. Importer resolves by name within the user's scope; ambiguous names trigger a prompt rather than silent miss. UUIDs remain in the DB for the cold path; names live in the `.md` for the warm path. |
| `created` / `updated` ISO-8601 with `Z` | Single timezone canonical, no DST traps. |
| `tags` as YAML list | Trivial to grep and edit by hand. |
| `links` as list-of-objects (not list-of-strings) | Edges need type + direction + note. Compact string forms (e.g. `relates:7e4a-...`) are tempting but lose the `note` field and create parser ambiguity. |
| `source_metadata` as a nested mapping | Free-form per source. Frontmatter handles arbitrary nesting cleanly. |
| `summary` in frontmatter (not body) | Used at *index* time by `prepare_context()`. Keeping it in frontmatter means the body stays clean prose, and a stripped frontmatter export ("body only") still reads naturally. |
| Body is plain markdown | No custom DSL. A memory is just a note. The `# Title` repeats the frontmatter `title` so the file reads cleanly when opened standalone — but the frontmatter is authoritative on parse. |

---

## Directory layout for bulk export

```
memories-export/
├── MEMORY.md                           ← index (one-liner per memory, dated)
├── daily/
│   ├── 2026-05-13.md                   ← all memories created today
│   ├── 2026-05-12.md
│   └── …
├── by-realm/
│   ├── AI Engineering/
│   │   ├── 7e4a8b32-rag-bifurcation.md
│   │   └── …
│   ├── Core/
│   └── …
├── by-type/
│   ├── decisions/
│   ├── reflections/
│   ├── session-summaries/
│   └── …
└── topics/
    ├── context-engineering.md          ← merged view: all memories tagged context-engineering
    └── …
```

**Why this structure mirrors Memsearch + Claude Code's pattern:** `MEMORY.md` is the curated 200-line index. `daily/YYYY-MM-DD.md` is the chronological substrate. `topics/<tag>.md` is the routing-table view. `by-realm/` and `by-type/` are convenience cuts for browsing.

**Important.** The individual `.md` files in `by-realm/` are the *only* canonical files. `daily/`, `by-type/`, `topics/`, and `MEMORY.md` are **rebuildable views** generated at export time. On import, we ignore them and read only `by-realm/**/*.md`.

---

## `MEMORY.md` index format

```markdown
# Aeon Brain — Memory Index

Last exported: 2026-05-13T14:35:00Z
Total memories: 247

## Pinned
- [Core principles for Aeon UX](by-realm/Core/3a1b-core-ux-principles.md) — design philosophy anchor
- [What "morphism" means](by-realm/Personal/9c2d-morphism-philosophy.md) — fluidity over rigidity

## Recent (last 14 days)
- 2026-05-13 — [RAG bifurcation — cache vs hypergraph](by-realm/AI Engineering/7e4a-rag-bifurcation.md)
- 2026-05-13 — [Aeon brain Phase 1 spec](by-realm/AEON Dev/1c2d-brain-phase-1.md)
- 2026-05-12 — [Claude code memsearch deep-dive](by-realm/AI Engineering/4f5g-memsearch.md)
- …

## By realm
- **AEON Dev** (84) — [browse](by-realm/AEON Dev/)
- **AI Engineering** (52) — [browse](by-realm/AI Engineering/)
- **Core** (38) — [browse](by-realm/Core/)
- **Personal** (31) — [browse](by-realm/Personal/)
- **Short Term Power** (24) — [browse](by-realm/Short Term Power/)
- …

## By type
- decisions (18) — [browse](by-type/decisions/)
- reflections (45) — [browse](by-type/reflections/)
- session-summaries (112) — [browse](by-type/session-summaries/)
- …
```

200-line cap is enforced at generation time — older "Recent" entries fall off into a rotated `OLD-MEMORY-INDEX.md` (same pattern Claude Code uses for stale lessons).

---

## Round-trip contract

**Export → modify → import** must be lossless for these fields:

- `id`, `title`, `body_md`, `summary`, `type`, `source`, `created_at`
- `tags`, `pinned`, `archived_at`
- `realm_id`, `project_id`, `task_id` (resolved from names; names that no longer exist become `null` with a warning)
- `links[].type`, `links[].target_kind`, `links[].target`, `links[].note`
- All keys under `source_metadata`

**Not preserved** (acceptable lossy behaviour):

- `updated_at` — replaced with import time
- `fts` — regenerated by Postgres
- File-system metadata (mtime, etc.)

A `/api/v1/memories/import` call that produces a non-empty diff against the same user's export within 60 seconds is a parity-test failure.

---

## Why this is the durability bet

The single most important property of this entire brain layer is that **the user can `git init` the export, walk away from Aeon, and still own their brain.** Vendor lock-in is the death of a personal-memory product. The `.md` round-trip is the answer — Aeon stays the best place to *use* the brain, but is never the only place to *hold* it.
