import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'

// Cold-read trace rows (KAIROS_COLD_READ): type 'observation', streamClass
// 'trace' (kept out of retrieval, synthesis pools and the engine),
// sourceMetadata { kind:'cold_read', externalKey:'cold_read:<chatJobId>',
// coldRead:{…} }. Never belief evidence. Pure DB access, user-scoped.

export const COLD_READ_OBSERVATION_KIND = 'cold_read'

const coldReadWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'observation'),
  eq(memories.streamClass, 'trace'),
  isNull(memories.archivedAt),
  sql`${memories.sourceMetadata}->>'kind' = ${COLD_READ_OBSERVATION_KIND}`,
)

export interface ColdReadValues {
  externalKey: string
  title: string
  bodyMd: string
  summary: string
  coldRead: Record<string, unknown>
}

export interface ColdReadRow {
  id: string
  externalKey: string
  coldRead: Record<string, unknown>
  createdAt: Date
}

export async function findColdRead(userId: string, externalKey: string): Promise<ColdReadRow | null> {
  const [row] = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt })
    .from(memories)
    .where(and(coldReadWhere(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${externalKey}`))
    .limit(1)
  return row ? toRow(row) : null
}

// Idempotent per externalKey (advisory lock + existence check in one
// transaction): a re-submitted job returns the first row.
export async function insertColdRead(
  userId: string,
  values: ColdReadValues,
): Promise<{ memoryId: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(coldReadWhere(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${values.externalKey}`))
      .limit(1)
    if (existing) return { memoryId: existing.id, written: false }
    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary.slice(0, 240),
        type: 'observation',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: ['cold_read'],
        sourceMetadata: { kind: COLD_READ_OBSERVATION_KIND, externalKey: values.externalKey, coldRead: values.coldRead },
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('cold read insert returned no row')
    return { memoryId: inserted.id, written: true }
  })
}

// Newest first, for the Health summary (summariseColdReads).
export async function listColdReads(userId: string, opts: { since?: Date; limit?: number } = {}): Promise<ColdReadRow[]> {
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt })
    .from(memories)
    .where(and(coldReadWhere(userId), ...(opts.since ? [gte(memories.createdAt, opts.since)] : [])))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))
  return rows.map(toRow)
}

function toRow(r: { id: string; sourceMetadata: unknown; createdAt: Date }): ColdReadRow {
  const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>
  const coldRead = meta.coldRead && typeof meta.coldRead === 'object' ? (meta.coldRead as Record<string, unknown>) : {}
  return { id: r.id, externalKey: typeof meta.externalKey === 'string' ? meta.externalKey : '', coldRead, createdAt: r.createdAt }
}
