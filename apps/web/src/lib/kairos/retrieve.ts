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
//   substrate   : top-5 FTS hits over reflection/idea/agentic streams,
//                 last 90d. Empty when no query is provided or the query
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
import { dominionTag } from './dominionTags'
import { embeddingsEnabled, embedOne, toVectorLiteral } from './embeddings'
import { rrfFuse, RRF_K } from './rrf'
import { confidenceBoost } from './confidence'
import { isStreamClass, type StreamClass } from './streamClass'
import type {
  RetrievalResult,
  RetrievedMemory,
  RetrievalBundle,
} from './recipes/_recipe'

const SUBSTRATE_TOP_K = 5
const SUBSTRATE_WINDOW_DAYS = 90
const SUBSTRATE_STREAMS = ['reflection', 'idea', 'agentic'] as const
const TRACES_LIMIT = 10
const ARCHETYPES_LIMIT = 10
const DEFAULT_MEMORY_LIMIT = 25

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

async function fetchArchetypes(userId: string, dominionId: string): Promise<RetrievedMemory[]> {
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
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(ARCHETYPES_LIMIT)

  return rows.map(rowToMemory)
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
}

async function fetchSubstrate(
  userId: string,
  dominionId: string,
  query: string,
): Promise<RetrievedMemory[]> {
  if (query.length < MIN_QUERY_CHARS) return []

  const hybrid = embeddingsEnabled()
  // Over-fetch on both legs when hybrid so RRF has enough overlap to work with;
  // FTS-only still slices to TOP_K at the query level (preserves prod/test behaviour).
  const ftsLimit = hybrid ? SUBSTRATE_TOP_K * 3 : SUBSTRATE_TOP_K

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
      rank,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      inDominionScope(dominionId),
      inArray(memories.streamClass, [...SUBSTRATE_STREAMS]),
      isNull(memories.archivedAt),
      sql`"memories"."fts" @@ ${tsQuery}`,
      sql`${memories.createdAt} >= ${sinceTs}`,
    ))
    // Reflections outweigh other classes for the top-k slots.
    .orderBy(
      sql`(CASE WHEN ${memories.streamClass} = 'reflection' THEN 1 ELSE 0 END) DESC`,
      desc(rank),
      desc(memories.createdAt),
    )
    .limit(ftsLimit)

  // ── FTS-only: embeddings disabled (no key in tests / no-key prod). Behaves
  //    exactly as the original implementation. ───────────────────────────────
  if (!hybrid) return ftsRows.map(rowToMemory)

  // ── Hybrid: fuse a semantic vector leg via RRF. Best-effort — on any error
  //    (embed call, vector query) we keep the FTS rows untouched. ────────────
  try {
    const qVec = await embedOne(query, 'query')
    if (!qVec) return ftsRows.slice(0, SUBSTRATE_TOP_K).map(rowToMemory)

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
        })
        .from(memories)
        .where(and(
          eq(memories.userId, userId),
          inDominionScope(dominionId),
          inArray(memories.streamClass, [...SUBSTRATE_STREAMS]),
          isNull(memories.archivedAt),
          sql`${memories.embedding} IS NOT NULL`,
          sql`${memories.createdAt} >= ${sinceTs}`,
        ))
        .orderBy(distance)
        .limit(SUBSTRATE_TOP_K * 3)
    })

    // id -> row so the fused list can be rebuilt from whichever leg produced it.
    const byId = new Map<string, SubstrateRow>()
    for (const r of ftsRows) byId.set(r.id, r)
    for (const r of vecRows) if (!byId.has(r.id)) byId.set(r.id, r)

    const fused = rrfFuse([
      { ids: ftsRows.map((r) => r.id), weight: 1 },
      { ids: vecRows.map((r) => r.id), weight: 1 },
    ])

    // Reflections-first boost AFTER fusion: a reflection should still outrank a
    // non-reflection at a comparable fused score, mirroring the FTS-only order.
    const ranked = [...fused.entries()]
      .map(([id, score]) => {
        const rowItem = byId.get(id)
        const isReflection = rowItem?.streamClass === 'reflection'
        // Confidence decay weights the fused score before the reflection nudge;
        // neutral (×1) when the prior is absent, so behaviour is unchanged for
        // rows predating the confidence column.
        const weighted = score * confidenceBoost({ confidence: rowItem?.confidence ?? null, updatedAt: rowItem?.updatedAt, pinned: rowItem?.pinned })
        return { id, isReflection, score: weighted + (isReflection ? REFLECTION_BONUS : 0) }
      })
      .sort((a, b) =>
        a.isReflection !== b.isReflection
          ? Number(b.isReflection) - Number(a.isReflection)
          : b.score - a.score,
      )

    return ranked
      .slice(0, SUBSTRATE_TOP_K)
      .map((e) => byId.get(e.id))
      .filter((r): r is SubstrateRow => r != null)
      .map(rowToMemory)
  } catch (err) {
    console.warn(
      '[fetchSubstrate] semantic search failed, FTS-only:',
      err instanceof Error ? err.message : err,
    )
    return ftsRows.slice(0, SUBSTRATE_TOP_K).map(rowToMemory)
  }
}

// Small post-fusion nudge keeping reflections ahead of ties in the same band.
const REFLECTION_BONUS = 1 / (RRF_K + 1)

async function fetchTraces(userId: string, dominionId: string): Promise<RetrievedMemory[]> {
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
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'trace'),
      isNull(memories.archivedAt),
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
