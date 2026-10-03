import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/constitution-drift', () => ({ findLatestConscienceRun: vi.fn() }))
vi.mock('@/lib/data/surprise-gate', () => ({ listPressuredBeliefs: vi.fn(), clearSurprisePressure: vi.fn(), pruneSurpriseMarks: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))

import { BufferedChangeLog } from '../change-log'
import { SurpriseStep, contradictionPairs } from '../steps/surprise'
import type { EngineRunContext } from '../types'
import { emptySurpriseLedger } from '@/lib/kairos/surprise/ledger'
import { NOW } from './fixtures'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const RUN = 'cccccccc-0000-4000-8000-00000000000c'

function ctx(over: Partial<EngineRunContext> = {}): EngineRunContext {
  return { userId: 'u', runId: 'run-1', now: NOW, dryRun: false, changes: new BufferedChangeLog('u', 'run-1'), ...over }
}

function deps(over: Record<string, unknown> = {}) {
  return {
    latestConscience: vi.fn(async () => ({ id: RUN, createdAt: new Date(NOW.getTime() - 3_600_000), sourceMetadata: { conscience: { contradictions: { checked: 2, found: 1, ids: [[A, B]], reasons: ['x'] } } } })),
    pressured: vi.fn(async () => ['p-1']),
    clearPressure: vi.fn(async () => 1),
    prune: vi.fn(async () => 3),
    open: vi.fn(async (_u: string, ids: readonly string[]) => [...ids]),
    record: vi.fn(async () => null),
    ledger: vi.fn(async () => emptySurpriseLedger()),
    ...over,
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('SurpriseStep', () => {
  it('is skipped (no reads) with the gate off', async () => {
    const d = deps()
    const res = await new SurpriseStep(d).run(ctx())
    expect(res).toMatchObject({ step: 'surprise', examined: 0, changed: 0, skipped: expect.stringContaining('off') })
    expect(d.pressured).not.toHaveBeenCalled()
    expect(d.prune).not.toHaveBeenCalled()
  })

  it('without the contradictions sub-flag: pressure valve + prune only, never reads conscience', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    const d = deps()
    const res = await new SurpriseStep(d).run(ctx())
    expect(d.latestConscience).not.toHaveBeenCalled()
    expect(d.pressured).toHaveBeenCalledWith('u', NOW, { min: 2, windowMs: 14 * 86_400_000, limit: 20 })
    expect(d.open).toHaveBeenCalledWith('u', ['p-1'], { kind: 'pressure', ref: 'p-1', s: 0.4 }, NOW)
    expect(d.clearPressure).toHaveBeenCalledWith('u', ['p-1'])
    expect(d.prune).toHaveBeenCalledWith('u', NOW, 14 * 86_400_000)
    expect(res.notes).toEqual(['contradictions_opened=0', 'pressure_opened=1', 'pruned=3'])
    expect(res.opsWritten).toBe(0)
  })

  it('with KAIROS_SURPRISE_CONTRADICTIONS: opens both beliefs of a recent pair once (s .5)', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', 'observe')
    vi.stubEnv('KAIROS_SURPRISE_CONTRADICTIONS', '1')
    const d = deps({ pressured: vi.fn(async () => []) })
    await new SurpriseStep(d).run(ctx())
    expect(d.open).toHaveBeenCalledWith('u', [A, B], { kind: 'contradiction', ref: RUN, s: 0.5 }, NOW)
    expect(d.record).toHaveBeenCalledWith('u', expect.objectContaining({ key: `contradiction:${RUN}:${A}:${B}`, kind: 'contradiction', s: 0.5, opened: [A, B] }), { now: NOW })

    const seen = { ...emptySurpriseLedger(), seen: [`contradiction:${RUN}:${A}:${B}`] }
    const again = deps({ pressured: vi.fn(async () => []), ledger: vi.fn(async () => seen) })
    await new SurpriseStep(again).run(ctx())
    expect(again.open).not.toHaveBeenCalled()
  })

  it('ignores a stale conscience run', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    vi.stubEnv('KAIROS_SURPRISE_CONTRADICTIONS', '1')
    const d = deps({
      pressured: vi.fn(async () => []),
      latestConscience: vi.fn(async () => ({ id: RUN, createdAt: new Date(NOW.getTime() - 5 * 86_400_000), sourceMetadata: { conscience: { contradictions: { ids: [[A, B]] } } } })),
    })
    await new SurpriseStep(d).run(ctx())
    expect(d.open).not.toHaveBeenCalled()
  })

  it('a failing section is reported, the rest still runs', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    const d = deps({ pressured: vi.fn(async () => { throw new Error('db down') }) })
    const res = await new SurpriseStep(d).run(ctx())
    expect(res.errors).toEqual(['pressure: db down'])
    expect(d.prune).toHaveBeenCalled()
  })

  it('stops starting new work past the deadline', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    const d = deps()
    const res = await new SurpriseStep(d).run(ctx({ deadline: 0 }))
    expect(res.outOfTime).toBe(true)
    expect(d.prune).not.toHaveBeenCalled()
  })

  it('a dry run touches nothing', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    const d = deps()
    await new SurpriseStep(d).run(ctx({ dryRun: true }))
    expect(d.pressured).not.toHaveBeenCalled()
  })
})

describe('contradictionPairs', () => {
  it('reads [a,b] id pairs from a conscience section, tolerating junk', () => {
    expect(contradictionPairs({ conscience: { contradictions: { ids: [[A, B], [A], [A, A], 'x', [1, 2]] } } })).toEqual([[A, B]])
    expect(contradictionPairs({ conscience: { contradictions: null } })).toEqual([])
    expect(contradictionPairs(null)).toEqual([])
  })
})
