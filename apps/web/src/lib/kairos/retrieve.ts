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

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { inspectDominion } from '@/lib/data/dominions'
import { liveConditions, searchCore } from './search-core'
import { isStreamClass, type StreamClass } from './streamClass'
import type {
  RetrievalResult,
  RetrievedMemory,
  RetrievalBundle,
} from './recipes/_recipe'

const SUBSTRATE_TOP_K = 5
const SUBSTRATE_WINDOW_DAYS = 90
// 'concept' (memory engine, docs/kairos/32 §2.4): distilled clusters, up-weighted
// by their higher stream trust / standing rather than a special case here.
// 'belief' / 'constitution' (docs/kairos/34 §1): held beliefs + the operator's
// principles; retired ones carry invalidAt and drop out via validAsOfNow.
const SUBSTRATE_STREAMS = ['reflection', 'idea', 'agentic', 'concept', 'belief', 'constitution'] as const
const TRACES_LIMIT = 10
const ARCHETYPES_LIMIT = 10
const DEFAULT_MEMORY_LIMIT = 25

// Durable classes stay retrievable past the 90-day window that bounds raw
// stream rows: concepts are distillations, held beliefs and the constitution
// are values that must not forget themselves. Retired ones still drop out via
// liveness (superseded / invalid).
const WINDOW_EXEMPT_STREAMS = ['concept', 'belief', 'constitution'] as const

// Substrate ranking, fusion and rerank live in the shared retrieval core
// (./search-core) — the same pipeline MCP/REST search_memories and
// prepare_context run. Re-exported for the archetype / cortex input readers.
export { inDominionScope } from './search-core'

// JARVIS-level global retrieval. Passing dominionId=null collapses the Dominion
// predicate to TRUE so a leg spans the WHOLE brain. The substrate leg scopes
// FK OR soft dominion: tag (inside the core); domEq covers the home-only legs
// (cortex-class rows are never cross-tagged, so an FK match is enough).
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

// Substrate = the shared retrieval core over the chat streams: hybrid FTS +
// vector RRF, relevance x standing (a same-day weak-lexical reflection can
// outrank a 60-day-old strong one), reflections as a hard tier, rerank-2.5
// over a pool of max(12, topK), 90-day window except durable classes.
async function fetchSubstrate(
  userId: string,
  dominionId: string | null,
  query: string,
  topK: number = SUBSTRATE_TOP_K,
): Promise<RetrievedMemory[]> {
  const { hits } = await searchCore(userId, {
    query,
    limit: topK,
    dominionId,
    streams: SUBSTRATE_STREAMS,
    window: { days: SUBSTRATE_WINDOW_DAYS, exempt: WINDOW_EXEMPT_STREAMS },
    reflectionFirst: true,
  })
  return hits.map((h) => rowToMemory(h.row))
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
      ...liveConditions(),
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
