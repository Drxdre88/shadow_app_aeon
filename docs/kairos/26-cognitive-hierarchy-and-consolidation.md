# Kairos — Cognitive Hierarchy & the Consolidation Engine

**Status:** spec · 2026-06-10 · anchors the AEON objective *"Kairos: cognitive hierarchy + consolidation engine"*

This is the blueprint for taking Kairos from *flat accumulation* (everything stored equal-weight, forever) to a *layered, self-consolidating* brain. It covers the full hierarchy and then specs the **first build**: the embedding dedup pass and the Concept tier.

---

## 1. The hierarchy (a heterarchy, not a rigid tree)

| Tier | What it is | Brain analogy | Status |
|---|---|---|---|
| **Memory** | one captured thing | neuron / engram | ✅ exists |
| **Episode** | one session's memories; a moment | a firing sequence | ⚪ implicit |
| **Concept** | a semantically coherent cluster = one idea | a cell assembly | ❌ **build now** |
| **Dominion** | a whole strand of work | a cortical region | ✅ exists |
| **Constellation** | a family of related Dominions | a lobe / network | ❌ later |
| **Worldview** | global self-model across everything | the connectome | ❌ later |

**Cross-cutting (the neurons, not a tier):** *archetypes* (recurring patterns) and *thought-chains* (typed-link reasoning pathways), made neural by **Hebbian weighting** — reinforced links strengthen, unused ones decay.

**Principle:** levels EMERGE from meaning-clustering and re-form as the corpus shifts. Morphism over rigidity — never fixed folders. A memory may belong to several Concepts; a Concept may span Dominions.

**Guardrail — chaos for seeing, control for changing:** mechanical merges of machine-generated rows run autonomously; anything operator-authored is *proposed*, never silently rewritten (same gate as introspection).

---

## 2. What already shipped (the primitives)

The P2 go-live (migrations 0023/0024) gave us everything the engine needs:
- `embedding vector(1024)` + HNSW index → similarity clustering & dedup (`vectorSearchMemories`, `lib/data/memories.ts`).
- `superseded_at` / `superseded_by_id` → honest pruning (stamp, never delete).
- `confidence` → trust weighting.
- memory types `archetype`, `dominion_cortex` → distillation targets.
- `rrfFuse` + the introspection propose-not-commit loop → retrieval fusion + the safety gate.

The work is the *engine that connects them*, not new substrate.

---

## 3. First build A — Embedding dedup pass

**Goal:** collapse near-duplicate memories (the 324 daily snapshots are the worst offender) by superseding redundants against a canonical.

**Algorithm**
1. Iterate candidates with a non-null embedding, oldest-first, skipping already-superseded rows.
2. For each, `vectorSearchMemories(userId, embedding, {limit, minScore})` to find neighbours; a pair is a duplicate when `cosine ≥ τ`.
   - `τ = 0.95` for auto-generated types (`snapshot`, `session_event`, `advisory`); `τ = 0.97` for authored content (stricter — avoid merging genuinely distinct notes).
3. **Canonical selection** within a duplicate set: prefer `pinned` > highest `confidence` > newest `createdAt`.
4. **Supersede** the non-canonical: set `superseded_at = now()`, `superseded_by_id = canonical.id`. Never delete.
5. **Autonomy gate:**
   - machine-generated types → act autonomously.
   - operator-authored (`reflection`, `decision`, `note`, `fact`, `idea` with `source != 'cron'`) → stage an `inbound` proposal ("these 3 look like duplicates of X — merge?") for accept/dismiss.

**Retrieval must honor supersession** — add `superseded_at IS NULL` to the FTS + vector candidate filters in `vectorSearchMemories` and the FTS query (or down-weight, but excluding is cleaner). Without this, dedup has no visible effect.

**Surface:** a cron (`/api/cron/memory-dedup`, mirrors `embed-backfill`) + a driver script for one-shot runs. Idempotent — superseded rows are skipped.

**Expected:** 20–30% reduction in the active retrievable set; cleaner graph; sharper retrieval.

---

## 4. First build B — The Concept tier

**Data model — a Concept IS a memory.** Add `concept` to the memory `type` enum. No new table. A Concept is a distilled memory whose body is the synthesis, whose `embedding` is computed from that synthesis, and which links to its member atoms via typed links (`refers_to` member edges). This reuses retrieval, embeddings, the graph, and supersession for free — and keeps it morphism-friendly (a memory can be a member of several Concepts).

**Formation (per Dominion):**
1. Pull the Dominion's non-superseded memories with embeddings.
2. Cluster by similarity — start simple: greedy agglomerative over cosine (threshold ~0.82), cap cluster size, drop singletons. (HDBSCAN later if needed.)
3. For each cluster above size N, distil one Concept: an LLM pass (BYOK, `taskType:'reflect'`) writes a title + 5–8 bullet synthesis, **citing member ids** (ungrounded → discard, same anti-drift leash as introspection).
4. Write the Concept as `type='concept'`, embed it, link members via `refers_to`, stamp `confidence` from the members' aggregate.
5. Re-running updates the existing Concept (re-cluster, re-distil) rather than duplicating — match by member-set overlap.

**Retrieval integration:** Concepts join the RRF pool but are **up-weighted** vs raw episodic, so a query surfaces the distilled idea first with its atoms as drill-down. The morning brief can summarize at Concept altitude instead of dumping sessions.

**Autonomy:** Concept formation over episodic/auto memories is autonomous; if a cluster is dominated by operator reflections, propose the Concept rather than committing.

---

## 5. Sequencing

1. **Fix the `type`-filter bug** in `list_memories_needing_summary` (blocks targeted per-type passes).
2. **Dedup pass** (A) — fastest value, proves the embeddings earn their keep, shrinks the corpus before clustering.
3. **Concept tier** (B) — the mid-tier; everything above (Constellation, Worldview) is just this applied recursively at higher altitude.
4. Then the **nightly consolidation daemon** wraps A+B into a sleep-cycle, and **Hebbian weighting** makes the link web self-organize.

The Kairos-graph **semantic kNN edges** feature shares the clustering machinery from B — build them together.

---

## 6. Open decisions

- **Clustering algorithm:** greedy-agglomerative (simple, deterministic) vs HDBSCAN (better shapes, a dep). Start greedy.
- **Concept staleness:** when a member is edited/superseded, re-null the Concept's embedding and re-distil on the next daemon run (mirror `updateMemory`'s embedding re-null).
- **Where dedup excludes vs down-weights** superseded rows — recommend exclude.
- **Episode tier:** likely implicit (a session_summary already groups a session); promote to explicit only if Concepts need it.
