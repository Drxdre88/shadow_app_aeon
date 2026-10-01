import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories } from '@/lib/db/schema'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import type { EngineLink, EngineMemory } from '@/lib/kairos/engine/types'
import { insertMemoryOps, type DbExecutor, type OpLog } from './memory-ops'

// Memory engine data access (docs/kairos/32 §2). Pure DB reads/writes — the
// scoring rules live in lib/kairos/engine. Standing writes never bump updatedAt.

const UPDATE_BATCH = 500

const engineColumns = {
  id: memories.id,
  userId: memories.userId,
  dominionId: memories.dominionId,
  type: memories.type,
  streamClass: memories.streamClass,
  source: memories.source,
  confidence: memories.confidence,
  standing: memories.standing,
  pinned: memories.pinned,
  createdAt: memories.createdAt,
  validAt: memories.validAt,
  updatedAt: memories.updatedAt,
  lastUsedAt: memories.lastUsedAt,
  useCount: memories.useCount,
  supersededAt: memories.supersededAt,
  invalidAt: memories.invalidAt,
  archivedAt: memories.archivedAt,
  sourceMetadata: memories.sourceMetadata,
  links: memories.links,
  tags: memories.tags,
}

type EngineRow = Omit<EngineMemory, 'sourceMetadata' | 'links' | 'tags'> & {
  sourceMetadata: unknown
  links: unknown
  tags: unknown
}

export function toEngineMemory(row: EngineRow): EngineMemory {
  const meta = row.sourceMetadata
  return {
    ...row,
    useCount: row.useCount ?? 0,
    sourceMetadata: meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
    links: Array.isArray(row.links) ? (row.links as EngineLink[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
  }
}

function notMeta(): SQL {
  return notInArray(memories.streamClass, [...META_STREAM_CLASSES])
}

function live(now: Date): SQL {
  return and(
    isNull(memories.supersededAt),
    isNull(memories.archivedAt),
    or(isNull(memories.invalidAt), gt(memories.invalidAt, now)),
  ) as SQL
}

function retired(now: Date): SQL {
  return or(
    isNotNull(memories.supersededAt),
    isNotNull(memories.archivedAt),
    lte(memories.invalidAt, now),
  ) as SQL
}

export async function listMemoryEngineUserIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))
  return rows.map((r) => r.userId)
}

export async function loadTouchedEngineMemories(
  userId: string,
  since: Date,
  now: Date,
  limit: number,
): Promise<EngineMemory[]> {
  if (limit <= 0) return []
  const rows = await db
    .select(engineColumns)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      notMeta(),
      live(now),
      or(gte(memories.updatedAt, since), gte(memories.createdAt, since), gte(memories.lastUsedAt, since)),
    ))
    .orderBy(desc(memories.updatedAt))
    .limit(limit)
  return rows.map(toEngineMemory)
}

export async function loadStalestEngineMemories(
  userId: string,
  now: Date,
  limit: number,
  excludeIds: readonly string[] = [],
): Promise<EngineMemory[]> {
  if (limit <= 0) return []
  const conditions = [eq(memories.userId, userId), notMeta(), live(now)]
  if (excludeIds.length) conditions.push(notInArray(memories.id, [...excludeIds]))
  const rows = await db
    .select(engineColumns)
    .from(memories)
    .where(and(...conditions))
    .orderBy(sql`${memories.standingAt} ASC NULLS FIRST`, asc(memories.createdAt))
    .limit(limit)
  return rows.map(toEngineMemory)
}

export async function listScoredRetiredMemories(
  userId: string,
  now: Date,
  limit: number,
): Promise<Array<{ id: string; standing: number }>> {
  const rows = await db
    .select({ id: memories.id, standing: memories.standing })
    .from(memories)
    .where(and(eq(memories.userId, userId), notMeta(), retired(now), isNotNull(memories.standing), ne(memories.standing, 0)))
    .limit(limit)
  return rows.map((r) => ({ id: r.id, standing: r.standing ?? 0 }))
}

// Retired rows never scored (standing NULL) get a 0 — no op, like a first
// score. Scored retired rows are zeroed by the caller through updateStandings
// so each one's score op lands in the same transaction.
export async function zeroRetiredStanding(userId: string, now: Date, at: Date): Promise<number> {
  const rows = await db
    .update(memories)
    .set({ standing: 0, standingAt: at })
    .where(and(
      eq(memories.userId, userId),
      notMeta(),
      retired(now),
      isNull(memories.standing),
    ))
    .returning({ id: memories.id })
  return rows.length
}

export async function countOpenChallenges(userId: string, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const loserId = sql<string>`${memories.sourceMetadata}->>'loserId'`
  const rows = await db
    .select({ loserId, n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
      sql`${memories.sourceMetadata}->>'status' = 'pending'`,
      inArray(loserId, [...ids]),
    ))
    .groupBy(loserId)
  for (const r of rows) if (r.loserId) out.set(r.loserId, Number(r.n))
  return out
}

// With `log` (non-empty ops), every batch and the ops insert run in ONE
// transaction: the standings and their score ops land together or not at all.
export async function updateStandings(
  userId: string,
  updates: ReadonlyArray<{ id: string; standing: number }>,
  at: Date,
  log?: OpLog,
): Promise<number> {
  const write = async (tx: DbExecutor) => {
    let written = 0
    for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
      const batch = updates.slice(i, i + UPDATE_BATCH)
      const values = sql.join(batch.map((u) => sql`(${u.id}::uuid, ${u.standing}::real)`), sql`, `)
      const res = await tx.execute(sql`
        UPDATE memories AS m
        SET standing = v.standing, standing_at = ${at.toISOString()}::timestamp
        FROM (VALUES ${values}) AS v(id, standing)
        WHERE m.id = v.id AND m.user_id = ${userId}
      `)
      written += res.rowCount ?? 0
    }
    return written
  }
  if (!log || log.ops.length === 0) return write(db)
  return db.transaction(async (tx) => {
    const written = await write(tx)
    await insertMemoryOps(userId, log.runId, log.ops, tx)
    return written
  })
}
