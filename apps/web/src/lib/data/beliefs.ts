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
import { mayReplace, reinforcedBelief, supportSnapshot } from '@/lib/kairos/beliefs/support'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'
import { listMemoryOrigins } from './belief-inputs'

// Belief ledger data access (docs/kairos/34 §1). Pure DB — no model, no
// grounding: lib/kairos/beliefs + the belief handlers own the policy. Every
// write logs its memory_ops row in the SAME transaction. The canonical belief
// readers (listBeliefs / listHeldBeliefs / getLatestMindCompare) live here.

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
}

// Recent belief_extract jobs, newest first.
export async function listRecentExtractJobs(userId: string, limit = 10): Promise<ExtractJobState[]> {
  const rows = await db
    .select({ status: thinkingJobs.status, error: thinkingJobs.error, input: thinkingJobs.input })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), eq(thinkingJobs.kind, 'belief_extract')))
    .orderBy(desc(thinkingJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50))
  return rows.map((row) => {
    const ctx = (row.input as { context?: { inputsUntil?: unknown; flaggedIds?: unknown } } | null)?.context
    const raw = ctx?.inputsUntil
    const d = typeof raw === 'string' ? new Date(raw) : null
    const flaggedIds = Array.isArray(ctx?.flaggedIds) ? ctx.flaggedIds.filter((x): x is string => typeof x === 'string') : []
    return { status: row.status, error: row.error, inputsUntil: d && Number.isFinite(d.getTime()) ? d : null, flaggedIds }
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

// ── Aligned-mind writes ───────────────────────────────────────────────────

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

async function insertBeliefRow(tx: Tx, userId: string, values: BeliefRowValues): Promise<string> {
  const [row] = await tx
    .insert(memories)
    .values({ userId, ...values, source: 'cron', pinned: false })
    .returning({ id: memories.id })
  if (!row) throw new Error('belief insert returned no row')
  return row.id
}

function withoutSupersedes(values: BeliefRowValues): BeliefRowValues {
  const belief = { ...(values.sourceMetadata.belief as Record<string, unknown>) }
  delete belief.supersedes
  return { ...values, sourceMetadata: { ...values.sourceMetadata, belief } }
}

function linksWith(links: unknown, ids: readonly string[]): unknown[] {
  const out = Array.isArray(links) ? [...links] : []
  for (const id of ids) {
    if (!out.some((l) => (l as { target?: unknown })?.target === id)) out.push({ type: 'refers_to', target: id, target_kind: 'memory' })
  }
  return out
}

export interface AlignedCreate {
  values: BeliefRowValues
  supersedes: string | null
  reason: string
}

export interface AlignedReinforce {
  targetId: string
  provenance: string[]
  reason: string
  // The model's stated confidence; capped by the recomputed source type.
  confidence?: number
}

export interface AlignedRetire {
  targetId: string
  reason: string
}

export interface AlignedWriteResult {
  written: boolean
  created: string[]
  superseded: string[]
  reinforced: string[]
  retired: string[]
  // Replaces refused because inference-only evidence may not displace an
  // operator- or tool-sourced belief (the claim landed as a new held belief).
  refusedReplaces: string[]
}

const emptyResult = (written: boolean): AlignedWriteResult =>
  ({ written, created: [], superseded: [], reinforced: [], retired: [], refusedReplaces: [] })

// One extraction's whole batch commits atomically with its ops. The advisory
// lock + extractKey probe make a double submit (routine racing the paid-key
// fallback) a no-op. A replace whose target is no longer held lands as new, as
// does an inference-only replace of an operator/tool belief. Reinforcing
// recomputes sourceType + confidence cap over the union provenance and clears
// a re-check flag (a reaffirm). A retire must target a flagged held belief.
export async function writeAlignedBeliefs(
  userId: string,
  runId: string | null,
  extractKey: string,
  writes: { create: AlignedCreate[]; reinforce: AlignedReinforce[]; retire?: AlignedRetire[] },
  now: Date = new Date(),
): Promise<AlignedWriteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${extractKey}))`)
    const prior = await tx
      .select({ memoryId: memoryOps.memoryId, op: memoryOps.op })
      .from(memoryOps)
      .where(and(eq(memoryOps.userId, userId), eq(memoryOps.step, BELIEF_STEP), sql`${memoryOps.after}->>'extractKey' = ${extractKey}`))
    if (prior.length > 0) {
      const created = prior.filter((p) => !p.op || p.op === 'promote').map((p) => p.memoryId).filter((id): id is string => !!id)
      return { ...emptyResult(false), created }
    }

    const ops: MemoryOpInput[] = []
    const out = emptyResult(true)
    for (const c of writes.create) {
      let target = c.supersedes ? await lockHeldBelief(tx, userId, c.supersedes, 'aligned') : null
      const old = target ? readBelief(target.sourceMetadata) : null
      const newType = (c.values.sourceMetadata.belief as BeliefV1 | undefined)?.sourceType ?? 'inference'
      let refused: string | null = null
      if (target && old && !mayReplace(newType, old.sourceType)) {
        refused = target.id
        target = null
        out.refusedReplaces.push(refused)
      }
      const id = await insertBeliefRow(tx, userId, target ? c.values : withoutSupersedes(c.values))
      out.created.push(id)
      if (target) {
        await tx
          .update(memories)
          .set({
            supersededAt: now,
            supersededById: id,
            invalidAt: now,
            updatedAt: now,
            sourceMetadata: { ...target.sourceMetadata, belief: { ...(old ?? {}), status: 'retired' } },
          })
          .where(and(eq(memories.id, target.id), eq(memories.userId, userId)))
        out.superseded.push(target.id)
      }
      const reason = target
        ? `${c.reason}; replaces ${target.id}`
        : refused
          ? `${c.reason}; held beside ${refused}: inference-only evidence may not replace a ${old?.sourceType ?? 'operator'}-sourced belief`
          : c.reason
      ops.push({
        memoryId: id,
        step: BELIEF_STEP,
        op: 'promote',
        before: null,
        after: { beliefId: id, mind: 'aligned', extractKey, sourceType: newType, ...(target ? { supersedes: target.id } : {}), ...(refused ? { replaceRefused: refused } : {}) },
        reason,
      })
    }
    for (const r of writes.reinforce) {
      const target = await lockHeldBelief(tx, userId, r.targetId, 'aligned')
      const old = target ? readBelief(target.sourceMetadata) : null
      if (!target || !old) continue
      const origins = await listMemoryOrigins(userId, [...old.provenance, ...r.provenance], tx)
      const next = reinforcedBelief(old, r.provenance, origins, r.confidence)
      const links = linksWith(target.links, r.provenance)
      await tx
        .update(memories)
        .set({ links, updatedAt: now, sourceMetadata: { ...target.sourceMetadata, belief: next } })
        .where(and(eq(memories.id, target.id), eq(memories.userId, userId)))
      out.reinforced.push(target.id)
      ops.push({
        memoryId: target.id,
        step: BELIEF_STEP,
        op: 'feedback',
        before: { belief: supportSnapshot(old), links: Array.isArray(target.links) ? target.links : [] },
        after: { belief: supportSnapshot(next), beliefId: target.id, mind: 'aligned', extractKey, reinforcedBy: r.provenance, ...(old.recheck ? { reaffirmed: true } : {}) },
        reason: old.recheck ? `${r.reason}; reaffirmed after losing support` : r.reason,
      })
    }
    for (const r of writes.retire ?? []) {
      const target = await lockHeldBelief(tx, userId, r.targetId, 'aligned')
      const old = target ? readBelief(target.sourceMetadata) : null
      if (!target || !old?.recheck) continue
      await tx
        .update(memories)
        .set({ invalidAt: now, supersededAt: null, updatedAt: now, sourceMetadata: { ...target.sourceMetadata, belief: { ...old, status: 'retired' } } })
        .where(and(eq(memories.id, target.id), eq(memories.userId, userId)))
      out.retired.push(target.id)
      ops.push({
        memoryId: target.id,
        step: BELIEF_STEP,
        op: 'retire',
        before: { invalidAt: target.invalidAt ? target.invalidAt.toISOString() : null, supersededAt: null, belief: { status: 'held' } },
        after: { invalidAt: now.toISOString(), supersededAt: null, belief: { status: 'retired' }, beliefId: target.id, mind: 'aligned', extractKey },
        reason: `aligned mind: retired after losing support: ${r.reason}`,
      })
    }
    if (ops.length) await insertMemoryOps(userId, runId, ops, tx)
    return out
  })
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
