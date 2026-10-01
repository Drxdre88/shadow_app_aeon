import { and, desc, eq, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, memoryOps } from '@/lib/db/schema'
import { validAsOfNow } from '@/lib/data/memories'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import type { EngineLink, MemoryOpInput } from '@/lib/kairos/engine/types'

// Concept tier data access (docs/kairos/26 §4, docs/kairos/32 §2.4). Pure DB —
// no clustering, no model, no grounding. The concept handler owns the policy.

// Rows that must never become concept members: syntheses of other rows (they
// would make a concept about concepts / cortex docs), and pending proposals
// (Kairos's own unconfirmed guesses).
export const CONCEPT_EXCLUDED_TYPES = ['concept', 'dominion_cortex', 'aether', 'archetype', 'inbound', 'belief', 'constitution'] as const
export const CONCEPT_EXCLUDED_STREAMS = [...META_STREAM_CLASSES, 'concept', 'cortex', 'aether', 'archetype', 'belief', 'constitution'] as const
export const CONCEPT_CANDIDATE_CAP = 600

export interface ConceptCandidateRow {
  id: string
  title: string
  aiTitle: string | null
  summary: string | null
  type: string
  streamClass: string
  confidence: number | null
  standing: number | null
  createdAt: Date
  embedding: number[]
}

export async function listConceptCandidates(
  userId: string,
  dominionId: string,
  limit = CONCEPT_CANDIDATE_CAP,
): Promise<ConceptCandidateRow[]> {
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      aiTitle: memories.aiTitle,
      summary: memories.summary,
      type: memories.type,
      streamClass: memories.streamClass,
      confidence: memories.confidence,
      standing: memories.standing,
      createdAt: memories.createdAt,
      embedding: memories.embedding,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      isNotNull(memories.embedding),
      isNull(memories.supersededAt),
      isNull(memories.archivedAt),
      validAsOfNow,
      notInArray(memories.type, [...CONCEPT_EXCLUDED_TYPES]),
      notInArray(memories.streamClass, [...CONCEPT_EXCLUDED_STREAMS]),
      // Concept-tier rows keep sourceMetadata.kind='concept' after an accept
      // re-types them (e.g. to 'observation'): never a member of a concept.
      sql`(${memories.sourceMetadata}->>'kind') IS DISTINCT FROM 'concept'`,
    ))
    .orderBy(sql`COALESCE(${memories.standing}, ${memories.confidence}, 0) DESC`, desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), CONCEPT_CANDIDATE_CAP))
  return rows
    .filter((r): r is typeof r & { embedding: number[] } => Array.isArray(r.embedding) && r.embedding.length > 0)
    .map((r) => ({ ...r, embedding: r.embedding }))
}

export interface ExistingConceptRow {
  id: string
  // true = a concept PROPOSAL (type 'inbound'), not a committed concept.
  isProposal: boolean
  pinned: boolean
  memberIds: string[]
  // live     = committed concept or still-pending proposal (update target).
  // resolved = dismissed/archived, accepted/promoted or superseded — the
  //            operator (or the engine) already settled this cluster.
  state: 'live' | 'resolved'
}

export function memberIdsFromLinks(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  const ids = links
    .filter((l): l is EngineLink => typeof l === 'object' && l !== null && (l as EngineLink).type === 'refers_to')
    .map((l) => l.target)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  return [...new Set(ids)]
}

export const CONCEPT_HISTORY_CAP = 1000

// Every concept-tier row of a Dominion regardless of status, archive or
// supersede state, newest first — so planning can update live concepts AND
// honour resolved ones (a dismissed proposal is a veto; an accepted one is
// the operator's) instead of re-proposing the same cluster every Sunday.
export async function listConceptHistory(userId: string, dominionId: string): Promise<ExistingConceptRow[]> {
  const rows = await db
    .select({
      id: memories.id,
      type: memories.type,
      pinned: memories.pinned,
      links: memories.links,
      archivedAt: memories.archivedAt,
      supersededAt: memories.supersededAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      or(
        eq(memories.type, 'concept'),
        sql`${memories.sourceMetadata}->>'kind' = 'concept'`,
      ),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(CONCEPT_HISTORY_CAP)
  return rows.map((r) => {
    const status = (r.sourceMetadata as Record<string, unknown> | null)?.status
    const live = !r.archivedAt && !r.supersededAt &&
      (r.type === 'concept' || (r.type === 'inbound' && status === 'pending'))
    return {
      id: r.id,
      isProposal: r.type !== 'concept',
      pinned: r.pinned,
      memberIds: memberIdsFromLinks(r.links),
      state: live ? 'live' : 'resolved',
    }
  })
}

export interface ConceptWriteValues {
  dominionId: string
  // Idempotency key (the thinking job's externalKey). Stored in
  // sourceMetadata.externalKey; a second write with the same key is a no-op.
  externalKey: string
  title: string
  bodyMd: string
  summary: string
  type: 'concept' | 'inbound'
  streamClass: 'concept' | 'agentic'
  confidence: number
  links: EngineLink[]
  tags: string[]
  sourceMetadata: Record<string, unknown>
}

export interface ConceptOpMeta {
  step: string
  reason: string
}

export interface ConceptWriteResult {
  memoryId: string
  // false when an earlier write already consumed this externalKey.
  written: boolean
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function snapshot(row: {
  title: string
  bodyMd: string
  summary: string | null
  confidence: number | null
  links: unknown
  tags: unknown
  sourceMetadata: unknown
}): Record<string, unknown> {
  return {
    title: row.title,
    bodyMd: row.bodyMd,
    summary: row.summary,
    confidence: row.confidence,
    links: row.links,
    tags: row.tags,
    sourceMetadata: row.sourceMetadata,
  }
}

async function insertOp(tx: Tx, userId: string, runId: string | null, op: MemoryOpInput): Promise<void> {
  await tx.insert(memoryOps).values({
    userId,
    runId,
    memoryId: op.memoryId,
    step: op.step,
    op: op.op,
    before: op.before ?? null,
    after: op.after ?? null,
    reason: op.reason,
  })
}

async function findByExternalKey(tx: Tx, userId: string, externalKey: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: memories.id })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->>'externalKey' = ${externalKey}`,
    ))
    .limit(1)
  return row?.id ?? null
}

// Insert a concept (or concept proposal) and its memory_ops row atomically.
// The advisory lock + externalKey probe make a double submit (routine answer
// racing the API fallback) a no-op rather than a duplicate concept.
export async function createConceptWithOp(
  userId: string,
  runId: string | null,
  values: ConceptWriteValues,
  meta: ConceptOpMeta,
): Promise<ConceptWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const existing = await findByExternalKey(tx, userId, values.externalKey)
    if (existing) return { memoryId: existing, written: false }

    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: values.dominionId,
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary,
        type: values.type,
        streamClass: values.streamClass,
        source: 'cron',
        confidence: values.confidence,
        links: values.links,
        tags: values.tags,
        sourceMetadata: { ...values.sourceMetadata, externalKey: values.externalKey },
        pinned: false,
      })
      .returning()
    if (!inserted) throw new Error('concept insert returned no row')

    await insertOp(tx, userId, runId, {
      memoryId: inserted.id,
      step: meta.step,
      op: 'concept_create',
      before: null,
      after: snapshot(inserted),
      reason: meta.reason,
    })
    return { memoryId: inserted.id, written: true }
  })
}

// In-place update of a live, unpinned concept (same id, so links pointing at
// it survive). The memory_ops `before` snapshot is the history/revert handle.
// Returns null when the target is gone, superseded, archived or pinned — the
// caller then creates a fresh concept instead.
export async function updateConceptWithOp(
  userId: string,
  runId: string | null,
  conceptId: string,
  values: ConceptWriteValues,
  meta: ConceptOpMeta,
): Promise<ConceptWriteResult | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${values.externalKey}))`)
    const existing = await findByExternalKey(tx, userId, values.externalKey)
    if (existing) return { memoryId: existing, written: false }

    const [current] = await tx
      .select()
      .from(memories)
      .where(and(
        eq(memories.id, conceptId),
        eq(memories.userId, userId),
        eq(memories.type, values.type),
        eq(memories.pinned, false),
        isNull(memories.supersededAt),
        isNull(memories.archivedAt),
      ))
      .limit(1)
      .for('update')
    if (!current) return null

    const now = new Date()
    const [updated] = await tx
      .update(memories)
      .set({
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary,
        confidence: values.confidence,
        links: values.links,
        tags: values.tags,
        sourceMetadata: {
          ...((current.sourceMetadata ?? {}) as Record<string, unknown>),
          ...values.sourceMetadata,
          externalKey: values.externalKey,
        },
        // Body changed → re-embed on the next backfill (mirrors updateMemory).
        embedding: null,
        embeddingModel: null,
        updatedAt: now,
      })
      .where(and(eq(memories.id, conceptId), eq(memories.userId, userId)))
      .returning()
    if (!updated) return null

    await insertOp(tx, userId, runId, {
      memoryId: conceptId,
      step: meta.step,
      op: 'concept_update',
      before: snapshot(current),
      after: snapshot(updated),
      reason: meta.reason,
    })
    return { memoryId: conceptId, written: true }
  })
}
