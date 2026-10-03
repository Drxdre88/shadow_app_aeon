import { and, asc, desc, eq, gte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories, memoryOps, thinkingJobs } from '@/lib/db/schema'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import {
  BELIEF_STEP,
  BELIEF_TYPE,
  readBelief,
  type BeliefMind,
  type BeliefRecheck,
  type BeliefRowValues,
  type BeliefV1,
} from '@/lib/kairos/beliefs/types'

// Belief ledger data access (docs/kairos/34 §1). Pure DB — no model, no
// grounding: lib/kairos/beliefs + the belief handlers own the policy. Every
// write logs its memory_ops row in the SAME transaction. The canonical belief
// readers (listBeliefs / listHeldBeliefs / getLatestMindCompare) live here;
// the aligned-mind batch write (+ surprise gate) lives in ./belief-aligned.

export {
  writeAlignedBeliefs,
  type AlignedCreate,
  type AlignedReinforce,
  type AlignedRetire,
  type AlignedWriteResult,
  type AlignedWrites,
  type OwnerCorrection,
} from './belief-aligned'
export {
  SIGNAL_INPUT_CAP,
  listBeliefEvidence,
  listMemoryOrigins,
  listOperatorSignals,
  mayShapeBeliefsSql,
} from './belief-inputs'
export {
  MIND_COMPARE_KIND,
  getLatestMindCompare,
  writeMindCompare,
  type MindCompareValues,
  type MindComparisonView,
} from './mind-compare'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const beliefField = (key: string) => sql`${memories.sourceMetadata}->'belief'->>${key}`
export const isBelief = and(eq(memories.type, BELIEF_TYPE), sql`(${memories.sourceMetadata}->'belief') IS NOT NULL`)!
export const liveHeld = and(isNull(memories.supersededAt), isNull(memories.archivedAt), sql`${beliefField('status')} = 'held'`)!

// ── Reads ──────────────────────────────────────────────────────────────────

export type BeliefStatusFilter = 'held' | 'retired' | 'all'

export interface ListBeliefsOptions {
  mind?: BeliefMind
  domain?: string
  status?: BeliefStatusFilter
  limit?: number
  // Only rows touched (created, reinforced, retired) at or after this instant.
  updatedSince?: Date
  // 'recent' (default): last touched first. 'standing': weightiest first.
  rank?: 'recent' | 'standing'
}

export interface BeliefView {
  id: string
  mind: string
  domain: string
  dominionId: string | null
  claim: string
  reasons: string[]
  falsifier: string
  sourceType: string
  provenance: string[]
  status: string
  confidence: number
  supersedes: string | null
  supersededById: string | null
  // P2.5 re-check flag: part of the provenance is gone; null when fully supported.
  recheck: BeliefRecheck | null
  createdAt: Date
  updatedAt: Date
}

export async function listBeliefs(userId: string, opts: ListBeliefsOptions = {}): Promise<BeliefView[]> {
  const conds: SQL[] = [eq(memories.userId, userId), isBelief]
  if (opts.mind) conds.push(sql`${beliefField('mind')} = ${opts.mind}`)
  if (opts.domain) conds.push(sql`lower(${beliefField('domain')}) = lower(${opts.domain})`)
  if (opts.updatedSince) conds.push(gte(memories.updatedAt, opts.updatedSince))
  const status = opts.status ?? 'held'
  if (status === 'held') conds.push(liveHeld)
  if (status === 'retired') conds.push(sql`(${beliefField('status')} = 'retired' OR ${memories.supersededAt} IS NOT NULL)`)
  const order = opts.rank === 'standing'
    ? [sql`${memories.standing} DESC NULLS LAST`, sql`${memories.confidence} DESC NULLS LAST`, desc(memories.updatedAt)]
    : [desc(memories.updatedAt)]
  const rows = await db
    .select({
      id: memories.id,
      sourceMetadata: memories.sourceMetadata,
      supersededById: memories.supersededById,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .where(and(...conds))
    .orderBy(...order)
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    if (!b) return []
    const { supersedes, recheck, ...rest } = b
    return [{ id: r.id, ...rest, supersedes: supersedes ?? null, supersededById: r.supersededById, recheck: recheck ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt }]
  })
}

export interface HeldBeliefRow {
  id: string
  domain: string
  claim: string
  embedding: number[] | null
  sourceType: BeliefV1['sourceType']
  recheck: BeliefRecheck | null
}

export const HELD_BELIEF_CAP = 300

export async function listHeldBeliefs(userId: string, mind: BeliefMind, limit = HELD_BELIEF_CAP): Promise<HeldBeliefRow[]> {
  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, embedding: memories.embedding })
    .from(memories)
    .where(and(eq(memories.userId, userId), isBelief, liveHeld, sql`${beliefField('mind')} = ${mind}`))
    .orderBy(desc(memories.updatedAt))
    .limit(Math.min(Math.max(limit, 1), HELD_BELIEF_CAP))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    if (!b) return []
    const embedding = Array.isArray(r.embedding) && r.embedding.length > 0 ? r.embedding : null
    return [{ id: r.id, domain: b.domain, claim: b.claim, embedding, sourceType: b.sourceType, recheck: b.recheck ?? null }]
  })
}

export interface ExtractJobState {
  status: string
  error: string | null
  // context.inputsUntil: the newest input the job was planned over.
  inputsUntil: Date | null
  // context.flaggedIds: re-check beliefs the job put to the model.
  flaggedIds?: string[]
  // context.openIds: beliefs open for update (surprise gate) the job put to the model.
  openIds?: string[]
  // When the job was planned.
  plannedAt?: Date
}

// Recent belief_extract jobs, newest first.
export async function listRecentExtractJobs(userId: string, limit = 10): Promise<ExtractJobState[]> {
  const rows = await db
    .select({ status: thinkingJobs.status, error: thinkingJobs.error, input: thinkingJobs.input, createdAt: thinkingJobs.createdAt })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), eq(thinkingJobs.kind, 'belief_extract')))
    .orderBy(desc(thinkingJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50))
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return rows.map((row) => {
    const ctx = (row.input as { context?: { inputsUntil?: unknown; flaggedIds?: unknown; openIds?: unknown } } | null)?.context
    const raw = ctx?.inputsUntil
    const d = typeof raw === 'string' ? new Date(raw) : null
    return {
      status: row.status,
      error: row.error,
      inputsUntil: d && Number.isFinite(d.getTime()) ? d : null,
      flaggedIds: ids(ctx?.flaggedIds),
      openIds: ids(ctx?.openIds),
      plannedAt: row.createdAt,
    }
  })
}

export async function thinkingJobKeyExists(userId: string, externalKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: thinkingJobs.id })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), eq(thinkingJobs.externalKey, externalKey)))
    .limit(1)
  return Boolean(row)
}

// ── Row locks / inserts (shared with ./belief-aligned) ─────────────────────

export interface LockedBelief {
  id: string
  sourceMetadata: Record<string, unknown>
  links: unknown
  invalidAt: Date | null
}

export async function lockHeldBelief(tx: Tx, userId: string, id: string, mind: BeliefMind | null): Promise<LockedBelief | null> {
  const conds: SQL[] = [eq(memories.id, id), eq(memories.userId, userId), isBelief, liveHeld]
  if (mind) conds.push(sql`${beliefField('mind')} = ${mind}`)
  const [row] = await tx
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, links: memories.links, invalidAt: memories.invalidAt })
    .from(memories)
    .where(and(...conds))
    .limit(1)
    .for('update')
  return row ? { ...row, sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown> } : null
}

export async function insertBeliefRow(tx: Tx, userId: string, values: BeliefRowValues): Promise<string> {
  const [row] = await tx
    .insert(memories)
    .values({ userId, ...values, source: 'cron', pinned: false })
    .returning({ id: memories.id })
  if (!row) throw new Error('belief insert returned no row')
  return row.id
}

// ── Own-mind mirror of engine promotions ──────────────────────────────────

// BackUpStep.name — the engine step whose 'promote' ops are Kairos's own
// beliefs (docs/kairos/32 §2.3). Belief-ledger ops use BELIEF_STEP instead.
export const ENGINE_PROMOTE_STEP = 'backup'

export interface PromotionToMirror {
  opId: string
  promotedAt: Date
  proposalId: string
  title: string
  aiTitle: string | null
  summary: string | null
  bodyMd: string
  dominionId: string | null
  dominionName: string | null
  confidence: number | null
  sourceMetadata: Record<string, unknown>
}

export async function listUnmirroredPromotions(userId: string, since: Date, limit = 50): Promise<PromotionToMirror[]> {
  const rows = await db
    .select({
      opId: memoryOps.id,
      promotedAt: memoryOps.createdAt,
      proposalId: memories.id,
      title: memories.title,
      aiTitle: memories.aiTitle,
      summary: memories.summary,
      bodyMd: memories.bodyMd,
      dominionId: memories.dominionId,
      dominionName: dominions.name,
      confidence: memories.confidence,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memoryOps)
    .innerJoin(memories, and(eq(memories.id, memoryOps.memoryId), eq(memories.userId, userId)))
    .leftJoin(dominions, and(eq(dominions.id, memories.dominionId), eq(dominions.userId, userId)))
    .where(and(
      eq(memoryOps.userId, userId),
      eq(memoryOps.op, 'promote'),
      eq(memoryOps.step, ENGINE_PROMOTE_STEP),
      isNull(memoryOps.revertedAt),
      sql`${memoryOps.createdAt} >= ${since}`,
      sql`NOT EXISTS (SELECT 1 FROM memories b WHERE b.user_id = ${userId} AND b.type = ${BELIEF_TYPE} AND b.source_metadata->>'mirroredFrom' = ${memories.id}::text)`,
    ))
    .orderBy(asc(memoryOps.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200))
  return rows.map((r) => ({ ...r, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }))
}

// Idempotent per proposal: a mirror already keyed `mirroredFrom` = proposal
// returns its id unwritten. `runId` ties the op to the engine run that wrote it.
export async function writeOwnMirror(
  userId: string,
  values: BeliefRowValues,
  meta: { proposalId: string; sourceOpId: string; reason: string; runId?: string | null },
): Promise<{ memoryId: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${`mirror:${meta.proposalId}`}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.type, BELIEF_TYPE), sql`${memories.sourceMetadata}->>'mirroredFrom' = ${meta.proposalId}`))
      .limit(1)
    if (existing) return { memoryId: existing.id, written: false }
    const id = await insertBeliefRow(tx, userId, {
      ...values,
      sourceMetadata: { ...values.sourceMetadata, mirroredFrom: meta.proposalId, mirroredFromOpId: meta.sourceOpId },
    })
    await insertMemoryOps(userId, meta.runId ?? null, [{
      memoryId: id,
      step: BELIEF_STEP,
      op: 'promote',
      before: null,
      after: { beliefId: id, mind: 'own', mirroredFrom: meta.proposalId, sourceOpId: meta.sourceOpId },
      reason: meta.reason,
    }], tx)
    return { memoryId: id, written: true }
  })
}

// Held own beliefs whose source promotion the operator has since reverted.
export async function listMirrorsOfRevertedPromotions(userId: string, limit = 50): Promise<Array<{ beliefId: string; opId: string }>> {
  const rows = await db
    .select({ beliefId: memories.id, opId: memoryOps.id })
    .from(memories)
    .innerJoin(memoryOps, and(
      eq(memoryOps.userId, userId),
      sql`${memoryOps.id}::text = ${memories.sourceMetadata}->>'mirroredFromOpId'`,
    ))
    .where(and(eq(memories.userId, userId), isBelief, liveHeld, sql`${beliefField('mind')} = 'own'`, isNotNull(memoryOps.revertedAt)))
    .limit(Math.min(Math.max(limit, 1), 200))
  return rows
}

export async function retireOwnBelief(
  userId: string,
  beliefId: string,
  reason: string,
  now: Date = new Date(),
  runId: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const target = await lockHeldBelief(tx, userId, beliefId, 'own')
    const old = target ? readBelief(target.sourceMetadata) : null
    if (!target || !old) return false
    await tx
      .update(memories)
      .set({ invalidAt: now, updatedAt: now, sourceMetadata: { ...target.sourceMetadata, belief: { ...old, status: 'retired' } } })
      .where(and(eq(memories.id, beliefId), eq(memories.userId, userId)))
    await insertMemoryOps(userId, runId, [{
      memoryId: beliefId,
      step: BELIEF_STEP,
      op: 'decay',
      before: null,
      after: { beliefId, mind: 'own', status: 'retired' },
      reason,
    }], tx)
    return true
  })
}
