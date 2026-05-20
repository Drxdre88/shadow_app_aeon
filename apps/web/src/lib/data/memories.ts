import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchMemoriesInput,
  AddLinkInput,
  MemoryLink,
} from './validators'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 1 — pure DB queries for the user-scoped memory substrate.
// Auth (user identity) is established at the action / route layer. Every
// function below takes `userId` as a required filter; we do not return rows
// the user does not own.
//
// The `fts` tsvector column is a Postgres-side STORED generated column not
// modelled in the Drizzle schema. We reference it via raw SQL identifiers.
// Spec: docs/brain/02-mcp-tools.md
// ─────────────────────────────────────────────────────────────────────────

const SLIM_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  type: memories.type,
  source: memories.source,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
  realmId: memories.realmId,
  projectId: memories.projectId,
  taskId: memories.taskId,
  tags: memories.tags,
  pinned: memories.pinned,
} as const

export async function findMemoryById(memoryId: string, userId: string) {
  const [row] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .limit(1)
  return row ?? null
}

type ListOpts = {
  limit?: number
  offset?: number
  type?: string | string[]
  realmId?: string
  projectId?: string
  taskId?: string
  pinnedOnly?: boolean
  includeArchived?: boolean
}

export async function listMemories(userId: string, opts: ListOpts = {}) {
  const conditions = [eq(memories.userId, userId)]
  if (!opts.includeArchived) {
    conditions.push(sql`${memories.archivedAt} IS NULL`)
  }
  if (opts.type) {
    const types = Array.isArray(opts.type) ? opts.type : [opts.type]
    conditions.push(sql`${memories.type} = ANY(${types})`)
  }
  if (opts.realmId)   conditions.push(eq(memories.realmId, opts.realmId))
  if (opts.projectId) conditions.push(eq(memories.projectId, opts.projectId))
  if (opts.taskId)    conditions.push(eq(memories.taskId, opts.taskId))
  if (opts.pinnedOnly) conditions.push(eq(memories.pinned, true))

  return db
    .select(SLIM_COLUMNS)
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.pinned), desc(memories.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
}

export async function searchMemoriesFts(userId: string, input: SearchMemoriesInput) {
  const tsQuery = sql`websearch_to_tsquery('english', ${input.query})`
  const rank = sql<number>`ts_rank_cd("memories"."fts", ${tsQuery})`
  const snippet = sql<string>`ts_headline('english', coalesce(${memories.summary}, ${memories.bodyMd}), ${tsQuery}, 'MaxFragments=2,MaxWords=18,MinWords=5')`

  const conditions = [
    eq(memories.userId, userId),
    sql`"memories"."fts" @@ ${tsQuery}`,
    sql`${memories.archivedAt} IS NULL`,
  ]

  if (input.type) {
    const types = Array.isArray(input.type) ? input.type : [input.type]
    conditions.push(sql`${memories.type} = ANY(${types})`)
  }
  if (input.source) {
    const sources = Array.isArray(input.source) ? input.source : [input.source]
    conditions.push(sql`${memories.source} = ANY(${sources})`)
  }
  if (input.realmId)   conditions.push(eq(memories.realmId, input.realmId))
  if (input.projectId) conditions.push(eq(memories.projectId, input.projectId))
  if (input.taskId)    conditions.push(eq(memories.taskId, input.taskId))
  if (input.pinnedOnly) conditions.push(eq(memories.pinned, true))
  if (input.tagsAny && input.tagsAny.length > 0) {
    conditions.push(sql`${memories.tags} ?| ${input.tagsAny}::text[]`)
  }
  if (input.tagsAll && input.tagsAll.length > 0) {
    conditions.push(sql`${memories.tags} ?& ${input.tagsAll}::text[]`)
  }

  const hits = await db
    .select({
      ...SLIM_COLUMNS,
      rank,
      snippet,
    })
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(rank), desc(memories.pinned), desc(memories.createdAt))
    .limit(input.limit)
    .offset(input.offset)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions))

  return { hits, total }
}

type NeighbourRow = {
  id: string
  title: string
  summary: string | null
  type: string
  source: string
  createdAt: Date
  edgeType: string
  edgeNote: string | null
  direction: 'outgoing' | 'incoming'
  distance: number
}

export async function getNeighbours(
  memoryId: string,
  userId: string,
  opts: { hops?: 1 | 2; includeReverse?: boolean; limit?: number } = {}
) {
  const hops = opts.hops ?? 1
  const includeReverse = opts.includeReverse ?? true
  const limit = opts.limit ?? 20

  // Outgoing walk: recursive CTE following links[].target where target_kind='memory'.
  const outgoingResult = await db.execute(sql`
    WITH RECURSIVE walk AS (
      SELECT
        m.id, m.user_id, m.links,
        0::int AS hop,
        NULL::text AS edge_type,
        NULL::text AS edge_note
      FROM memories m
      WHERE m.id = ${memoryId} AND m.user_id = ${userId}

      UNION ALL

      SELECT
        m2.id, m2.user_id, m2.links,
        w.hop + 1,
        (l->>'type')::text AS edge_type,
        (l->>'note')::text AS edge_note
      FROM walk w
      JOIN memories m1 ON m1.id = w.id
      CROSS JOIN LATERAL jsonb_array_elements(m1.links) AS l
      JOIN memories m2 ON m2.id = (l->>'target')::uuid AND m2.user_id = w.user_id
      WHERE w.hop < ${hops}
        AND (l->>'target_kind') = 'memory'
        AND m2.archived_at IS NULL
    )
    SELECT DISTINCT ON (n.id)
      n.id, n.hop AS distance, n.edge_type, n.edge_note,
      m.title, m.summary, m.type, m.source, m.created_at
    FROM walk n
    JOIN memories m ON m.id = n.id
    WHERE n.hop > 0
    ORDER BY n.id, n.hop
    LIMIT ${limit}
  `)

  const outgoing: NeighbourRow[] = (outgoingResult.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
    type: r.type as string,
    source: r.source as string,
    createdAt: r.created_at as Date,
    edgeType: r.edge_type as string,
    edgeNote: (r.edge_note as string | null) ?? null,
    direction: 'outgoing',
    distance: r.distance as number,
  }))

  let incoming: NeighbourRow[] = []
  if (includeReverse) {
    const incomingResult = await db.execute(sql`
      SELECT
        m.id, m.title, m.summary, m.type, m.source, m.created_at,
        (l->>'type')::text   AS edge_type,
        (l->>'note')::text   AS edge_note,
        1::int               AS distance
      FROM memories m
      CROSS JOIN LATERAL jsonb_array_elements(m.links) AS l
      WHERE m.user_id = ${userId}
        AND (l->>'target')::uuid = ${memoryId}
        AND (l->>'target_kind') = 'memory'
        AND m.archived_at IS NULL
      LIMIT ${limit}
    `)

    incoming = (incomingResult.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      summary: (r.summary as string | null) ?? null,
      type: r.type as string,
      source: r.source as string,
      createdAt: r.created_at as Date,
      edgeType: r.edge_type as string,
      edgeNote: (r.edge_note as string | null) ?? null,
      direction: 'incoming',
      distance: r.distance as number,
    }))
  }

  return [...outgoing, ...incoming]
}

export async function createMemory(userId: string, input: CreateMemoryInput) {
  // Idempotency for Claude-captured sessions: a given sessionId is a stable
  // identity, so re-posting (from a SessionStart backfill, re-invoked hook,
  // or manual recovery) should never duplicate. Other sources stay strict.
  const sessionId =
    input.source === 'claude' &&
    typeof input.sourceMetadata === 'object' &&
    input.sourceMetadata !== null
      ? (input.sourceMetadata as Record<string, unknown>).sessionId
      : undefined
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    const [existing] = await db
      .select()
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.source, 'claude'),
        sql`${memories.sourceMetadata}->>'sessionId' = ${sessionId}`,
      ))
      .limit(1)
    if (existing) return existing
  }

  const [row] = await db
    .insert(memories)
    .values({
      userId,
      title: input.title,
      bodyMd: input.bodyMd,
      summary: input.summary ?? null,
      type: input.type,
      source: input.source,
      sourceMetadata: input.sourceMetadata ?? {},
      realmId: input.realmId ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      tags: input.tags ?? [],
      links: input.links ?? [],
      pinned: input.pinned ?? false,
    })
    .returning()
  return row
}

export async function updateMemory(memoryId: string, userId: string, patch: UpdateMemoryInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined)      update.title = patch.title
  if (patch.bodyMd !== undefined)     update.bodyMd = patch.bodyMd
  if (patch.summary !== undefined)    update.summary = patch.summary
  if (patch.type !== undefined)       update.type = patch.type
  if (patch.realmId !== undefined)    update.realmId = patch.realmId
  if (patch.projectId !== undefined)  update.projectId = patch.projectId
  if (patch.taskId !== undefined)     update.taskId = patch.taskId
  if (patch.tags !== undefined)       update.tags = patch.tags
  if (patch.pinned !== undefined)     update.pinned = patch.pinned
  if (patch.archivedAt !== undefined) update.archivedAt = patch.archivedAt ? new Date(patch.archivedAt) : null

  const [row] = await db
    .update(memories)
    .set(update)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()
  return row ?? null
}

export async function addLink(memoryId: string, userId: string, input: AddLinkInput) {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory) return null

  const existing = (memory.links as MemoryLink[]) ?? []
  const newLink: MemoryLink = {
    type: input.type,
    target: input.target,
    target_kind: input.targetKind,
    ...(input.note ? { note: input.note } : {}),
  }

  // Dedup: same (target, target_kind, type) returns existing edge unchanged.
  const dup = existing.find(
    (l) => l.target === newLink.target && l.target_kind === newLink.target_kind && l.type === newLink.type
  )
  if (dup) return { memory, link: dup, linksCount: existing.length, created: false }

  const next = [...existing, newLink]
  const [updated] = await db
    .update(memories)
    .set({ links: next, updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()

  return { memory: updated, link: newLink, linksCount: next.length, created: true }
}

export async function removeLink(memoryId: string, userId: string, linkIndex: number) {
  const memory = await findMemoryById(memoryId, userId)
  if (!memory) return null
  const existing = (memory.links as MemoryLink[]) ?? []
  if (linkIndex < 0 || linkIndex >= existing.length) return null
  const next = existing.filter((_, i) => i !== linkIndex)
  const [updated] = await db
    .update(memories)
    .set({ links: next, updatedAt: new Date() })
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning()
  return updated ?? null
}

export async function deleteMemory(memoryId: string, userId: string) {
  const [deleted] = await db
    .delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .returning({ id: memories.id })
  return !!deleted
}

export async function countMemories(userId: string) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(eq(memories.userId, userId), sql`${memories.archivedAt} IS NULL`))
  return count
}

// Helper used by the daily-log export and the daily-briefing cron (Phase 5).
export async function findMemoriesCreatedOn(userId: string, dateIso: string) {
  return db
    .select(SLIM_COLUMNS)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.createdAt}::date = ${dateIso}::date`,
      sql`${memories.archivedAt} IS NULL`,
    ))
    .orderBy(desc(memories.createdAt))
}

// Helper used by exporter: stream all of a user's memories sorted by realm, then created_at.
export async function findAllMemoriesForExport(userId: string) {
  return db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(memories.realmId, memories.createdAt)
}

// Used by addLink validation when targetKind === 'memory': verify target memory exists
// and is owned by the same user. Returns true if the target is reachable.
export async function targetMemoryExists(targetId: string, userId: string) {
  const [row] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.id, targetId), eq(memories.userId, userId)))
    .limit(1)
  return !!row
}
