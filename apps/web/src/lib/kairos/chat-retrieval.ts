// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C2) — chat retrieval for memory-grounded replies.
//
// Per-turn fetch for the chat surface. Returns three buckets:
//   - cortex     : latest live cortex doc for the Dominion (1 row or null)
//   - archetypes : all live archetypes for the Dominion (≤7, B1 archives priors)
//   - substrate  : top-5 FTS hits over reflection/idea/agentic streams,
//                  Dominion-scoped, last 90d
//
// Each item is returned with id + title + body so the prompt builder can
// inject grounded text and the UI can render citation chips against the
// same id snapshots that were sent to the model.
//
// When the user message yields no substrate hits (e.g. short greeting or
// empty FTS match), substrate is []. Cortex + archetypes still flow.
// ─────────────────────────────────────────────────────────────────────────

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'

const SUBSTRATE_TOP_K = 5
const SUBSTRATE_WINDOW_DAYS = 90
const SUBSTRATE_STREAMS = ['reflection', 'idea', 'agentic'] as const

export interface RetrievedMemory {
  id: string
  title: string
  body: string
  streamClass: string
  createdAt: Date
}

export interface ChatRetrieval {
  cortex: RetrievedMemory | null
  archetypes: RetrievedMemory[]
  substrate: RetrievedMemory[]
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
    streamClass: row.streamClass,
    createdAt: row.createdAt,
  }
}

// FTS query terms shorter than this are treated as empty (avoids
// over-matching on greetings, single articles, etc.). websearch_to_tsquery
// already drops stop words but won't return useful ranks for "hi" / "ok".
const MIN_QUERY_CHARS = 3

export async function retrieveForChat(
  userId: string,
  dominionId: string,
  userQuery: string,
): Promise<ChatRetrieval> {
  const [cortex, archetypes, substrate] = await Promise.all([
    fetchCortex(userId, dominionId),
    fetchArchetypes(userId, dominionId),
    fetchSubstrate(userId, dominionId, userQuery),
  ])

  return { cortex, archetypes, substrate }
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
  // B1 archives prior batches before inserting a new run, so "live" =
  // today's batch. Cap at 10 as a safety bound (synthesis emits 3–7).
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
    .limit(10)

  return rows.map(rowToMemory)
}

async function fetchSubstrate(
  userId: string,
  dominionId: string,
  userQuery: string,
): Promise<RetrievedMemory[]> {
  const query = userQuery.trim()
  if (query.length < MIN_QUERY_CHARS) return []

  // Direct FTS query — searchMemoriesFts in lib/data/memories isn't
  // dominion-aware or stream-aware, so we build the targeted query here.
  // websearch_to_tsquery is forgiving of operators / quotes / typos in the
  // user's chat input, which is the right tradeoff for conversational text.
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  // make_interval keeps the day count as a real parameter bind instead of
  // splicing it via sql.raw — defensive against future-configurable windows.
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
    // Quality gates §5: reflections outweigh other classes in the same window.
    // We boost reflection rows in the order-by so a marginal-rank reflection
    // beats a marginal-rank idea/agentic for the top-k slots.
    .orderBy(
      sql`(CASE WHEN ${memories.streamClass} = 'reflection' THEN 1 ELSE 0 END) DESC`,
      desc(rank),
      desc(memories.createdAt),
    )
    .limit(SUBSTRATE_TOP_K)

  return rows.map(rowToMemory)
}

// Pure citation helpers live in chat-retrieval-citations.ts so unit tests
// can exercise them without booting the DB driver. Re-exported here so
// downstream callers keep a single import surface.
export { extractCitationIds, intersectWithRetrieved } from './chat-retrieval-citations'
