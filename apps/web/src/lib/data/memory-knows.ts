import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions, memories, memoryOps } from '@/lib/db/schema'
import { findMemoryById, validAsOfNow } from './memories'
import { insertMemoryOps, listMemoryOps } from './memory-ops'
import { originKindOf, type Origin } from '@/lib/kairos/origin'
import { readBelief } from '@/lib/kairos/beliefs/types'
import { SENSITIVE_HELD_KEY } from '@/lib/kairos/sensitive'

// "What Vorath knows" — read model and owner corrections over the memories
// substrate. Pure DB access; auth and the constitution/goal refusals live in
// lib/actions/memory-knows.ts. Every owner fix logs a memory_ops row (step
// 'owner') in the same transaction, so the existing revert path can undo it.

export const OWNER_STEP = 'owner'
const KNOWN_TYPES = ['belief', 'fact'] as const
const KNOWN_STREAMS = ['belief', 'reflection'] as const
const DURABLE_TYPES = ['belief', 'fact', 'reflection', 'decision', 'contact'] as const
const DURABLE_STREAMS = ['belief', 'reflection', 'concept'] as const
const LOW_STANDING = 0.5

const KNOWN_COLUMNS = {
  id: memories.id,
  title: memories.title,
  aiTitle: memories.aiTitle,
  summary: memories.summary,
  type: memories.type,
  streamClass: memories.streamClass,
  source: memories.source,
  sourceMetadata: memories.sourceMetadata,
  confidence: memories.confidence,
  standing: memories.standing,
  pinned: memories.pinned,
  projectId: memories.projectId,
  taskId: memories.taskId,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
  dominionId: memories.dominionId,
  dominionName: dominions.name,
  dominionColor: dominions.color,
} as const

export type KnownRow = {
  id: string
  title: string
  aiTitle: string | null
  summary: string | null
  type: string
  streamClass: string
  source: string
  sourceMetadata: unknown
  confidence: number | null
  standing: number | null
  pinned: boolean
  projectId: string | null
  taskId: string | null
  createdAt: Date
  updatedAt: Date
  dominionId: string | null
  dominionName: string | null
  dominionColor: string | null
}

const dominionJoin = (userId: string) => and(eq(dominions.id, memories.dominionId), eq(dominions.userId, userId))
const liveRow = [isNull(memories.archivedAt), isNull(memories.supersededAt)] as const

// Vorath's current beliefs and key facts: live, non-superseded belief / fact /
// reflection rows that grounding can actually use (validAsOfNow also drops
// sensitive rows still held for review).
export async function listKnownRows(userId: string, limit = 200): Promise<KnownRow[]> {
  return db
    .select(KNOWN_COLUMNS)
    .from(memories)
    .leftJoin(dominions, dominionJoin(userId))
    .where(and(
      eq(memories.userId, userId),
      ...liveRow,
      validAsOfNow,
      or(inArray(memories.type, [...KNOWN_TYPES]), inArray(memories.streamClass, [...KNOWN_STREAMS])),
    ))
    .orderBy(sql`${memories.standing} DESC NULLS LAST`, desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500))
}

export type NeedsEyesReason = 'sensitive' | 'recheck' | 'low_trust'
export type NeedsEyesRow = KnownRow & { reason: NeedsEyesReason }

// Origin kind in SQL: the stored label, else the source-based inference
// (origin.ts inferOriginKind, reduced to the agent/external cases we list).
const sqlOriginKind = sql`coalesce(${memories.sourceMetadata}->'origin'->>'kind', case
  when ${memories.source} in ('import', 'webhook') then 'external'
  when ${memories.source} in ('claude', 'codex', 'copilot', 'hook') then 'agent'
  else 'other' end)`

// What the owner should look at: sensitive rows held by the gate, beliefs the
// engine flagged for re-check, and recent durable rows written by an agent or
// outside content that have not earned standing and were never reviewed.
export async function listNeedsEyes(userId: string, opts: { days?: number; limit?: number } = {}): Promise<NeedsEyesRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200)
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000)
  const base = (where: ReturnType<typeof and>) => db
    .select(KNOWN_COLUMNS)
    .from(memories)
    .leftJoin(dominions, dominionJoin(userId))
    .where(and(eq(memories.userId, userId), isNull(memories.archivedAt), where))
    .orderBy(desc(memories.createdAt))
    .limit(limit)

  const [held, recheck, lowTrust] = await Promise.all([
    base(and(sql`${memories.sourceMetadata}->>'sensitiveHeld' = 'true'`)),
    base(and(isNull(memories.supersededAt), sql`${memories.sourceMetadata}->'belief'->'recheck' IS NOT NULL`)),
    base(and(
      isNull(memories.supersededAt),
      gte(memories.createdAt, since),
      or(inArray(memories.type, [...DURABLE_TYPES]), inArray(memories.streamClass, [...DURABLE_STREAMS])),
      sql`${sqlOriginKind} in ('agent', 'external')`,
      sql`(${memories.standing} IS NULL OR ${memories.standing} < ${LOW_STANDING})`,
      sql`${memories.sourceMetadata}->>'ownerReviewedAt' IS NULL`,
    )),
  ])
  return mergeNeedsEyes([
    ...held.map((r) => ({ ...r, reason: 'sensitive' as const })),
    ...recheck.map((r) => ({ ...r, reason: 'recheck' as const })),
    ...lowTrust.map((r) => ({ ...r, reason: 'low_trust' as const })),
  ], limit)
}

// One entry per memory; the first reason wins (sensitive > recheck > low trust).
export function mergeNeedsEyes(rows: NeedsEyesRow[], limit: number): NeedsEyesRow[] {
  const seen = new Set<string>()
  const out: NeedsEyesRow[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out.slice(0, limit)
}

export type ProvenanceOp = {
  id: string
  step: string
  op: string
  reason: string
  createdAt: Date
  revertedAt: Date | null
}

export type ProvenanceSupport = { id: string; title: string; source: string; sourceMetadata: unknown }

export type MemoryProvenance = {
  dominionName: string | null
  ops: ProvenanceOp[]
  supports: ProvenanceSupport[]
}

// The "why" behind one memory: its engine/owner change history and, for a
// belief, the memories it rests on. User-scoped; null when not owned.
export async function getMemoryProvenance(userId: string, memoryId: string): Promise<MemoryProvenance | null> {
  const row = await findMemoryById(memoryId, userId)
  if (!row) return null
  const belief = readBelief(row.sourceMetadata)
  const supportIds = (belief?.provenance ?? []).slice(0, 12)
  const [ops, supports, dominion] = await Promise.all([
    listMemoryOps(userId, { memoryId, includeReverted: true, limit: 30 }),
    supportIds.length === 0 ? Promise.resolve([]) : db
      .select({ id: memories.id, title: memories.title, aiTitle: memories.aiTitle, source: memories.source, sourceMetadata: memories.sourceMetadata })
      .from(memories)
      .where(and(eq(memories.userId, userId), inArray(memories.id, supportIds))),
    row.dominionId
      ? db.select({ name: dominions.name }).from(dominions)
        .where(and(eq(dominions.id, row.dominionId), eq(dominions.userId, userId))).limit(1)
      : Promise.resolve([]),
  ])
  return {
    dominionName: dominion[0]?.name ?? null,
    ops: ops.map((o) => ({ id: o.id, step: o.step, op: o.op, reason: o.reason, createdAt: o.createdAt, revertedAt: o.revertedAt })),
    supports: supports.map((s) => ({ id: s.id, title: s.aiTitle ?? s.title, source: s.source, sourceMetadata: s.sourceMetadata })),
  }
}

type Meta = Record<string, unknown>
const asMeta = (v: unknown): Meta => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Meta) } : {})

export type OwnerFixResult = { ok: true; memoryId: string; opId: string | null } | { ok: false; reason: 'not_found' | 'already_archived' }

// "This is wrong": soft-archive with the owner's reason, logged as a 'reject'
// op whose before/after is the archivedAt flip, so revert_memory_op (and the
// panel's Undo) restores it through the generic revert path.
export async function rejectMemoryAsWrong(userId: string, memoryId: string, reason: string): Promise<OwnerFixResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId))).for('update').limit(1)
    if (!current) return { ok: false, reason: 'not_found' }
    if (current.archivedAt) return { ok: false, reason: 'already_archived' }
    const now = new Date()
    const meta = asMeta(current.sourceMetadata)
    meta.ownerRejected = { reason, at: now.toISOString() }
    await tx.update(memories).set({ archivedAt: now, updatedAt: now, sourceMetadata: meta })
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    const [op] = await tx.insert(memoryOps).values({
      userId, runId: null, memoryId, step: OWNER_STEP, op: 'reject',
      before: { archivedAt: null }, after: { archivedAt: now.toISOString() },
      reason: `owner marked wrong: ${reason}`,
    }).returning({ id: memoryOps.id })
    return { ok: true, memoryId, opId: op?.id ?? null }
  })
}

// Confirm: the owner vouches for the row. Re-labels it operator ('confirm',
// prior label kept as priorOrigin — the acceptProposal pattern), releases a
// held sensitive row, and clears a belief's re-check flag. The flag clear is
// logged as a belief 'feedback' op, so the existing revert restores it.
export async function confirmMemoryAsOwner(userId: string, memoryId: string): Promise<OwnerFixResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId))).for('update').limit(1)
    if (!current) return { ok: false, reason: 'not_found' }
    const now = new Date()
    const meta = asMeta(current.sourceMetadata)
    const priorKind = originKindOf(current)
    const origin: Origin = { kind: 'operator', via: 'confirm' }
    if (priorKind !== 'operator') meta.priorOrigin = meta.origin ?? { kind: priorKind }
    meta.origin = origin
    meta.ownerReviewedAt = now.toISOString()
    if (meta[SENSITIVE_HELD_KEY] === true) meta[SENSITIVE_HELD_KEY] = false
    const belief = asMeta(meta.belief)
    const recheck = belief.recheck
    if (recheck !== undefined) {
      delete belief.recheck
      meta.belief = belief
    }
    await tx.update(memories).set({ sourceMetadata: meta, updatedAt: now })
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    const ops = recheck !== undefined
      ? [{ memoryId, step: OWNER_STEP, op: 'feedback' as const, before: { belief: { recheck } }, after: { belief: { recheck: null } }, reason: 'owner confirmed after re-check' }]
      : [{ memoryId, step: OWNER_STEP, op: 'feedback' as const, before: { origin: { kind: priorKind } }, after: { origin }, reason: 'owner confirmed' }]
    await insertMemoryOps(userId, null, ops, tx)
    return { ok: true, memoryId, opId: null }
  })
}
