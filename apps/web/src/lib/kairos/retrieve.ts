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

async function fetchSubstrate(
  userId: string,
  dominionId: string,
  query: string,
): Promise<RetrievedMemory[]> {
  if (query.length < MIN_QUERY_CHARS) return []

  const tsQuery = sql`websearch_to_tsquery('english', ${query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  const sinceTs = sql`NOW() - make_interval(days => ${SUBSTRATE_WINDOW_DAYS})`

  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      streamClass: memories.streamClass,
      createdAt: memories.createdAt,
      rank,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
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
    .limit(SUBSTRATE_TOP_K)

  return rows.map(rowToMemory)
}

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
