import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, memoryOps } from '@/lib/db/schema'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { BELIEF_STEP, readBelief, type BeliefRowValues, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import { mayReplace, reinforcedBelief, supportSnapshot } from '@/lib/kairos/beliefs/support'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'
import { surpriseGateMode } from '@/lib/kairos/surprise/flag'
import { decideReplace, decideRetire, withPressureBump } from '@/lib/kairos/surprise/gate'
import { isOpen } from '@/lib/kairos/surprise/marks'
import { listMemoryOrigins } from './belief-inputs'
import { insertBeliefRow, lockHeldBelief } from './beliefs'

// Aligned-mind batch writes (docs/kairos/34 §1) + the surprise gate
// (spec_surprise Lane 1, KAIROS_SURPRISE_GATE). Re-exported from ./beliefs.
// With the gate off every write is exactly the pre-gate behaviour.

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

// An operator-sourced replace that superseded its target (gate observe/on).
export interface OwnerCorrection {
  newId: string
  targetId: string
  // The replaced belief's provenance: its shared-provenance neighbours open.
  targetProvenance: string[]
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
  // Gate only (absent when KAIROS_SURPRISE_GATE is off):
  // targets of non-operator replaces held beside them (gate on) …
  gatedReplaces?: string[]
  // … or that would have been (gate observe; they went through).
  wouldGateReplaces?: string[]
  ownerCorrections?: OwnerCorrection[]
}

const emptyResult = (written: boolean): AlignedWriteResult =>
  ({ written, created: [], superseded: [], reinforced: [], retired: [], refusedReplaces: [] })

export interface AlignedWrites {
  create: AlignedCreate[]
  reinforce: AlignedReinforce[]
  retire?: AlignedRetire[]
  // Beliefs the job put to the model as open; treated as open even if the
  // mark has closed by the time the answer lands (gate on only).
  openIds?: string[]
}

// One extraction's whole batch commits atomically with its ops. The advisory
// lock + extractKey probe make a double submit (routine racing the paid-key
// fallback) a no-op. A replace whose target is no longer held lands as new, as
// does an inference-only replace of an operator/tool belief. Reinforcing
// recomputes sourceType + confidence cap over the union provenance and clears
// a re-check flag (a reaffirm). A retire must target a flagged held belief.
// Gate on: a non-operator replace of a target that is not open lands beside
// it (after.replaceGated) and bumps the target's pressure; an open target may
// also be retired. Gate observe: verdicts are logged, nothing is blocked.
export async function writeAlignedBeliefs(
  userId: string,
  runId: string | null,
  extractKey: string,
  writes: AlignedWrites,
  now: Date = new Date(),
): Promise<AlignedWriteResult> {
  const mode = surpriseGateMode()
  const jobOpen = new Set(mode === 'on' ? writes.openIds ?? [] : [])
  const targetOpen = (id: string, meta: unknown) => jobOpen.has(id) || isOpen(meta, now)
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
    const gated: string[] = []
    const wouldGate: string[] = []
    const owner: OwnerCorrection[] = []
    for (const c of writes.create) {
      let target = c.supersedes ? await lockHeldBelief(tx, userId, c.supersedes, 'aligned') : null
      const old = target ? readBelief(target.sourceMetadata) : null
      const newType = (c.values.sourceMetadata.belief as BeliefV1 | undefined)?.sourceType ?? 'inference'
      let refused: string | null = null
      let gatedId: string | null = null
      if (target && old && !mayReplace(newType, old.sourceType)) {
        refused = target.id
        target = null
        out.refusedReplaces.push(refused)
      }
      const verdict = target ? decideReplace(mode, newType, targetOpen(target.id, target.sourceMetadata)) : null
      if (target && verdict?.wouldGate) {
        if (verdict.allow) wouldGate.push(target.id)
        else {
          gatedId = target.id
          gated.push(gatedId)
          await tx
            .update(memories)
            .set({ sourceMetadata: withPressureBump(target.sourceMetadata, now) })
            .where(and(eq(memories.id, target.id), eq(memories.userId, userId)))
          target = null
        }
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
        if (verdict?.ownerCorrection) owner.push({ newId: id, targetId: target.id, targetProvenance: old?.provenance ?? [] })
      }
      const reason = target
        ? `${c.reason}; replaces ${target.id}`
        : refused
          ? `${c.reason}; held beside ${refused}: inference-only evidence may not replace a ${old?.sourceType ?? 'operator'}-sourced belief`
          : gatedId
            ? `${c.reason}; held beside ${gatedId}: not open for update (no surprising event questioned it)`
            : c.reason
      ops.push({
        memoryId: id,
        step: BELIEF_STEP,
        op: 'promote',
        before: null,
        after: {
          beliefId: id, mind: 'aligned', extractKey, sourceType: newType,
          ...(target ? { supersedes: target.id } : {}),
          ...(refused ? { replaceRefused: refused } : {}),
          ...(gatedId ? { replaceGated: gatedId } : {}),
          ...(target && verdict?.wouldGate ? { replaceWouldGate: true } : {}),
        },
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
      if (!target || !old) continue
      if (!decideRetire(mode, !!old.recheck, targetOpen(target.id, target.sourceMetadata))) continue
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
        reason: old.recheck
          ? `aligned mind: retired after losing support: ${r.reason}`
          : `aligned mind: retired after a surprising event questioned it: ${r.reason}`,
      })
    }
    if (ops.length) await insertMemoryOps(userId, runId, ops, tx)
    if (mode === 'off') return out
    if (wouldGate.length) console.info(`[kairos:surprise] gate observe: would hold ${wouldGate.length} replace(s) beside ${wouldGate.join(', ')}`)
    return { ...out, gatedReplaces: gated, wouldGateReplaces: wouldGate, ownerCorrections: owner }
  })
}
