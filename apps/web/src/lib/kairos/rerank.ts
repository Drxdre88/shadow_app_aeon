// ─────────────────────────────────────────────────────────────────────────
// Kairos retrieval — Voyage cross-encoder rerank (precision pass).
//
// Hybrid FTS+vector fusion (RRF) is a strong CANDIDATE generator but a weak
// final ranker: it never reads query and document together. A cross-encoder
// does — it jointly scores the pair — so a rerank over the fused top-N is the
// single highest precision-per-effort win once recall is wide (and slice-1
// global recall made it wide). This runs AFTER fusion + confidence weighting,
// so those signals still decide WHICH rows reach the pool; rerank only sharpens
// the final order by true query↔document relevance.
//
// Same server-managed VOYAGE_API_KEY as embeddings (app-owned index, NOT the
// per-user BYOK chat keys). No key → no-op: callers keep their prior order, so
// an OpenAI-only or no-key deployment behaves exactly as before. Raw fetch (no
// SDK) mirrors embeddings.ts for a self-contained, predictable contract.
//   docs: https://docs.voyageai.com/reference/reranker-api
// ─────────────────────────────────────────────────────────────────────────

const RERANK_MODEL = 'rerank-2.5'

// Per-document clip. Voyage allows ~32k tokens/doc; clip on chars well under
// that so a single huge memory body can't blow the request (mirrors embeddings).
const MAX_DOC_CHARS = 24000

function resolveRerankKey(): string | null {
  // `|| null` (not `??`) so an empty-string env var counts as unset, mirroring
  // the truthy key check in embeddings.ts.
  return process.env.VOYAGE_API_KEY || null
}

export function rerankEnabled(): boolean {
  return resolveRerankKey() !== null
}

interface RerankResponse {
  data: Array<{ index: number; relevance_score: number }>
}

// Reorder `items` by descending query-relevance, best-effort. Returns null when
// rerank is unavailable (no key / empty input / API error) so the caller keeps
// its existing order — rerank is never allowed to DROP the reply, only improve
// it. `toText` renders each item to the string the cross-encoder scores.
export async function rerank<T>(
  query: string,
  items: T[],
  toText: (item: T) => string,
  opts: { topK?: number } = {},
): Promise<T[] | null> {
  const key = resolveRerankKey()
  if (!key || items.length === 0 || query.trim().length === 0) return null

  const documents = items.map((it) => {
    const t = toText(it)
    return t.length > MAX_DOC_CHARS ? t.slice(0, MAX_DOC_CHARS) : t
  })

  try {
    const res = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents,
        ...(opts.topK != null ? { top_k: opts.topK } : {}),
        truncation: true,
      }),
    })
    if (!res.ok) {
      throw new Error(`voyage rerank ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const json = (await res.json()) as RerankResponse
    // Response is sorted by relevance already, but sort defensively — the index
    // maps back into the original `items` array (return_documents omitted).
    return json.data
      .slice()
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((d) => items[d.index])
      .filter((it): it is T => it != null)
  } catch (err) {
    console.warn(
      '[rerank] voyage rerank failed, keeping prior order:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
