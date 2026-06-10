# Semantic Hybrid Retrieval (P2)

**Status:** shipped (code) · GO-LIVE is operator-gated 2026-06-06
**Scope:** `apps/web/src/lib/kairos/embeddings.ts`, `apps/web/src/lib/data/memories.ts` (`vectorSearchMemories`, `rrfFuse`, `fuseHybrid`, `backfillEmbeddings`, `prepareContext`), migration `drizzle/0023_memory_embeddings.sql`, cron `apps/web/src/app/api/cron/embed-backfill`, driver `apps/web/scripts/backfill-embeddings.mjs`.
**Builds on:** doc 00 (which deferred vectors to "Phase 6, only when BM25 stops feeling smart") — P2 lands them early as a **shadow index fused on top of FTS**, exactly as that doc framed it: vectors complement keyword search, they don't replace it.

This is the second leg of retrieval. FTS (BM25 via Postgres `tsvector`) catches exact terms; a vector search catches meaning ("mobile strategy" ↔ "Capacitor pivot" even with zero shared words). P2 runs both and fuses them in app code with Reciprocal Rank Fusion. The whole thing **degrades to pure FTS** the moment an embedding key is absent — so it's safe to ship dark and switch on later.

---

## 1. Embedding provider — one app-owned key

`embeddings.ts` resolves a single **server-managed** key (NOT the per-user BYOK chat keys — the embedding index is app-owned, not per-user generation):

| Env var | Provider | Model | Notes |
|---|---|---|---|
| `VOYAGE_API_KEY` | Voyage | `voyage-3.5` @ 1024 dims | **primary.** asymmetric `input_type` (query vs document) |
| `OPENAI_API_KEY` | OpenAI | `text-embedding-3-small` truncated to 1024 (MRL `dimensions`) | **fallback.** no asymmetric mode |
| *(neither)* | — | — | **embeddings disabled → retrieval is pure FTS** |

Resolution is "first one set wins, Voyage before OpenAI" (`resolveProvider()`). Helpers the rest of the system keys off:

- `embeddingsEnabled()` → boolean, the runtime gate everywhere.
- `activeEmbeddingModel()` → e.g. `"voyage:voyage-3.5"`, stamped onto each row's `embedding_model`.

**All vectors are 1024-dim** regardless of provider, so the column type is fixed. But vectors from different models are **not comparable** — the active model is stamped per row so the backfill can detect drift and re-embed. **Keep ONE provider active for a given corpus.** Switching providers means a full re-embed (the backfill picks it up automatically because `embedding_model` no longer matches `activeEmbeddingModel()`).

Implementation note: raw `fetch`, no SDK, so we get reliable control of Voyage's `input_type` / `output_dimension` (the AI-SDK wrappers expose these inconsistently). Per-input text is clipped to ~24k chars to stay under provider token limits.

## 2. Storage — the vector column + HNSW index

Migration `0023_memory_embeddings.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "memories" ADD COLUMN "embedding" vector(1024);
ALTER TABLE "memories" ADD COLUMN "embedding_model" varchar(40);
CREATE INDEX "memories_embedding_idx"
  ON "memories" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

The HNSW index **builds instantly at migration time** — every existing row has a NULL embedding, so there's nothing to index yet. NULL embeddings are skipped by the index and excluded from `<=>` ordering, so the backfill can populate vectors asynchronously and the index maintains itself incrementally. The `embedding` / `embedding_model` columns are modelled in `schema.ts` (so `db:push` keeps them); the **index itself is raw SQL** like the `fts` GIN index from migration 0013.

## 3. Vector search — `vectorSearchMemories()`

A deliberately flat `ORDER BY embedding <=> $vec LIMIT n` — no CTE, no heavy pre-filter — because pgvector's planner **skips the HNSW index inside CTEs or behind complex filters**. It runs inside a transaction with `SET LOCAL hnsw.ef_search = 100` so recall is bounded above the LIMIT, and the GUC auto-reverts on commit (never leaks across the pooled Neon connection). Returns SLIM rows nearest-first; user-scoped + archived-excluded + `embedding IS NOT NULL`, with the same optional realm/project/task/dominion/type filters as FTS.

## 4. Fusion — RRF in app code

`prepareContext()` (the engine behind `prepare_context` MCP / `GET /api/v1/memories/context`) now does:

1. **Always** runs FTS (`searchMemoriesFts`).
2. **If `query` is set AND `embeddingsEnabled()`**: embeds the query as `'query'` type, runs `vectorSearchMemories`, and fuses with `fuseHybrid()`. **Wrapped in try/catch** — if the embed call or vector query throws, it logs and keeps the FTS result untouched. This is the prod-safe graceful-degradation path.
3. Pinned fetch + 1-hop graph walk + composite scoring + budget packing — all unchanged from the FTS-only design (doc 00 §"What this is NOT" / the Phase 4 `prepareContext` algorithm).

**Reciprocal Rank Fusion** (`rrfFuse`, Cormack et al.) fuses N ranked id-lists in **rank space**: `score(id) = Σ weight / (k + rank + 1)`, `k = 60` (the literature default). Because only positions matter, FTS `ts_rank` and vector cosine distance **never need to be normalised against each other** — different score scales, same fusion. `fuseHybrid()` reshapes the fused list to look exactly like the FTS hit list (FTS rows keep their `ts_headline` snippet; vector-only rows fold in with an empty snippet and `rank` replaced by the fused RRF score), so nothing downstream in `prepareContext` had to change.

### FTS-only vs hybrid — behaviour at a glance

| | No embedding key | Embedding key set + corpus embedded |
|---|---|---|
| keyword/exact-term query | FTS only | FTS + vector, RRF-fused |
| semantic/paraphrase query | weak (misses non-matching terms) | strong (vector recalls meaning) |
| query with `embedding IS NULL` rows | included via FTS | included via FTS; vector only sees embedded rows |
| embed call fails at runtime | n/a | silently falls back to FTS for that request |

A row that isn't embedded yet is **invisible to the vector leg but still found by FTS** — which is why the brain stays fully searchable mid-backfill.

---

## 5. Backfill — `backfillEmbeddings()` + cron + driver

`backfillEmbeddings({ userId?, limit? })`:

- No-op returning `{ skipped: 'embeddings_disabled' }` when no provider is set.
- Selects rows where `embedding IS NULL OR embedding_model IS DISTINCT FROM <active model>` (so it covers both never-embedded rows **and** rows from a stale provider after a switch).
- Embeds `title + summary + body` as a **`'document'`** (asymmetric pairing with the `'query'` embedding at search time), writes the vector + the active model stamp.
- **Idempotent + incremental:** returns `{ embedded, remaining }` so the caller can **loop until `remaining === 0`**.

`updateMemory()` drops the vector (`embedding = null, embedding_model = null`) whenever `title`, `summary`, or `bodyMd` change, so an edited memory gets re-embedded on the next backfill pass automatically.

**Cron endpoint** `GET /api/cron/embed-backfill?limit=N` — Bearer `CRON_SECRET` (in dev, unauth is allowed when `CRON_SECRET` is unset). Returns `{ model, embedded, remaining, startedAt, finishedAt }`, or `{ error: 'embeddings_disabled' }` (status 200) when no key. `maxDuration = 300`.

**Loop driver** `apps/web/scripts/backfill-embeddings.mjs` (a.k.a. `npm run backfill:embeddings`) hits that endpoint in a batched loop until `remaining` hits 0, with delay/backoff and a `--dry-run` (one batch, limit=1). It exits non-zero **only** on auth/config errors (bad secret, disabled embeddings) — a clean drain exits 0.

> **Note:** the backfill is **not** on the Vercel cron schedule (`vercel.json` lists keep-warm, snapshot, archetype, cortex, briefer, compaction — not embed-backfill). It's a one-shot/on-demand drain you run with the driver script during GO-LIVE and after any large import or provider switch. Add it to `vercel.json` only if you want continuous reconciliation.

---

## 6. GO-LIVE runbook — ORDER MATTERS

Do these in sequence. The point of the ordering is that **the index column and the key must both exist before anything tries to embed**, and the corpus must be drained before you trust hybrid results in the eval.

1. **Set the key** — `VOYAGE_API_KEY` (preferred) **or** `OPENAI_API_KEY` in the deployment environment. Only one. This is the switch that flips `embeddingsEnabled()` to true.
2. **Apply the migration** — `npm run db:migrate --workspace=apps/web` (prod path; `db:push` in dev). Adds the column + HNSW index. Builds instantly because all embeddings are NULL.
3. **Deploy** — ship the code that reads the key and contains the fusion path. Until the corpus is embedded, queries simply fuse FTS with an empty vector leg = FTS results (safe).
4. **Drain the backfill** — loop the cron until done:
   ```bash
   CRON_SECRET=... AEON_BASE_URL=https://<deploy> npm run backfill:embeddings
   # repeat / let it loop until: { embedded: N, remaining: 0 }
   ```
   For a large corpus, run it in batches (`--limit 200`) and watch `remaining` fall to 0.
5. **Verify hybrid is live** — run the eval harness (doc 24) before and after; recall@k / MRR should rise once `remaining = 0`. Spot-check a paraphrase query (`/api/v1/memories/context?query=mobile+strategy`) and confirm the Capacitor-pivot memory ranks even though the words don't match.

**Rollback** is trivial: unset the key. `embeddingsEnabled()` goes false, the fusion branch is skipped, retrieval reverts to pure FTS. The vector column and index just sit there harmlessly until you set a key again.

---

## Pitfalls

- **Don't switch providers casually.** Voyage and OpenAI vectors are not comparable. A switch silently invalidates the whole index — you must re-drain the backfill (it detects the model mismatch and re-embeds, but until it finishes, the vector leg only sees the subset matching the new model).
- **The vector leg only sees embedded rows.** If you query right after a big import and before backfill, semantic recall is partial. FTS covers the gap, but the eval will look weak until `remaining = 0`.
- **`ef_search = 100` is per-transaction.** It's set with `SET LOCAL` precisely so it can't leak across Neon's pooled connections. Don't "optimise" it to a session-level `SET`.
- **HNSW recall is approximate.** If you ever need exact-recall debugging, that's a deliberate trade — the index gives speed for ~99% recall, which is right for a personal brain.
