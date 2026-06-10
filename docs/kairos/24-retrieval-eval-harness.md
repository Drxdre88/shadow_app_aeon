# Retrieval Eval Harness

**Status:** shipped 2026-06-06
**Scope:** `apps/web/scripts/eval-retrieval.mjs` (the runner), `apps/web/src/lib/kairos/eval-metrics.ts` (the scoring functions, unit-tested), `apps/web/eval/retrieval-fixtures.json` (the labelled query set).
**Why it exists:** to give the semantic-hybrid work (doc 22) a number. "Does hybrid retrieve better than FTS?" is unanswerable by eyeballing — this harness scores the live `/context` endpoint against a labelled fixture set so you can run it before and after GO-LIVE and **see** the lift.

The harness measures **whatever the server does**. It doesn't know or care whether the server is FTS-only or hybrid — it just calls `GET /api/v1/memories/context` and scores the returned `sources[]`. Run it once for the keyword baseline, flip on embeddings + drain the backfill, run it again, compare.

---

## The metrics

All defined as pure functions in `eval-metrics.ts` (and duplicated inline in the `.mjs` runner so the harness is self-contained — the canonical source is the `.ts` for the unit tests). Each takes an **ordered** `retrievedIds` (rank 0 = best) and a set of ground-truth `relevantIds`.

| Metric | Question it answers | Formula |
|---|---|---|
| **recall@k** | Of the docs that *should* be found, how many made the top-k? | `|relevant ∩ top-k| / |relevant|` |
| **precision@k** | Of the top-k I returned, how many were actually relevant? | `|relevant ∩ top-k| / k` |
| **MRR** (Mean Reciprocal Rank) | How high up is the *first* good hit, averaged over queries? | `mean(1 / rank_of_first_relevant)` |
| **hit-rate** | What fraction of queries got *at least one* relevant doc in top-k? | `queries_with_a_hit / queries` |

**What "good" looks like:**
- **recall@k** — the headline number for "did we surface the right memories." Higher = fewer misses. This is where hybrid should beat FTS on paraphrase queries.
- **MRR** — rewards putting the best answer *first*. `MRR = 1.0` means the first relevant doc was always at rank 1; `0.5` means on average it was at rank 2. Sensitive to ordering in a way recall isn't.
- **precision@k** — guards against "retrieve everything." Less critical for a context-packing use case (we *want* recall), but a precision collapse signals noise.
- **hit-rate** — the coarsest "did it work at all" check. Should be near 1.0 for a healthy corpus.

Edge cases the functions encode: empty `relevantIds` → recall returns `0` in `.ts` / `null` in the runner (can't score, so the runner **skips** rather than counting it a zero); `reciprocalRank` returns `0` when no relevant doc appears.

---

## Labelling fixtures

`eval/retrieval-fixtures.json` is an array of `{ query, relevantIds, note }`. A fixture with an empty `relevantIds` is **unscored** — the harness warns and skips it. The labelling workflow (also documented in the file's `_README`):

1. **Baseline pass.** Run the harness with `relevantIds: []` to see what the server currently returns for each query (the warnings list the queries; use `--json` or hit the endpoint directly to read the actual `sources[]`).
2. **Hand-label.** For each query, call the endpoint and copy the genuinely-relevant UUIDs into `relevantIds`:
   ```
   GET /api/v1/memories/context?query=<url-encoded>&budgetTokens=4000&maxSources=10&hops=1
   → response.sources[].id
   ```
   Pick the ids a human agrees *should* surface for that query — that's your ground truth.
3. **Score.** Re-run; now-labelled fixtures produce real metrics.
4. **Compare.** After embeddings go live and the backfill drains (doc 22 §6), re-run and diff the aggregate against the FTS baseline.

The five shipped fixtures cover known high-signal topics (mobile strategy / Capacitor pivot, Kairos retrieval architecture, MCP OAuth discovery, session-capture setup, Aeon board workflow) — all with empty `relevantIds`, ready to label against your own brain. **Label against the corpus you're actually evaluating**; UUIDs are user/corpus-specific, so the fixtures ship unlabelled by design.

---

## Running it

```bash
# from apps/web/
AEON_API_KEY=sk-... npm run eval:retrieval

# tune cutoff / budget / candidate pool
AEON_API_KEY=sk-... node scripts/eval-retrieval.mjs --k 5 --budget 2000 --maxSources 10

# machine-readable, for diffing baseline vs hybrid
AEON_API_KEY=sk-... node scripts/eval-retrieval.mjs --json > baseline.json
```

| Flag / env | Default | Meaning |
|---|---|---|
| `AEON_API_KEY` (env, required) | — | Bearer key for the `/context` call |
| `AEON_BASE_URL` (env) | `http://localhost:3000` | which server to evaluate (point at prod to score the real corpus) |
| `--k` | `10` | top-k cutoff for recall/precision/hit |
| `--budget` | `4000` | `budgetTokens` passed to `/context` |
| `--maxSources` | `15` | candidate pool size requested |
| `--json` | off | emit `{ config, results, aggregate }` instead of the table |

Human output is a per-query table (Recall / Prec / RR / Hit) plus an **AGGREGATE** row and a one-line `Scored X/Y queries · MRR · Hit-rate` summary. Unscored fixtures show `[SKIP — no relevantIds]`; failed requests show `[ERROR …]` and don't poison the aggregate.

---

## The intended A/B

The harness only earns its keep when you run it as a paired comparison:

1. **FTS baseline** — no embedding key set. `npm run eval:retrieval --json > baseline.json`.
2. Do the GO-LIVE runbook (doc 22 §6): set key → migrate → deploy → drain backfill to `remaining = 0`.
3. **Hybrid** — same fixtures, same flags. `npm run eval:retrieval --json > hybrid.json`.
4. Diff the `aggregate` blocks. Expect **recall@k and MRR up**, especially on paraphrase fixtures (mobile-strategy, retrieval-architecture). If they *don't* move, either the backfill hasn't fully drained or the fixtures' relevant docs were already easy FTS hits — add harder paraphrase fixtures.

---

## Pitfalls

- **Empty `relevantIds` ≠ a zero score — it's a skip.** Don't read "0% recall" into an unlabelled fixture; the runner prints `[SKIP]` and excludes it from the aggregate denominator (`scored/queries`).
- **Labels are corpus-specific.** Don't commit your own brain's UUIDs as "the" fixtures for someone else's corpus. The repo ships them unlabelled on purpose.
- **The harness scores `sources[]`, not the rendered body.** A memory dropped from the packed markdown for budget reasons is **still cited in `sources`**, so it counts as retrieved — which is the right call for a retrieval (not packing) eval.
- **Run baseline before you set the key.** Once embeddings are on and backfilled, you can't reconstruct the FTS-only number without unsetting the key. Capture the baseline JSON first.
