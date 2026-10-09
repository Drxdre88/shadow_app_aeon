// ─────────────────────────────────────────────────────────────────────────
// One retrieval core (Wave 1 "one search", 09/10). Every memory search runs
// this pipeline: chat substrate (retrieve.ts), MCP/REST search_memories
// (memory-search.ts) and prepare_context (lib/data/memories-context.ts).
//
//   FTS leg + vector leg (same filters) → RRF fuse → relevance × standing
//   (lib/kairos/ranking.ts) → Voyage rerank-2.5 over a bounded pool, blended
//   with the same standing factor → top-k.
//
// Default scope is REAL memory: machine rows (traces, snapshots, deltas,
// archetypes, cortex, aether, advisories) are excluded unless the caller opts
// in. Liveness: not archived, not superseded, valid now. Embeddings or rerank
// unavailable → graceful FTS / fused order; the vector leg never fails a read.
// ─────────────────────────────────────────────────────────────────────────

import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { validAsOfNow } from '@/lib/data/memories'
import { dominionTag } from './dominionTags'
import { embeddingsEnabled, embedOne, toVectorLiteral } from './embeddings'
import { rrfFuse } from './rrf'
import { scoreRows, type Ranked } from './ranking'
import { rerankScored } from './rerank'
import type { StreamClass } from './streamClass'

// Operator signal + agent work: what an agent means by "a memory".
export const REAL_MEMORY_STREAMS = [
  'reflection', 'idea', 'agentic', 'concept', 'belief', 'constitution', 'execution',
] as const satisfies readonly StreamClass[]

// Machine / synthesis rows hidden by default (opt in with includeMachine).
export const MACHINE_STREAMS = [
  'trace', 'snapshot', 'delta', 'archetype', 'cortex', 'aether', 'advisory',
] as const satisfies readonly StreamClass[]

const DEFAULT_RERANK_POOL = 12
const DEFAULT_MIN_QUERY_CHARS = 3

// A memory belongs to a Dominion either by its dominionId FK (its home) OR by a
// soft `dominion:<id>` reference tag. The FK leg uses memories_dominion_idx;
// the tag leg uses the memories_tags_idx GIN index.
export function inDominionScope(dominionId: string) {
  const tagMatch = JSON.stringify([dominionTag(dominionId)])
  return sql`(${memories.dominionId} = ${dominionId} OR ${memories.tags} @> ${tagMatch}::jsonb)`
}

// Liveness shared by every leg that grounds generation: not archived, not
// superseded (Merge folds a repeat away with supersededAt alone), valid now.
export function liveConditions() {
  return [isNull(memories.archivedAt), isNull(memories.supersededAt), validAsOfNow] as const
}

// Created within `days`, except durable classes (concept/belief/constitution
// for the chat substrate) that must not forget themselves.
function inWindow(window: SearchWindow) {
  const since = sql`${memories.createdAt} >= NOW() - make_interval(days => ${window.days})`
  if (window.exempt.length === 0) return since
  const exempt = sql.join(window.exempt.map((s) => sql`${s}`), sql`, `)
  return sql`(${since} OR ${memories.streamClass} IN (${exempt}))`
}

const CORE_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  bodyMd: memories.bodyMd,
  type: memories.type,
  source: memories.source,
  sourceMetadata: memories.sourceMetadata,
  streamClass: memories.streamClass,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
  realmId: memories.realmId,
  projectId: memories.projectId,
  taskId: memories.taskId,
  dominionId: memories.dominionId,
  tags: memories.tags,
  pinned: memories.pinned,
  confidence: memories.confidence,
  standing: memories.standing,
}

export interface CoreRow {
  id: string
  title: string
  summary?: string | null
  bodyMd: string | null
  type?: string
  source?: string
  sourceMetadata?: unknown
  streamClass: string
  createdAt: Date
  updatedAt: Date
  realmId?: string | null
  projectId?: string | null
  taskId?: string | null
  dominionId?: string | null
  tags?: unknown
  pinned: boolean
  confidence: number | null
  standing?: number | null
  rank?: number
  snippet?: string
}

export interface SearchWindow {
  days: number
  exempt: readonly string[]
}

export interface SearchCoreOptions {
  query: string
  limit: number
  // null/undefined → whole brain; otherwise FK OR soft dominion: tag.
  dominionId?: string | null
  // Stream allow-list; null → every stream. Default REAL_MEMORY_STREAMS.
  streams?: readonly string[] | null
  window?: SearchWindow | null
  // Exact filters applied to BOTH legs (type, realm, tags, dates, ...).
  filters?: SQL[]
  // Chat substrate: reflections form a hard tier before score.
  reflectionFirst?: boolean
  // Rerank pool = max(12, limit), capped at this when set (agent surfaces).
  rerankPoolMax?: number
  // Clip each rerank document (cost bound for wide agent pools).
  rerankChars?: number
  snippets?: boolean
  minQueryChars?: number
}

export interface SearchCoreHit {
  row: CoreRow
  // Final rank value (relevance × standing factor); higher is better.
  score: number
  // Pre-standing relevance: rerank relevance, else RRF or ts_rank_cd.
  relevance: number
}

export interface SearchCoreResult {
  hits: SearchCoreHit[]
  mode: 'hybrid' | 'fts' | 'none'
  reranked: boolean
  // Distinct candidates found across both legs (before the top-k slice).
  candidates: number
}

const EMPTY: SearchCoreResult = { hits: [], mode: 'none', reranked: false, candidates: 0 }

const isReflection = (r: { streamClass: string }) => (r.streamClass === 'reflection' ? 1 : 0)

function toHits(ranked: Ranked<CoreRow>[], relevanceOf: (r: CoreRow) => number): SearchCoreHit[] {
  return ranked.map(({ row, score }) => ({ row, score, relevance: relevanceOf(row) }))
}

export async function searchCore(userId: string, opts: SearchCoreOptions): Promise<SearchCoreResult> {
  const query = opts.query.trim()
  if (query.length < (opts.minQueryChars ?? DEFAULT_MIN_QUERY_CHARS)) return EMPTY

  const limit = Math.max(1, opts.limit)
  const legLimit = limit * 3
  const tier = opts.reflectionFirst ? { tier: isReflection } : {}
  const streams = opts.streams === undefined ? REAL_MEMORY_STREAMS : opts.streams

  // Shared WHERE for both legs. The window stays LAST so its exempt params
  // close the parameter list (asserted by retrieve.test.ts).
  const scope: SQL[] = [
    eq(memories.userId, userId),
    opts.dominionId ? inDominionScope(opts.dominionId) : sql`TRUE`,
    ...(streams ? [inArray(memories.streamClass, [...streams])] : []),
    ...liveConditions(),
  ]
  const tail: SQL[] = [...(opts.filters ?? []), ...(opts.window ? [inWindow(opts.window)] : [])]

  const tsQuery = sql`websearch_to_tsquery('english', ${query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  const snippet = sql<string>`ts_headline('english', coalesce(${memories.summary}, ${memories.bodyMd}), ${tsQuery}, 'MaxFragments=2,MaxWords=18,MinWords=5')`

  // No await before this select: callers fire several selects in a known
  // order (retrieve.ts Promise.all), and this one must keep its slot.
  const ftsRows: CoreRow[] = await db
    .select({ ...CORE_COLUMNS, rank, ...(opts.snippets ? { snippet } : {}) })
    .from(memories)
    .where(and(...scope, sql`"memories"."fts" @@ ${tsQuery}`, ...tail))
    .orderBy(
      ...(opts.reflectionFirst
        ? [sql`(CASE WHEN ${memories.streamClass} = 'reflection' THEN 1 ELSE 0 END) DESC`]
        : []),
      desc(rank),
      desc(memories.createdAt),
    )
    .limit(legLimit)

  const ftsRank = (r: CoreRow) => Number(r.rank) || 0
  const ftsOnly = (): SearchCoreResult => ({
    hits: toHits(scoreRows(ftsRows, ftsRank, tier).slice(0, limit), ftsRank),
    mode: 'fts',
    reranked: false,
    candidates: ftsRows.length,
  })

  if (!embeddingsEnabled()) return ftsOnly()

  try {
    const qVec = await embedOne(query, 'query')
    if (!qVec) return ftsOnly()

    const distance = sql`${memories.embedding} <=> ${toVectorLiteral(qVec)}::vector`
    // SET LOCAL inside the txn: HNSW recall bound that auto-reverts on commit.
    const vecRows: CoreRow[] = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
      return tx
        .select(CORE_COLUMNS)
        .from(memories)
        .where(and(...scope, sql`${memories.embedding} IS NOT NULL`, ...tail))
        .orderBy(distance)
        .limit(legLimit)
    })

    const byId = new Map<string, CoreRow>()
    for (const r of ftsRows) byId.set(r.id, r)
    for (const r of vecRows) if (!byId.has(r.id)) byId.set(r.id, r)

    const fused = rrfFuse([
      { ids: ftsRows.map((r) => r.id), weight: 1 },
      { ids: vecRows.map((r) => r.id), weight: 1 },
    ])
    const fusedRows = [...fused.keys()].map((id) => byId.get(id)).filter((r): r is CoreRow => r != null)
    const fusedRel = (r: CoreRow) => fused.get(r.id) ?? 0
    const ranked = scoreRows(fusedRows, fusedRel, tier)

    // Standing already decided WHICH rows reach the pool; the cross-encoder
    // then sharpens relevance, blended with the same standing factor.
    const poolSize = Math.max(
      DEFAULT_RERANK_POOL,
      opts.rerankPoolMax ? Math.min(limit, opts.rerankPoolMax) : limit,
    )
    const pool = ranked.slice(0, poolSize).map((r) => r.row)
    const clip = opts.rerankChars
    const reranked = await rerankScored(query, pool, (r) => {
      const text = `${r.title}\n${r.bodyMd ?? ''}`
      return clip ? text.slice(0, clip) : text
    })

    if (!reranked) {
      return { hits: toHits(ranked.slice(0, limit), fusedRel), mode: 'hybrid', reranked: false, candidates: byId.size }
    }

    const relevance = new Map(reranked.map((s) => [s.item, s.relevance]))
    const rerankRel = (r: CoreRow) => relevance.get(r) ?? 0
    const top = toHits(scoreRows(reranked.map((s) => s.item), rerankRel, { tieBreak: isReflection }), rerankRel)
    // Rows past the rerank pool keep their fused order after the reranked head.
    const rest = toHits(ranked.slice(pool.length), fusedRel)
    return { hits: [...top, ...rest].slice(0, limit), mode: 'hybrid', reranked: true, candidates: byId.size }
  } catch (err) {
    console.warn('[search-core] semantic search failed, FTS-only:', err instanceof Error ? err.message : err)
    return ftsOnly()
  }
}
