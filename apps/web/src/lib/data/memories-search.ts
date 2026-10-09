import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm'
import type { SearchMemoriesInput } from './validators'
import { toVectorLiteral } from '@/lib/kairos/embeddings'
import { SLIM_COLUMNS, validAsOfNow } from './memories-shared'

// Exact-filter FTS search (moved out of memories.ts; re-exported there). The
// browse surface (no query, Dominion scope) and the UI search use it directly;
// the agent search surfaces (MCP search_memories, REST /memories/search) go
// through the hybrid core in lib/kairos/memory-search.ts.

export interface FtsSearchOptions {
  // Stream classes to leave out (agent browse hides machine rows by default).
  excludeStreams?: readonly string[]
}

type ExactFilterInput = Pick<
  SearchMemoriesInput,
  'type' | 'source' | 'realmId' | 'projectId' | 'taskId' | 'sinceDays' | 'pinnedOnly' | 'tagsAny' | 'tagsAll'
>

// Exact filters callers rely on (type/source/anchors/date window/pins/tags),
// applied on top of any retrieval leg — FTS here and both legs of the core.
export function exactFilterConditions(input: Partial<ExactFilterInput>): SQL[] {
  const conditions: SQL[] = []
  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(inArray(memories.type, types))
  }
  if (input.source) {
    const sources = Array.isArray(input.source) ? input.source : [input.source]
    conditions.push(inArray(memories.source, sources))
  }
  if (input.realmId)    conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId)  conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)     conditions.push(eq(memories.taskId, input.taskId))
  if (input.sinceDays !== undefined) {
    conditions.push(sql`${memories.createdAt} >= NOW() - make_interval(days => ${input.sinceDays})`)
  }
  if (input.pinnedOnly) conditions.push(eq(memories.pinned, true))
  if (input.tagsAny && input.tagsAny.length > 0) {
    conditions.push(sql`${memories.tags} ?| ${input.tagsAny}::text[]`)
  }
  if (input.tagsAll && input.tagsAll.length > 0) {
    conditions.push(sql`${memories.tags} ?& ${input.tagsAll}::text[]`)
  }
  return conditions
}

export async function searchMemoriesFts(userId: string, input: SearchMemoriesInput, opts: FtsSearchOptions = {}) {
  // Kairos Phase 3B — `query` is optional when scoped by `dominionId`. When
  // no query is given, drop the FTS match condition and rank/snippet
  // expressions; sort by recency instead. Result row shape stays identical
  // (rank=0, snippet='') so callers don't branch on response shape.
  const hasQuery = Boolean(input.query)
  const tsQuery = hasQuery ? sql`websearch_to_tsquery('english', ${input.query})` : null
  const rank = hasQuery
    ? sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
    : sql<number>`0::float4`
  const snippet = hasQuery
    ? sql<string>`ts_headline('english', coalesce(${memories.summary}, ${memories.bodyMd}), ${tsQuery}, 'MaxFragments=2,MaxWords=18,MinWords=5')`
    : sql<string>`''::text`

  const conditions = [
    eq(memories.userId, userId),
    sql`${memories.archivedAt} IS NULL`,
    isNull(memories.supersededAt),
    validAsOfNow,
  ]
  if (hasQuery) conditions.push(sql`"memories"."fts" @@ ${tsQuery}`)
  conditions.push(...exactFilterConditions(input))
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))
  if (opts.excludeStreams && opts.excludeStreams.length > 0) {
    conditions.push(notInArray(memories.streamClass, [...opts.excludeStreams]))
  }

  const orderBy = hasQuery
    ? [desc(rank), desc(memories.pinned), desc(memories.createdAt)]
    : [desc(memories.pinned), desc(memories.createdAt)]

  const hits = await db
    .select({
      ...SLIM_COLUMNS,
      streamClass: memories.streamClass,
      rank,
      snippet,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(input.limit)
    .offset(input.offset)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions))

  return { hits, total }
}

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 (P2) — semantic vector search. Flat `ORDER BY embedding <=>
// $vec LIMIT n` so the HNSW index is used, inside a transaction with `SET
// LOCAL hnsw.ef_search` so the GUC auto-reverts on commit. Kept as public API;
// the hybrid retrieval core (lib/kairos/search-core.ts) runs its own vector leg.
// ─────────────────────────────────────────────────────────────────────────

type VectorSearchInput = {
  realmId?: string
  projectId?: string
  taskId?: string
  dominionId?: string
  type?: string | string[]
  limit: number
}

export async function vectorSearchMemories(
  userId: string,
  queryVec: number[],
  input: VectorSearchInput,
) {
  const vecLiteral = toVectorLiteral(queryVec)
  const distance = sql`${memories.embedding} <=> ${vecLiteral}::vector`

  const conditions = [
    eq(memories.userId, userId),
    sql`${memories.archivedAt} IS NULL`,
    isNull(memories.supersededAt),
    validAsOfNow,
    sql`${memories.embedding} IS NOT NULL`,
  ]
  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(inArray(memories.type, types))
  }
  if (input.realmId)    conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId)  conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)     conditions.push(eq(memories.taskId, input.taskId))
  if (input.dominionId) conditions.push(eq(memories.dominionId, input.dominionId))

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`)
    return tx
      .select(SLIM_COLUMNS)
      .from(memories)
      .where(and(...conditions))
      .orderBy(distance)
      .limit(input.limit)
  })
}
