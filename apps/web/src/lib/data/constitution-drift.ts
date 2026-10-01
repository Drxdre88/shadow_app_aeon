import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'

// Constitution drift observations (docs/kairos/34 §2): type 'observation',
// streamClass 'trace' (machine bookkeeping, kept out of synthesis pools and
// the engine), sourceMetadata.kind 'drift_baseline' | 'drift_run'. Pure DB
// access, user-scoped; re-exported from lib/data/constitution.

export type DriftObservationKind = 'drift_baseline' | 'drift_run'

export interface DriftObservationRow {
  id: string
  sourceMetadata: Record<string, unknown>
  createdAt: Date
}

const DRIFT_COLUMNS = { id: memories.id, sourceMetadata: memories.sourceMetadata, createdAt: memories.createdAt } as const

const driftWhere = (userId: string, kind: DriftObservationKind) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'observation'),
  eq(memories.streamClass, 'trace'),
  isNull(memories.archivedAt),
  sql`${memories.sourceMetadata}->>'kind' = ${kind}`,
)

function asDrift(r: { id: string; sourceMetadata: unknown; createdAt: Date }): DriftObservationRow {
  return { id: r.id, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>, createdAt: r.createdAt }
}

export async function findDriftObservation(
  userId: string,
  kind: DriftObservationKind,
  externalKey: string,
): Promise<DriftObservationRow | null> {
  const [row] = await db
    .select(DRIFT_COLUMNS)
    .from(memories)
    .where(and(driftWhere(userId, kind), sql`${memories.sourceMetadata}->>'externalKey' = ${externalKey}`))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? asDrift(row) : null
}

export async function findLatestDriftRun(userId: string): Promise<DriftObservationRow | null> {
  const [row] = await db
    .select(DRIFT_COLUMNS)
    .from(memories)
    .where(driftWhere(userId, 'drift_run'))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? asDrift(row) : null
}

export interface DriftObservationValues {
  kind: DriftObservationKind
  externalKey: string
  title: string
  bodyMd: string
  summary: string
  sourceMetadata: Record<string, unknown>
}

// Idempotent per externalKey: a routine answer racing the API fallback (or a
// re-submitted job) returns the first row instead of writing a second.
export async function insertDriftObservation(
  userId: string,
  values: DriftObservationValues,
): Promise<{ memoryId: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(driftWhere(userId, values.kind), sql`${memories.sourceMetadata}->>'externalKey' = ${values.externalKey}`))
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
        tags: ['drift', values.kind],
        sourceMetadata: { ...values.sourceMetadata, kind: values.kind, externalKey: values.externalKey },
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('drift observation insert returned no row')
    return { memoryId: inserted.id, written: true }
  })
}
