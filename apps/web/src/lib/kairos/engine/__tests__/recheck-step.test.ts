import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/belief-recheck', () => ({ findBeliefSupportLosses: vi.fn(), findBeliefsToNormalise: vi.fn(async () => []), mutateHeldBelief: vi.fn() }))
vi.mock('@/lib/data/belief-inputs', () => ({ listMemoryOrigins: vi.fn() }))
vi.mock('@/lib/data/beliefs', () => ({}))
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))

import type { BeliefSupportCheck, BeliefMutation, ProvenanceProbe } from '@/lib/data/belief-recheck'
import type { LockedBelief } from '@/lib/data/beliefs'
import { readBelief, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import { BufferedChangeLog } from '../change-log'
import { RECHECK_CAP, RecheckStep, planBeliefRecheck, planNormalise } from '../steps/recheck'
import type { EngineRunContext, MemoryOpInput } from '../types'
import { NOW } from './fixtures'
import type { OriginKind } from '@/lib/kairos/origin'

function belief(over: Partial<BeliefV1> = {}): BeliefV1 {
  return {
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'Ship small', reasons: [], falsifier: 'x',
    sourceType: 'operator', provenance: ['a', 'b'], status: 'held', confidence: 0.8, ...over,
  }
}

function row(b: BeliefV1, extra: Record<string, unknown> = {}): LockedBelief {
  return {
    id: 'bel-1',
    sourceMetadata: { kind: 'belief', ...extra, belief: b },
    links: b.provenance.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' })),
    invalidAt: null,
  }
}

function check(b: BeliefV1, probes: ProvenanceProbe[], extra: Record<string, unknown> = {}): BeliefSupportCheck {
  return { beliefId: 'bel-1', ...row(b, extra), probes }
}

function ctx(over: Partial<EngineRunContext> = {}): EngineRunContext {
  return { userId: 'u', runId: 'run-1', now: NOW, dryRun: false, changes: new BufferedChangeLog('u', 'run-1'), ...over }
}

// Fake data layer: the step's decide runs against the CURRENT row, which the
// fake mutates exactly like the real tx would.
function fakeStore(initial: LockedBelief, origins: ReadonlyMap<string, OriginKind> = new Map()) {
  let current = initial
  const written: MemoryOpInput[] = []
  const mutate = vi.fn(async (_u: string, beliefId: string, decide: (r: LockedBelief, o: ReadonlyMap<string, OriginKind>) => BeliefMutation | null, _runId?: string | null, _now?: Date, _opts?: { withOrigins?: boolean }) => {
    const m = decide(current, origins)
    if (!m) return []
    current = { ...current, sourceMetadata: m.sourceMetadata, links: m.links ?? current.links, invalidAt: m.invalidAt !== undefined ? m.invalidAt : current.invalidAt }
    const ops = m.ops.map((o) => ({ ...o, memoryId: beliefId }))
    written.push(...ops)
    return ops
  })
  return { mutate, written, get: () => current }
}

describe('planBeliefRecheck', () => {
  it('a Merge is not a loss: remaps provenance + links to the survivor with a feedback op, no flag', () => {
    const m = planBeliefRecheck(row(belief()), [{ id: 'b', state: 'merged', survivorId: 'c' }], NOW)!
    const b = readBelief(m.sourceMetadata)!
    expect(b.provenance).toEqual(['a', 'c'])
    expect(b.recheck).toBeUndefined()
    expect(b.confidence).toBe(0.8)
    expect((m.links as Array<{ target: string }>).map((l) => l.target)).toEqual(['a', 'c'])
    expect(m.ops).toEqual([expect.objectContaining({
      step: 'recheck', op: 'feedback',
      before: expect.objectContaining({ belief: { provenance: ['a', 'b'] } }),
      after: expect.objectContaining({ belief: { provenance: ['a', 'c'] }, remapped: [{ from: 'b', to: 'c' }] }),
    })])
  })

  it('a merge into a source the belief already cites dedupes provenance', () => {
    const m = planBeliefRecheck(row(belief()), [{ id: 'b', state: 'merged', survivorId: 'a' }], NOW)!
    expect(readBelief(m.sourceMetadata)!.provenance).toEqual(['a'])
    expect((m.links as unknown[]).length).toBe(1)
  })

  it('a real loss flags and penalises with before/after snapshots', () => {
    const m = planBeliefRecheck(row(belief()), [{ id: 'b', state: 'archived', survivorId: null }], NOW)!
    const b = readBelief(m.sourceMetadata)!
    expect(b.recheck).toEqual({ since: NOW.toISOString(), lostSources: [{ id: 'b', state: 'archived' }] })
    expect(b.confidence).toBeCloseTo(0.56)
    expect(m.invalidAt).toBeUndefined()
    expect(m.ops).toEqual([expect.objectContaining({
      op: 'recheck',
      before: { belief: { confidence: 0.8, recheck: null } },
      after: expect.objectContaining({ belief: { confidence: b.confidence, recheck: b.recheck }, lostSources: [{ id: 'b', state: 'archived' }] }),
    })])
  })

  it('merge and loss together: one remap op and one recheck op', () => {
    const m = planBeliefRecheck(row(belief()), [
      { id: 'a', state: 'merged', survivorId: 'a2' },
      { id: 'b', state: 'missing', survivorId: null },
    ], NOW)!
    expect(m.ops.map((o) => o.op)).toEqual(['feedback', 'recheck'])
    expect(readBelief(m.sourceMetadata)!.provenance).toEqual(['a2', 'b'])
  })

  it('an own belief whose only provenance is gone is retired (op retire, revertable)', () => {
    const own = belief({ mind: 'own', sourceType: 'inference', provenance: ['p'], confidence: 0.6 })
    const m = planBeliefRecheck(row(own), [{ id: 'p', state: 'invalidated', survivorId: null }], NOW)!
    expect(m.invalidAt).toEqual(NOW)
    expect(m.supersededAt).toBeNull()
    expect(readBelief(m.sourceMetadata)!.status).toBe('retired')
    expect(m.ops).toEqual([expect.objectContaining({
      op: 'retire',
      before: { invalidAt: null, supersededAt: null, belief: { status: 'held', recheck: null } },
      after: expect.objectContaining({ invalidAt: NOW.toISOString(), supersededAt: null }),
    })])
  })

  it('an own belief with a vetoed retire is only flagged', () => {
    const own = belief({ mind: 'own', sourceType: 'inference', provenance: ['p'], confidence: 0.6 })
    const m = planBeliefRecheck(row(own, { engine: { vetoes: { retire: { opId: 'x', at: 'y' } } } }), [{ id: 'p', state: 'missing', survivorId: null }], NOW)!
    expect(m.ops.map((o) => o.op)).toEqual(['recheck'])
  })

  it('a source acknowledged by a reverted recheck is not re-flagged', () => {
    const m = planBeliefRecheck(row(belief(), { engine: { vetoes: { recheck: { opId: 'x', at: 'y', lostSources: ['b'] } } } }), [{ id: 'b', state: 'archived', survivorId: null }], NOW)
    expect(m).toBeNull()
  })
})

describe('RecheckStep', () => {
  it('flags and penalises once; a second night with the same loss changes nothing (idempotent)', async () => {
    const store = fakeStore(row(belief()))
    const probes: ProvenanceProbe[] = [{ id: 'b', state: 'missing', survivorId: null }]
    const find = vi.fn(async () => [check(readBelief(store.get().sourceMetadata)!, probes)])
    const step = new RecheckStep({ find, mutate: store.mutate as never })

    const first = await step.run(ctx())
    expect(find).toHaveBeenCalledWith('u', NOW, RECHECK_CAP)
    expect(RECHECK_CAP).toBe(200)
    expect(first).toMatchObject({ step: 'recheck', examined: 1, changed: 1, opsWritten: 1 })
    expect(first.notes).toContain('flagged=1')
    expect(readBelief(store.get().sourceMetadata)!.confidence).toBeCloseTo(0.56)

    const second = await step.run(ctx())
    expect(second).toMatchObject({ changed: 0, opsWritten: 0 })
    expect(readBelief(store.get().sourceMetadata)!.confidence).toBeCloseTo(0.56)
    expect(store.written.filter((o) => o.op === 'recheck')).toHaveLength(1)
  })

  it('passes the run id and now to the data layer', async () => {
    const store = fakeStore(row(belief()))
    const step = new RecheckStep({ find: vi.fn(async () => [check(belief(), [{ id: 'b', state: 'missing', survivorId: null }])]), mutate: store.mutate as never })
    await step.run(ctx())
    expect(store.mutate.mock.calls[0][3]).toBe('run-1')
    expect(store.mutate.mock.calls[0][4]).toBe(NOW)
  })

  it('dry run records the ops it would write and mutates nothing', async () => {
    const store = fakeStore(row(belief()))
    const c = ctx({ dryRun: true })
    const res = await new RecheckStep({
      find: vi.fn(async () => [check(belief(), [{ id: 'b', state: 'merged', survivorId: 'c' }, { id: 'a', state: 'archived', survivorId: null }])]),
      mutate: store.mutate as never,
    }).run(c)
    expect(store.mutate).not.toHaveBeenCalled()
    expect(c.changes.pending().map((o) => [o.memoryId, o.op])).toEqual([['bel-1', 'feedback'], ['bel-1', 'recheck']])
    expect(res).toMatchObject({ changed: 1 })
    expect(res.opsWritten).toBeUndefined()
  })

  it('stops starting mutations once the deadline passed', async () => {
    const store = fakeStore(row(belief()))
    const res = await new RecheckStep({
      find: vi.fn(async () => [check(belief(), [{ id: 'b', state: 'missing', survivorId: null }])]),
      mutate: store.mutate as never,
    }).run(ctx({ deadline: 0 }))
    expect(store.mutate).not.toHaveBeenCalled()
    expect(res.outOfTime).toBe(true)
  })

  it('surfaces a per-belief failure as a step error and continues', async () => {
    const mutate = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([{ op: 'recheck' }])
    const res = await new RecheckStep({
      find: vi.fn(async () => [
        { ...check(belief(), [{ id: 'b', state: 'missing', survivorId: null }]), beliefId: 'bad' },
        check(belief(), [{ id: 'b', state: 'missing', survivorId: null }]),
      ]),
      mutate: mutate as never,
    }).run(ctx())
    expect(res.errors).toEqual(['bad: boom'])
    expect(res.changed).toBe(1)
  })
})

describe('normalisation of legacy beliefs', () => {
  const kairosOnly = new Map<string, OriginKind>([['a', 'kairos'], ['b', 'kairos']])
  const legacy = () => belief({ sourceType: 'operator', confidence: 0.9 })
  const cand = (b: BeliefV1, extra: Record<string, unknown> = {}) => ({ beliefId: 'bel-1', ...row(b, extra) })

  it('a legacy "operator" belief resting only on Kairos-origin rows becomes inference, capped at 0.6', () => {
    const m = planNormalise(row(legacy()), kairosOnly, NOW)!
    expect(readBelief(m.sourceMetadata)).toMatchObject({ sourceType: 'inference', confidence: 0.6, normalisedAt: NOW.toISOString() })
    expect(m.ops).toEqual([expect.objectContaining({
      step: 'recheck', op: 'feedback',
      before: { belief: { sourceType: 'operator', confidence: 0.9, normalisedAt: null } },
      after: { belief: { sourceType: 'inference', confidence: 0.6, normalisedAt: NOW.toISOString() }, normalised: true },
    })])
  })

  it('a fresh own belief citing operator reflections is untouched (own mind stays inference)', () => {
    const own = belief({ mind: 'own', sourceType: 'inference', confidence: 0.6, provenance: ['prop', 'refl'] })
    expect(planNormalise(row(own), new Map([['prop', 'kairos'], ['refl', 'operator']]), NOW)).toBeNull()
  })

  it('a legacy own belief labelled operator goes to inference, capped at 0.6', () => {
    const own = belief({ mind: 'own', sourceType: 'operator', confidence: 0.9, provenance: ['prop', 'refl'] })
    const m = planNormalise(row(own), new Map([['prop', 'kairos'], ['refl', 'operator']]), NOW)!
    expect(readBelief(m.sourceMetadata)).toMatchObject({ mind: 'own', sourceType: 'inference', confidence: 0.6 })
  })

  it('never raises confidence; an upgrade only changes sourceType', () => {
    const m = planNormalise(row(belief({ sourceType: 'tool', confidence: 0.3 })), new Map([['a', 'operator']]), NOW)!
    expect(readBelief(m.sourceMetadata)).toMatchObject({ sourceType: 'operator', confidence: 0.3 })
  })

  it('leaves an already-correct belief (and a vetoed one) untouched', () => {
    expect(planNormalise(row(belief({ sourceType: 'operator', confidence: 0.9 })), new Map([['a', 'operator']]), NOW)).toBeNull()
    expect(planNormalise(row(belief({ sourceType: 'inference', confidence: 0.5 })), kairosOnly, NOW)).toBeNull()
    expect(planNormalise(row(legacy(), { engine: { vetoes: { normalise: { opId: 'x', at: 'y' } } } }), kairosOnly, NOW)).toBeNull()
  })

  it('the step normalises with origins read in the tx, once (idempotent), and reports it', async () => {
    const store = fakeStore(row(legacy()), kairosOnly)
    const findNormalise = vi.fn(async () => [cand(readBelief(store.get().sourceMetadata)!)])
    const step = new RecheckStep({ find: vi.fn(async () => []), findNormalise, mutate: store.mutate as never })
    const first = await step.run(ctx())
    expect(store.mutate.mock.calls[0][5]).toEqual({ withOrigins: true })
    expect(first).toMatchObject({ changed: 1, opsWritten: 1 })
    expect(first.notes).toContain('normalised=1')
    expect(readBelief(store.get().sourceMetadata)).toMatchObject({ sourceType: 'inference', confidence: 0.6 })
    const second = await step.run(ctx())
    expect(second).toMatchObject({ changed: 0, opsWritten: 0 })
    expect(store.written).toHaveLength(1)
  })

  it('shares the 200 budget with losses, which go first', async () => {
    const losses = Array.from({ length: 150 }, () => check(belief(), []))
    const findNormalise = vi.fn(async () => [])
    await new RecheckStep({ find: vi.fn(async () => losses), findNormalise, mutate: vi.fn(async () => []) as never }).run(ctx())
    expect(findNormalise).toHaveBeenCalledWith('u', NOW, 50)
    const full = Array.from({ length: 200 }, () => check(belief(), []))
    const none = vi.fn(async () => [])
    await new RecheckStep({ find: vi.fn(async () => full), findNormalise: none, mutate: vi.fn(async () => []) as never }).run(ctx())
    expect(none).not.toHaveBeenCalled()
  })

  it('dry run records the op without writing', async () => {
    const mutate = vi.fn()
    const origins = vi.fn(async () => kairosOnly)
    const c = ctx({ dryRun: true })
    const res = await new RecheckStep({ find: vi.fn(async () => []), findNormalise: vi.fn(async () => [cand(legacy())]), origins, mutate: mutate as never }).run(c)
    expect(mutate).not.toHaveBeenCalled()
    expect(origins).toHaveBeenCalledWith('u', ['a', 'b'])
    expect(c.changes.pending()).toEqual([expect.objectContaining({ memoryId: 'bel-1', op: 'feedback', after: expect.objectContaining({ normalised: true }) })])
    expect(res).toMatchObject({ changed: 1 })
  })

  it('stops at the deadline before normalising', async () => {
    const findNormalise = vi.fn(async () => [cand(legacy())])
    const mutate = vi.fn()
    const res = await new RecheckStep({ find: vi.fn(async () => []), findNormalise, mutate: mutate as never }).run(ctx({ deadline: 0 }))
    expect(mutate).not.toHaveBeenCalled()
    expect(findNormalise).not.toHaveBeenCalled()
    expect(res.outOfTime).toBe(true)
  })
})
