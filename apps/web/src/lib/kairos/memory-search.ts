import { exactFilterConditions, searchMemoriesFts } from '@/lib/data/memories-search'
import type { SearchMemoriesInput } from '@/lib/data/validators'
import { MACHINE_STREAMS, REAL_MEMORY_STREAMS, searchCore, type CoreRow } from './search-core'
import { assessConfidence, type RetrievalConfidence } from './retrieval-confidence'

// ─────────────────────────────────────────────────────────────────────────
// search_memories (MCP tool + REST GET /api/v1/memories/search) over the
// shared retrieval core. Response shape is the legacy FTS shape with fields
// ADDED, never removed: hits keep the slim columns + rank + snippet, and gain
// streamClass, dominionId and score; the envelope gains `retrieval`.
//
//   - query given  → hybrid core (FTS+vector RRF, standing, rerank), exact
//                    filters applied to both legs, Dominion = FK or tag.
//   - no query     → Dominion browse (recency order, exact filters) — the
//                    legacy FTS path, machine rows hidden the same way.
//
// Real memory by default: machine/synthesis streams are hidden unless the
// caller sets includeMachine, or asks for an exact `type` / `source` (an
// explicit "show me the snapshots" must keep working).
// ─────────────────────────────────────────────────────────────────────────

const SEARCH_RERANK_POOL_MAX = 40
const SEARCH_RERANK_CHARS = 4000
const EXCERPT_CHARS = 200

// confidence/lowConfidence: see retrieval-confidence.ts. Hits are never
// dropped on low confidence (the eval showed no clean floor); null/false off
// the reranked path.
export interface SearchRetrieval extends RetrievalConfidence {
  mode: 'hybrid' | 'fts' | 'browse' | 'none'
  reranked: boolean
}

const NO_SIGNAL = assessConfidence(null)

function liftsStreamDefault(input: SearchMemoriesInput): boolean {
  return Boolean(input.includeMachine || input.type || input.source)
}

// Vector-only hits have no ts_headline; give them a plain excerpt instead.
function excerpt(row: CoreRow): string {
  const text = (row.summary || row.bodyMd || '').replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text
}

function toHit(row: CoreRow, score: number) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    type: row.type,
    source: row.source,
    sourceMetadata: row.sourceMetadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    realmId: row.realmId ?? null,
    projectId: row.projectId ?? null,
    taskId: row.taskId ?? null,
    tags: row.tags,
    pinned: row.pinned,
    confidence: row.confidence,
    standing: row.standing ?? null,
    streamClass: row.streamClass,
    dominionId: row.dominionId ?? null,
    // `rank` kept for legacy clients: now the core's final score (higher = better).
    rank: score,
    score,
    snippet: row.snippet || excerpt(row),
  }
}

export type SearchHit = ReturnType<typeof toHit>

export async function searchMemoriesHybrid(userId: string, input: SearchMemoriesInput) {
  const lifted = liftsStreamDefault(input)

  if (!input.query) {
    const browse = await searchMemoriesFts(userId, input, lifted ? {} : { excludeStreams: MACHINE_STREAMS })
    return {
      hits: browse.hits.map((h) => ({ ...h, score: Number(h.rank) || 0 })),
      total: browse.total,
      retrieval: { mode: 'browse', reranked: false, ...NO_SIGNAL } as SearchRetrieval,
    }
  }

  // Hybrid search pages only within the first HYBRID_MAX_WINDOW results: the
  // vector leg always fills its over-fetch, so the candidate count can't say
  // when to stop. total is capped there and hasMore says whether to page on.
  const window = Math.min(input.limit + input.offset, HYBRID_MAX_WINDOW)
  if (input.offset >= HYBRID_MAX_WINDOW) {
    return { hits: [], total: HYBRID_MAX_WINDOW, hasMore: false, retrieval: { mode: 'hybrid', reranked: false, ...NO_SIGNAL } as SearchRetrieval }
  }
  const core = await searchCore(userId, {
    query: input.query,
    limit: window,
    dominionId: input.dominionId ?? null,
    streams: lifted ? null : REAL_MEMORY_STREAMS,
    filters: exactFilterConditions(input),
    rerankPoolMax: SEARCH_RERANK_POOL_MAX,
    rerankChars: SEARCH_RERANK_CHARS,
    snippets: true,
    minQueryChars: 2,
  })

  const total = Math.min(core.candidates, HYBRID_MAX_WINDOW)
  return {
    hits: core.hits.slice(input.offset).map((h) => toHit(h.row, h.score)),
    total,
    hasMore: window < total,
    retrieval: { mode: core.mode, reranked: core.reranked, ...assessConfidence(core.topRelevance) } as SearchRetrieval,
  }
}

const HYBRID_MAX_WINDOW = 100
