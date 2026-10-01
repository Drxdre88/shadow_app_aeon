import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { readBelief } from '@/lib/kairos/beliefs/types'

// Constitution drift observations (docs/kairos/34 §2): type 'observation',
// streamClass 'trace' (machine bookkeeping, kept out of synthesis pools and
// the engine), sourceMetadata.kind 'drift_baseline' | 'drift_run'. A drift_run
// carries up to two independent sections written by separate jobs:
// `drift` (the probe comparison) and `conscience` (the conscience checks).
// Pure DB access, user-scoped; re-exported from lib/data/constitution.

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

export type DriftRunSection = 'drift' | 'conscience'

const hasSection = (section: DriftRunSection) => sql`(${memories.sourceMetadata}->${section}) IS NOT NULL`

async function findLatestRunWith(userId: string, section: DriftRunSection): Promise<DriftObservationRow | null> {
  const [row] = await db
    .select(DRIFT_COLUMNS)
    .from(memories)
    .where(and(driftWhere(userId, 'drift_run'), hasSection(section)))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? asDrift(row) : null
}

// Latest run that measured drift (a conscience-only run is skipped).
export async function findLatestDriftRun(userId: string): Promise<DriftObservationRow | null> {
  return findLatestRunWith(userId, 'drift')
}

export async function findLatestConscienceRun(userId: string): Promise<DriftObservationRow | null> {
  return findLatestRunWith(userId, 'conscience')
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

export interface DriftRunSectionValues {
  externalKey: string
  section: DriftRunSection
  // Top-level sourceMetadata keys to add; must include `section`.
  patch: Record<string, unknown>
  title: string
  bodyMd: string
  summary: string
}

// The day's drift_run, written section by section: the first job to finish
// inserts the row, the other merges its section in. A section already present
// is never overwritten (idempotent per section). The drift section owns the
// row's title and summary; the conscience section only appends to the body.
export async function writeDriftRunSection(
  userId: string,
  values: DriftRunSectionValues,
): Promise<{ memoryId: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id, present: sql<boolean>`${hasSection(values.section)}`, bodyMd: memories.bodyMd })
      .from(memories)
      .where(and(driftWhere(userId, 'drift_run'), sql`${memories.sourceMetadata}->>'externalKey' = ${values.externalKey}`))
      .limit(1)
    if (existing?.present) return { memoryId: existing.id, written: false }
    if (existing) {
      const ownsHeader = values.section === 'drift'
      const bodyMd = ownsHeader ? `${values.bodyMd}\n\n${existing.bodyMd}` : `${existing.bodyMd}\n\n${values.bodyMd}`
      await tx
        .update(memories)
        .set({
          sourceMetadata: sql`${memories.sourceMetadata} || ${JSON.stringify(values.patch)}::jsonb`,
          bodyMd,
          ...(ownsHeader ? { title: values.title.slice(0, 255), summary: values.summary.slice(0, 240) } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(memories.id, existing.id), eq(memories.userId, userId)))
      return { memoryId: existing.id, written: true }
    }
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
        tags: ['drift', 'drift_run'],
        sourceMetadata: { ...values.patch, kind: 'drift_run', externalKey: values.externalKey },
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('drift run insert returned no row')
    return { memoryId: inserted.id, written: true }
  })
}

// ── Conscience audit reads ─────────────────────────────────────────────────

export const AUDIT_BELIEF_CAP = 300

export interface AuditBeliefRow {
  id: string
  mind: string
  claim: string
  sourceType: string
  provenance: string[]
  embedding: number[] | null
  embeddingModel: string | null
}

// Every held belief of either mind (capped), newest first, with the fields
// the laundering audit and the contradiction sample need.
export async function listHeldBeliefsForAudit(userId: string, limit = AUDIT_BELIEF_CAP): Promise<AuditBeliefRow[]> {
  const rows = await db
    .select({
      id: memories.id,
      sourceMetadata: memories.sourceMetadata,
      embedding: memories.embedding,
      embeddingModel: memories.embeddingModel,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'belief'),
      isNull(memories.supersededAt),
      isNull(memories.archivedAt),
      sql`${memories.sourceMetadata}->'belief'->>'status' = 'held'`,
    ))
    .orderBy(desc(memories.updatedAt))
    .limit(Math.min(Math.max(limit, 1), AUDIT_BELIEF_CAP))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    if (!b) return []
    const embedding = Array.isArray(r.embedding) && r.embedding.length > 0 ? r.embedding : null
    return [{
      id: r.id,
      mind: b.mind,
      claim: b.claim,
      sourceType: b.sourceType,
      provenance: b.provenance,
      embedding,
      embeddingModel: r.embeddingModel ?? null,
    }]
  })
}

export interface ProvenanceOriginRow {
  id: string
  source: string | null
  sourceMetadata: { origin?: unknown; kind?: unknown }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Only the fields originKindOf reads, so large payloads stay in the database.
export async function listProvenanceOrigins(userId: string, ids: readonly string[]): Promise<ProvenanceOriginRow[]> {
  const wanted = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  if (wanted.length === 0) return []
  const rows = await db
    .select({
      id: memories.id,
      source: memories.source,
      origin: sql<unknown>`${memories.sourceMetadata}->'origin'`,
      kind: sql<unknown>`${memories.sourceMetadata}->>'kind'`,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, wanted)))
  return rows.map((r) => ({
    id: r.id,
    source: r.source ?? null,
    sourceMetadata: { ...(r.origin != null ? { origin: r.origin } : {}), ...(r.kind != null ? { kind: r.kind } : {}) },
  }))
}
