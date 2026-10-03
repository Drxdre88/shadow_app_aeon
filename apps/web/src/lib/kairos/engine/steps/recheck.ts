import { listMemoryOrigins } from '@/lib/data/belief-inputs'
import {
  findBeliefSupportLosses,
  findBeliefsToNormalise,
  mutateHeldBelief,
  type BeliefMutation,
  type ProvenanceProbe,
} from '@/lib/data/belief-recheck'
import type { LockedBelief } from '@/lib/data/beliefs'
import { decideRecheck, sourceTypeOf, type LostSource } from '@/lib/kairos/beliefs/support'
import { BELIEF_CONFIDENCE_CAP, type OriginKind } from '@/lib/kairos/origin'
import { readBelief, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import { surpriseGateMode } from '@/lib/kairos/surprise/flag'
import { recordSurprise } from '@/lib/kairos/surprise/ledger'
import { errorMessage, outOfTime } from '../deadline'
import type { EngineRunContext, MemoryOpInput, Step, StepResult } from '../types'

// Recheck (P2.5 truth maintenance, docs/kairos/32 §2.6): after OwnMind, find
// held beliefs (both minds) whose provenance lost a memory since: deleted,
// archived, invalidated, or superseded with no live survivor. A Merge is not
// a loss: the provenance id is remapped to the survivor (op 'feedback'). A
// real loss flags `belief.recheck`, multiplies confidence by 0.7 (floor 0.1)
// once per new loss set (op 'recheck'); an own-mind belief left with no
// provenance is retired (op 'retire'). Aligned flags are re-examined by the
// next belief_extract job. Reverted promotions are OwnMind's job (mirror.ts
// retires their mirrors), not this step's.
//
// Normalisation (same step, leftover budget after losses): a legacy held
// belief whose stored sourceType differs from what its provenance origins
// give, or whose confidence exceeds that type's cap, gets the computed
// sourceType and a capped confidence (never raised), stamped
// belief.normalisedAt, one revertable 'feedback' op (after.normalised: true).

export const RECHECK_STEP = 'recheck'
export const RECHECK_CAP = 200

type Row = Pick<LockedBelief, 'sourceMetadata' | 'links' | 'invalidAt'>

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function vetoOf(meta: Record<string, unknown>, op: string): Record<string, unknown> | null {
  return asRecord(asRecord(asRecord(meta.engine)?.vetoes)?.[op])
}

function acknowledgedLost(meta: Record<string, unknown>): Set<string> {
  const ids = vetoOf(meta, 'recheck')?.lostSources
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])
}

function remapLinks(links: unknown, remap: ReadonlyMap<string, string>): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const l of Array.isArray(links) ? links : []) {
    const rec = asRecord(l)
    const target = typeof rec?.target === 'string' ? rec.target : null
    const next = target && remap.has(target) ? { ...rec, target: remap.get(target) } : l
    const key = typeof (next as { target?: unknown }).target === 'string' ? `${(next as { type?: unknown }).type}:${(next as { target: string }).target}` : null
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    out.push(next)
  }
  return out
}

const describeLost = (lost: readonly LostSource[]) => lost.map((s) => `${s.id} ${s.state}`).join(', ')

// Pure: the mutation for one belief given tonight's probes, or null.
export function planBeliefRecheck(row: Row, probes: readonly ProvenanceProbe[], now: Date): BeliefMutation | null {
  const old = readBelief(row.sourceMetadata)
  if (!old || old.status !== 'held') return null
  let belief: BeliefV1 = old
  let links: unknown[] | undefined
  let invalidAt: Date | undefined
  const ops: BeliefMutation['ops'] = []

  const remap = new Map<string, string>()
  for (const p of probes) {
    if (p.state === 'merged' && p.survivorId && p.survivorId !== p.id && belief.provenance.includes(p.id)) remap.set(p.id, p.survivorId)
  }
  if (remap.size > 0) {
    const provenance = [...new Set(belief.provenance.map((id) => remap.get(id) ?? id))]
    const beforeLinks = Array.isArray(row.links) ? row.links : []
    links = remapLinks(row.links, remap)
    ops.push({
      step: RECHECK_STEP,
      op: 'feedback',
      before: { belief: { provenance: belief.provenance }, links: beforeLinks },
      after: { belief: { provenance }, links, remapped: [...remap].map(([from, to]) => ({ from, to })) },
      reason: `belief support: ${remap.size} source(s) merged; provenance follows the survivor`,
    })
    belief = { ...belief, provenance }
  }

  const lost: LostSource[] = probes.flatMap((p) => (p.state === 'merged' ? [] : [{ id: p.id, state: p.state }]))
  if (lost.length > 0) {
    const d = decideRecheck(belief, lost, now, {
      acknowledged: acknowledgedLost(row.sourceMetadata),
      retireVetoed: vetoOf(row.sourceMetadata, 'retire') !== null,
    })
    if (d.kind === 'flag') {
      ops.push({
        step: RECHECK_STEP,
        op: 'recheck',
        before: { belief: { confidence: belief.confidence, recheck: belief.recheck ?? null } },
        after: { belief: { confidence: d.belief.confidence, recheck: d.belief.recheck ?? null }, lostSources: d.newlyLost },
        reason: `${belief.mind} belief lost support (${describeLost(d.newlyLost)}); confidence ${belief.confidence} → ${d.belief.confidence}, awaiting re-examination`,
      })
      belief = d.belief
    } else if (d.kind === 'retire') {
      invalidAt = now
      ops.push({
        step: RECHECK_STEP,
        op: 'retire',
        before: { invalidAt: row.invalidAt ? row.invalidAt.toISOString() : null, supersededAt: null, belief: { status: 'held', recheck: belief.recheck ?? null } },
        after: { invalidAt: now.toISOString(), supersededAt: null, belief: { status: 'retired', recheck: d.belief.recheck ?? null }, lostSources: d.newlyLost },
        reason: `own mind: every source is gone (${describeLost(d.newlyLost)}); belief retired`,
      })
      belief = d.belief
    }
  }

  if (ops.length === 0) return null
  return {
    sourceMetadata: { ...row.sourceMetadata, belief },
    ...(links ? { links } : {}),
    ...(invalidAt ? { invalidAt, supersededAt: null } : {}),
    ops,
  }
}

// Pure: bring sourceType / confidence in line with the provenance origins.
export function planNormalise(row: Row, origins: ReadonlyMap<string, OriginKind>, now: Date): BeliefMutation | null {
  const old = readBelief(row.sourceMetadata)
  if (!old || old.status !== 'held' || vetoOf(row.sourceMetadata, 'normalise')) return null
  // Own-mind beliefs are Kairos's view however they cite the operator:
  // always 'inference'. Only aligned beliefs take their type from evidence.
  const sourceType = old.mind === 'aligned' ? sourceTypeOf(old.provenance, origins) : 'inference'
  const confidence = Math.min(old.confidence, BELIEF_CONFIDENCE_CAP[sourceType])
  if (sourceType === old.sourceType && confidence === old.confidence) return null
  const normalisedAt = now.toISOString()
  const belief: BeliefV1 = { ...old, sourceType, confidence, normalisedAt }
  return {
    sourceMetadata: { ...row.sourceMetadata, belief },
    ops: [{
      step: RECHECK_STEP,
      op: 'feedback',
      before: { belief: { sourceType: old.sourceType, confidence: old.confidence, normalisedAt: old.normalisedAt ?? null } },
      after: { belief: { sourceType, confidence, normalisedAt }, normalised: true },
      reason: `${old.mind} belief normalised to its evidence: ${old.sourceType} → ${sourceType}, confidence ${old.confidence} → ${confidence}`,
    }],
  }
}

export interface RecheckDeps {
  find?: typeof findBeliefSupportLosses
  findNormalise?: typeof findBeliefsToNormalise
  origins?: typeof listMemoryOrigins
  mutate?: typeof mutateHeldBelief
  record?: typeof recordSurprise
}

export const SUPPORT_LOST_S = 0.4

// Surprise ledger (spec_surprise, gate observe/on): a written flag op is a
// support_lost event — ledger only, nothing opens. Never throws.
async function recordSupportLost(ctx: EngineRunContext, beliefId: string, written: readonly MemoryOpInput[], record: typeof recordSurprise): Promise<void> {
  const flag = written.find((o) => o.op === 'recheck')
  if (!flag) return
  const lost = (flag.after as { lostSources?: Array<{ id?: unknown }> } | undefined)?.lostSources ?? []
  const memoryIds = lost.map((s) => s.id).filter((id): id is string => typeof id === 'string')
  await record(ctx.userId, {
    key: `support_lost:${beliefId}:${[...memoryIds].sort().join(',')}`.slice(0, 200),
    kind: 'support_lost',
    s: SUPPORT_LOST_S,
    refs: { beliefIds: [beliefId], memoryIds },
  }, { now: ctx.now })
}

export class RecheckStep implements Step {
  readonly name = RECHECK_STEP

  constructor(private readonly deps: RecheckDeps = {}) {}

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const find = this.deps.find ?? findBeliefSupportLosses
    const mutate = this.deps.mutate ?? mutateHeldBelief
    const record = surpriseGateMode() === 'off' ? null : this.deps.record ?? recordSurprise
    const found = await find(ctx.userId, ctx.now, RECHECK_CAP)
    const tally: Record<string, number> = {}
    const errors: string[] = []
    let changed = 0
    let opsWritten = 0
    let stopped = false
    const count = (ops: readonly Pick<MemoryOpInput, 'op'>[]) => {
      for (const o of ops) tally[o.op] = (tally[o.op] ?? 0) + 1
    }
    for (const c of found) {
      if (outOfTime(ctx)) {
        stopped = true
        break
      }
      if (ctx.dryRun) {
        const m = planBeliefRecheck(c, c.probes, ctx.now)
        if (!m) continue
        for (const o of m.ops) ctx.changes.record({ ...o, memoryId: c.beliefId })
        count(m.ops)
        changed++
        continue
      }
      try {
        const written = await mutate(ctx.userId, c.beliefId, (row) => planBeliefRecheck(row, c.probes, ctx.now), ctx.runId, ctx.now)
        if (written.length === 0) continue
        count(written)
        opsWritten += written.length
        changed++
        if (record) await recordSupportLost(ctx, c.beliefId, written, record)
      } catch (err) {
        errors.push(`${c.beliefId}: ${errorMessage(err)}`)
      }
    }
    let normaliseFound = 0
    const budget = RECHECK_CAP - found.length
    if (!stopped && budget > 0 && outOfTime(ctx)) stopped = true
    if (!stopped && budget > 0) {
      const findNormalise = this.deps.findNormalise ?? findBeliefsToNormalise
      const origins = this.deps.origins ?? listMemoryOrigins
      const candidates = await findNormalise(ctx.userId, ctx.now, budget)
      normaliseFound = candidates.length
      for (const c of candidates) {
        if (outOfTime(ctx)) {
          stopped = true
          break
        }
        try {
          if (ctx.dryRun) {
            const b = readBelief(c.sourceMetadata)
            const m = b ? planNormalise(c, await origins(ctx.userId, b.provenance), ctx.now) : null
            if (!m) continue
            for (const o of m.ops) ctx.changes.record({ ...o, memoryId: c.beliefId })
            tally.normalised = (tally.normalised ?? 0) + 1
            changed++
            continue
          }
          const written = await mutate(ctx.userId, c.beliefId, (row, o) => planNormalise(row, o, ctx.now), ctx.runId, ctx.now, { withOrigins: true })
          if (written.length === 0) continue
          tally.normalised = (tally.normalised ?? 0) + 1
          opsWritten += written.length
          changed++
        } catch (err) {
          errors.push(`${c.beliefId}: ${errorMessage(err)}`)
        }
      }
    }
    const notes = [
      ctx.dryRun ? 'dry run' : null,
      `remapped=${tally.feedback ?? 0}`,
      `flagged=${tally.recheck ?? 0}`,
      `retired=${tally.retire ?? 0}`,
      `normalised=${tally.normalised ?? 0}`,
      errors.length ? `failed=${errors.length}` : null,
      stopped ? `out of time after ${changed + errors.length}/${found.length + normaliseFound}` : null,
    ].filter((n): n is string => n !== null)
    return {
      step: this.name,
      examined: found.length + normaliseFound,
      changed,
      notes,
      ...(ctx.dryRun ? {} : { opsWritten }),
      ...(errors.length ? { errors } : {}),
      ...(stopped ? { outOfTime: true } : {}),
    }
  }
}
