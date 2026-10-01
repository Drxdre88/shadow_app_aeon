// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3A — unified retrieval module.
//
// Single canonical context fetch powering both the briefer (BYOK cron) and
// the chat / lieutenant surfaces (Claude Code). Returns the RetrievalResult
// shape declared in recipes/_recipe.ts:
//
//   bundle      : inspectDominion snapshot (vision / mission / objectives /
//                 projects / recent memories / open board cards) — used by
//                 BRIEF and any recipe that needs Dominion top-of-mind state.
//   cortex      : latest live cortex doc for the Dominion (1 row or null).
//   archetypes  : all live archetypes for the Dominion (≤10, B1 archives
//                 priors so "live" = today's batch).
//   substrate   : top-5 hybrid hits over reflection/idea/agentic/concept/
//                 belief/constitution streams; live (not archived, not
//                 superseded, valid now); last 90d except concept/belief/
//                 constitution. Empty when no query is provided or the query
//                 is too short to FTS reliably.
//   traces      : recent streamClass='trace' memories — meta-cognition
//                 over prior recipe runs (Oracle / Cartographer).
//
// Recipes call this; they do NOT reach into the data layer directly. That
// keeps the dispatcher/recipe contract decoupled from query shape changes.
// ─────────────────────────────────────────────────────────────────────────

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { inspectDominion } from '@/lib/data/dominions'
import { validAsOfNow } from '@/lib/data/memories'
import { dominionTag } from './dominionTags'
import { embeddingsEnabled, embedOne, toVectorLiteral } from './embeddings'
import { rrfFuse } from './rrf'
import { rankRows } from './ranking'
import { rerankScored, type RerankScored } from './rerank'
import { isStreamClass, type StreamClass } from './streamClass'
import type {
  RetrievalResult,
  RetrievedMemory,
  RetrievalBundle,
} from './recipes/_recipe'

const SUBSTRATE_TOP_K = 5
// Candidate pool handed to the cross-encoder rerank before the final TOP_K
// slice. Wider than TOP_K so rerank has room to promote a strong match the RRF
// fusion buried; bounded so the extra Voyage latency/cost stays small.
const RERANK_POOL = 12
const SUBSTRATE_WINDOW_DAYS = 90
// 'concept' (memory engine, docs/kairos/32 §2.4): distilled clusters, up-weighted
// by their higher stream trust / standing rather than a special case here.
// 'belief' / 'constitution' (docs/kairos/34 §1): held beliefs + the operator's
// principles; retired ones carry invalidAt and drop out via validAsOfNow.
const SUBSTRATE_STREAMS = ['reflection', 'idea', 'agentic', 'concept', 'belief', 'constitution'] as const
const TRACES_LIMIT = 10
const ARCHETYPES_LIMIT = 10
const DEFAULT_MEMORY_LIMIT = 25

// Ranking uses the shared ranker (./ranking) — relevance × standingFactor, the
// same formula as prepareContext's composite score. Unscored rows (standing
// NULL) fall back to confidence × the shared 14-day recency curve, so the two
// ranking stacks share one curve. A same-day, weak-lexical-match
// reflection must be able to outrank a 60-day-old, strong-lexical-match one
// (the 15:37→16:50 miss).

// FTS queries shorter than this fall back to substrate=[]. websearch_to_tsquery
// drops stop words but won't rank "hi" / "ok" usefully.
const MIN_QUERY_CHARS = 3

// A memory belongs to a Dominion either by its dominionId FK (its home) OR by a
// soft `dominion:<id>` reference tag. Substrate retrieval unions both so a
// cross-front reflection surfaces from every Dominion it touches. The FK leg
// uses memories_dominion_idx; the tag leg uses the memories_tags_idx GIN index.
function inDominionScope(dominionId: string) {
  const tagMatch = JSON.stringify([dominionTag(dominionId)])
  return sql`(${memories.dominionId} = ${dominionId} OR ${memories.tags} @> ${tagMatch}::jsonb)`
}

// JARVIS-level global retrieval. Passing dominionId=null collapses the Dominion
// predicate to TRUE so a leg spans the WHOLE brain — the operator talks to
// Kairos without pinpointing a Dominion and relevance (+ confidence decay)
// surfaces the right memories wherever they live. domScope covers the substrate
// leg (FK OR soft dominion: tag); domEq covers the home-only legs (cortex-class
// rows are never cross-tagged, so an FK match is enough).
function domScope(dominionId: string | null) {
  return dominionId ? inDominionScope(dominionId) : sql`TRUE`
}
function domEq(dominionId: string | null) {
  return dominionId ? eq(memories.dominionId, dominionId) : sql`TRUE`
}

export interface RetrievalArgs {
  userId: string
  dominionId: string
  query?: string
  memoryLimit?: number
  includeBoardState?: boolean
}

export async function retrieveContext(args: RetrievalArgs): Promise<RetrievalResult> {
  const { userId, dominionId, query, memoryLimit } = args
  const trimmedQuery = query?.trim() ?? ''

  const [bundle, cortex, archetypes, substrate, traces] = await Promise.all([
    fetchBundle(userId, dominionId, memoryLimit ?? DEFAULT_MEMORY_LIMIT),
    fetchCortex(userId, dominionId),
    fetchArchetypes(userId, dominionId),
    fetchSubstrate(userId, dominionId, trimmedQuery),
    fetchTraces(userId, dominionId),
  ])

  return { bundle, cortex, archetypes, substrate, traces }
}

// JARVIS-level entry point. Whole-brain retrieval with NO Dominion scope: the
// Aether self-model stands in for cortex, and substrate / archetypes / traces
// span every Dominion. There is no single-Dominion bundle to fetch, so bundle
// is null. Confidence decay + RRF fusion in fetchSubstrate are unchanged — the
// only difference from retrieveContext is the dropped scope, so a sure, recent
// belief still outranks a stale one no matter which Dominion it belongs to.
export async function retrieveGlobalContext(
  args: { userId: string; query?: string },
): Promise<RetrievalResult> {
  const { userId, query } = args
  const trimmedQuery = query?.trim() ?? ''

  const [cortex, archetypes, substrate, traces] = await Promise.all([
    fetchAetherDoc(userId),
    fetchArchetypes(userId, null),
    fetchSubstrate(userId, null, trimmedQuery),
    fetchTraces(userId, null),
  ])

  return { bundle: null, cortex, archetypes, substrate, traces }
}

// Standalone substrate-only lookup for the chat `search_brain` tool. Whole-
// brain scope (no Dominion), same hybrid + recency + confidence weighted
// pipeline as retrieveGlobalContext's substrate leg — replaces a raw FTS-only
// searchMemoriesFts call so an ad-hoc mid-turn lookup gets the same quality
// bar as the automatic grounding context.
export async function searchSubstrateForChat(
  userId: string,
  query: string,
  limit: number = SUBSTRATE_TOP_K,
): Promise<RetrievedMemory[]> {
  return fetchSubstrate(userId, null, query.trim(), limit)
}

async function fetchBundle(
  userId: string,
  dominionId: string,
  memoryLimit: number,
): Promise<RetrievalBundle | null> {
  return inspectDominion(dominionId, userId, { memoryLimit })
}

async function fetchCortex(userId: string, dominionId: string): Promise<RetrievedMemory | null> {
  const [row] = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)

  return row ? rowToMemory(row) : null
}

async function fetchArchetypes(userId: string, dominionId: string | null): Promise<RetrievedMemory[]> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      domEq(dominionId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(ARCHETYPES_LIMIT)

  return rows.map(rowToMemory)
}

// The global self-model — Kairos's single Aether doc across all Dominions —
// stands in for a per-Dominion cortex when the operator is talking to Kairos
// globally. One live row (the synthesiser archives its prior on each run).
async function fetchAetherDoc(userId: string): Promise<RetrievedMemory | null> {
  const [row] = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'aether'),
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)

  return row ? rowToMemory(row) : null
}

// Row shape shared by the FTS and vector legs so either query can rebuild a
// RetrievedMemory and feed the id->row map during fusion.
type SubstrateRow = {
  id: string
  title: string
  bodyMd: string | null
  streamClass: string
  createdAt: Date
  updatedAt: Date          // reinforcement signal for confidence decay
  confidence: number | null // stored trust prior; absent → neutral (no effect)
  pinned: boolean          // ranking-exempt from decay (mirrors prepareContext)
  standing: number | null  // memory-engine standing; NULL → P0 confidence × recency
}

type FtsSubstrateRow = SubstrateRow & { rank: number }

const isReflectionRow = (r: { streamClass: string }) => (r.streamClass === 'reflection' ? 1 : 0)

// Shared FTS-leg ranking: raw ts_rank_cd is a pure lexical-overlap score with
// no time signal, so weight it by standing (or confidence + recency when
// unscored) the same way the hybrid RRF path does, then keep reflections
// pinned ahead of ties. Used both for the FTS-only branch (no embeddings
// configured) and the hybrid branch's no-embedding-result fallback, so those
// two paths never diverge in ranking.
function rankByRecencyAndConfidence(rows: FtsSubstrateRow[]): FtsSubstrateRow[] {
  return rankRows(rows, (r) => Number(r.rank) || 0, { tier: isReflectionRow })
}

async function fetchSubstrate(
  userId: string,
  dominionId: string | null,
  query: string,
  topK: number = SUBSTRATE_TOP_K,
): Promise<RetrievedMemory[]> {
  if (query.length < MIN_QUERY_CHARS) return []

  const hybrid = embeddingsEnabled()
  // Over-fetch on both legs (hybrid AND FTS-only) so the recency/confidence
  // re-rank below has real candidates to work with — a same-day, weak-overlap
  // row must be IN the pool before it can out-rank a stale, strong-overlap
  // one; SQL fetching only the top-topK by raw rank would exclude it before
  // JS ever sees it.
  const ftsLimit = topK * 3

  const tsQuery = sql`websearch_to_tsquery('english', ${query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  const sinceTs = sql`NOW() - make_interval(days => ${SUBSTRATE_WINDOW_DAYS})`

  const ftsRows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
      confidence: memories.confidence,
      pinned: memories.pinned,
      standing: memories.standing,
      rank,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      domScope(dominionId),
      inArray(memories.streamClass, [...SUBSTRATE_STREAMS]),
      ...substrateLive(),
      sql`"memories"."fts" @@ ${tsQuery}`,
      inSubstrateWindow(sinceTs),
    ))
    // Reflections outweigh other classes for the top-k slots.
    .orderBy(
      sql`(CASE WHEN ${memories.streamClass} = 'reflection' THEN 1 ELSE 0 END) DESC`,
      desc(rank),
      desc(memories.createdAt),
    )
    .limit(ftsLimit)

  // ── FTS-only: embeddings disabled (no key in tests / no-key prod). Still
  //    recency + confidence weighted (previously pure SQL rank order with no
  //    time signal at all). ─────────────────────────────────────────────────
  if (!hybrid) return rankByRecencyAndConfidence(ftsRows).slice(0, topK).map(rowToMemory)

  // ── Hybrid: fuse a semantic vector leg via RRF. Best-effort — on any error
  //    (embed call, vector query) we keep the FTS rows untouched. ────────────
  try {
    const qVec = await embedOne(query, 'query')
    if (!qVec) return rankByRecencyAndConfidence(ftsRows).slice(0, topK).map(rowToMemory)

    const distance = sql`${memories.embedding} <=> ${toVectorLiteral(qVec)}::vector`

    // Flat ORDER BY ... LIMIT inside a txn with SET LOCAL hnsw.ef_search so the
    // HNSW index is used and the GUC auto-reverts on commit (no leak across the
    // pooled Neon connection).
    const vecRows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
      return tx
        .select({
          id: memories.id,
          title: memories.title,
          bodyMd: memories.bodyMd,
          streamClass: memories.streamClass,
          createdAt: memories.createdAt,
          updatedAt: memories.updatedAt,
          confidence: memories.confidence,
          pinned: memories.pinned,
          standing: memories.standing,
        })
        .from(memories)
        .where(and(
          eq(memories.userId, userId),
          domScope(dominionId),
          inArray(memories.streamClass, [...SUBSTRATE_STREAMS]),
          ...substrateLive(),
          sql`${memories.embedding} IS NOT NULL`,
          inSubstrateWindow(sinceTs),
        ))
        .orderBy(distance)
        .limit(topK * 3)
    })

    // id -> row so the fused list can be rebuilt from whichever leg produced it.
    const byId = new Map<string, SubstrateRow>()
    for (const r of ftsRows) byId.set(r.id, r)
    for (const r of vecRows) if (!byId.has(r.id)) byId.set(r.id, r)

    const fused = rrfFuse([
      { ids: ftsRows.map((r) => r.id), weight: 1 },
      { ids: vecRows.map((r) => r.id), weight: 1 },
    ])

    // Reflections-first AFTER fusion: a reflection still outranks a
    // non-reflection at a comparable fused score, mirroring the FTS-only order.
    // Within each tier the fused score is weighted by standingFactor (P0
    // confidence × recency while the row is unscored).
    const fusedRows = [...fused.keys()]
      .map((id) => byId.get(id))
      .filter((r): r is SubstrateRow => r != null)
    const ranked = rankRows(fusedRows, (r) => fused.get(r.id) ?? 0, { tier: isReflectionRow })

    // Rerank pool: take a wider slice of the fused, standing-weighted order
    // (reflections/standing already shaped WHICH rows qualify), then let the
    // cross-encoder's relevance, blended with the same standingFactor, pick the
    // final top-k. Floor at RERANK_POOL so a wider topK (e.g. the search_brain
    // chat tool) still gets a proper rerank pool, not just topK candidates.
    const poolRows = ranked.slice(0, Math.max(RERANK_POOL, topK))

    // Precision pass. Scores the WHOLE pool (no top_k) so every candidate has a
    // relevance score to blend. No-op (null) without a Voyage key or on API
    // error, in which case we keep the confidence/recency-weighted RRF order —
    // identical to the pre-rerank behaviour once sliced to topK.
    const reranked = await rerankScored(
      query,
      poolRows,
      (r) => `${r.title}\n${r.bodyMd ?? ''}`,
    )

    const finalRows = reranked ? blendRerank(reranked) : poolRows
    return finalRows.slice(0, topK).map(rowToMemory)
  } catch (err) {
    console.warn(
      '[fetchSubstrate] semantic search failed, FTS-only:',
      err instanceof Error ? err.message : err,
    )
    // Same recency/confidence weighting as the FTS-only branch — never hand
    // back raw lexical order on the error path.
    return rankByRecencyAndConfidence(ftsRows).slice(0, topK).map(rowToMemory)
  }
}

// Blend the cross-encoder's relevance with the same standingFactor the fused
// pool was built with, so rerank sharpens relevance WITHOUT discarding the
// time/trust signal (the 07-24 recency miss: relevance-only ordering let a
// stale strong match beat today's reflection). Reflections win exact ties;
// remaining ties keep Voyage's relevance order (stable sort).
function blendRerank(scored: RerankScored<SubstrateRow>[]): SubstrateRow[] {
  const relevance = new Map(scored.map((s) => [s.item, s.relevance]))
  return rankRows(scored.map((s) => s.item), (r) => relevance.get(r) ?? 0, { tieBreak: isReflectionRow })
}

// Liveness shared by every leg that grounds generation: not archived, not
// superseded (Merge folds a repeat away with supersededAt alone — no
// invalidAt — so validAsOfNow does not catch it), and valid now.
function substrateLive() {
  return [isNull(memories.archivedAt), isNull(memories.supersededAt), validAsOfNow] as const
}

// Durable classes stay retrievable past the 90-day window that bounds raw
// stream rows: concepts are distillations (120d freshness half-life), held
// beliefs and the constitution are values that must not forget themselves.
// They are still bounded by substrateLive — a retired belief or a replaced
// constitution version is superseded / invalid and drops out there.
const WINDOW_EXEMPT_STREAMS = ['concept', 'belief', 'constitution'] as const

function inSubstrateWindow(sinceTs: ReturnType<typeof sql>) {
  const exempt = sql.join(WINDOW_EXEMPT_STREAMS.map((s) => sql`${s}`), sql`, `)
  return sql`(${memories.createdAt} >= ${sinceTs} OR ${memories.streamClass} IN (${exempt}))`
}

async function fetchTraces(userId: string, dominionId: string | null): Promise<RetrievedMemory[]> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      domEq(dominionId),
      eq(memories.streamClass, 'trace'),
      // Resolved-incident traces (invalidAt stamped via a 'resolves' link) must
      // not keep narrating a closed incident to brief/advisory surfaces.
      ...substrateLive(),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(TRACES_LIMIT)

  return rows.map(rowToMemory)
}

function rowToMemory(row: {
  id: string
  title: string
  bodyMd: string | null
  streamClass: string
  createdAt: Date
}): RetrievedMemory {
  return {
    id: row.id,
    title: row.title,
    body: row.bodyMd ?? '',
    streamClass: narrowStreamClass(row.streamClass),
    createdAt: row.createdAt,
  }
}

// DB column is unconstrained text; writers always use the STREAM_CLASSES
// const, but narrow defensively so a stray value can't crash a recipe.
function narrowStreamClass(value: string): StreamClass {
  return isStreamClass(value) ? value : 'reflection'
}
