import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'

// Weekly mind-comparison observations (docs/kairos/34 §1). Pure DB access;
// re-exported from lib/data/beliefs (the belief ledger's canonical readers).

export const MIND_COMPARE_KIND = 'mind_compare'

export interface MindCompareValues {
  externalKey: string
  title: string
  bodyMd: string
  summary: string
  linkIds: string[]
  sourceMetadata: Record<string, unknown>
}

export async function writeMindCompare(userId: string, values: MindCompareValues): Promise<{ memoryId: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.userId, userId), sql`${memories.sourceMetadata}->>'externalKey' = ${values.externalKey}`))
      .limit(1)
    if (existing) return { memoryId: existing.id, written: false }
    const [row] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary,
        type: 'observation',
        streamClass: 'agentic',
        source: 'cron',
        confidence: confidenceForStreamClass('agentic'),
        links: values.linkIds.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' })),
        tags: ['mind-compare'],
        sourceMetadata: { ...values.sourceMetadata, kind: MIND_COMPARE_KIND, externalKey: values.externalKey },
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!row) throw new Error('mind_compare insert returned no row')
    return { memoryId: row.id, written: true }
  })
}

export interface MindComparisonView {
  id: string
  title: string
  summary: string | null
  weekKey: string | null
  createdAt: Date
  pairs: unknown[]
  alignedOnly: string[]
  ownOnly: string[]
  bodyMd: string
}

// The newest live comparison — one indexed row, never a fetch-then-filter.
export async function getLatestMindCompare(userId: string): Promise<MindComparisonView | null> {
  const [row] = await db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      createdAt: memories.createdAt,
      bodyMd: memories.bodyMd,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->>'kind' = ${MIND_COMPARE_KIND}`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  if (!row) return null
  const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    weekKey: typeof meta.weekKey === 'string' ? meta.weekKey : null,
    createdAt: row.createdAt,
    pairs: Array.isArray(meta.pairs) ? meta.pairs : [],
    alignedOnly: ids(meta.alignedOnly),
    ownOnly: ids(meta.ownOnly),
    bodyMd: row.bodyMd,
  }
}
