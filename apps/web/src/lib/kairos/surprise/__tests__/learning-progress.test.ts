import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('@/lib/data/kairos-surprise', () => ({ mutateKairosSurprise: vi.fn(), readKairosSurprise: vi.fn() }))

import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { mutateKairosSurprise, readKairosSurprise } from '@/lib/data/kairos-surprise'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import { emptySurpriseLedger } from '../ledger'
import {
  areaLearningProgress,
  computeLearningProgress,
  loadLpBias,
  lpBiasMap,
  refreshLearningProgress,
  topLearningProgress,
} from '../learning-progress'

const NOW = new Date('2026-10-03T09:00:00.000Z')
const DAY = 86_400_000

// outcomes oldest → newest: 'r' right / 'w' wrong, all at probability p.
function calls(outcomes: string, over: Partial<KairosPrediction> = {}, p = 0.8, lastAt = NOW.getTime() - DAY): KairosPrediction[] {
  return [...outcomes].map((o, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    seq: i + 1,
    claim: 'a claim long enough to be valid',
    probability: p,
    dueDate: '2026-09-01',
    topic: 'delivery',
    dominionId: null,
    basisIds: [],
    check: { kind: 'owner_verdict' },
    source: { kind: 'weekly_review', jobId: 'j' },
    createdAt: '2026-08-01T00:00:00.000Z',
    status: o === 'r' ? 'right' : 'wrong',
    settledAt: new Date(lastAt - (outcomes.length - 1 - i) * DAY).toISOString(),
    ...over,
  }) as KairosPrediction)
}

afterEach(() => {
  delete process.env.KAIROS_CURIOSITY_LP
  vi.clearAllMocks()
})

describe('learning progress metric', () => {
  it('sparse areas (n < 6) have no LP', () => {
    expect(areaLearningProgress(calls('wwrrr'), NOW)).toBeNull()
    expect(computeLearningProgress(calls('wwrrr'), NOW).areas).toEqual([])
  })

  it('falling error is positive LP; void / unresolved are ignored', () => {
    const area = areaLearningProgress([...calls('wwwrrr'), ...calls('ww', { status: 'void' })], NOW)
    // older Brier .64, newer .04
    expect(area).toEqual({ lp: 0.6, brierNew: 0.04, nNew: 3, nOld: 3 })
  })

  it('uses only the last 10 calls and halves LP when the newest is >30 days old', () => {
    const fresh = areaLearningProgress(calls('rrrrrrwwwwwrrrrr'), NOW)!
    expect(fresh.nOld + fresh.nNew).toBe(10)
    const stale = areaLearningProgress(calls('wwwrrr', {}, 0.8, NOW.getTime() - 40 * DAY), NOW)!
    expect(stale.lp).toBe(0.3)
  })

  it('ranks the improving area first and excludes noise (no trend) and decline', () => {
    const lp = computeLearningProgress([
      ...calls('rwrrwr', { dominionId: 'd-noise' }),
      ...calls('wwwrrr', { dominionId: 'd-learning' }),
      ...calls('rrrwww', { dominionId: 'd-worse' }),
      ...calls('wwwwrr', { topic: 'scope' }),
    ], NOW)
    expect(lp.areas[0]!.key).toBe('d-learning')
    expect(lp.areas.find((a) => a.key === 'd-noise')!.lp).toBe(0)
    const top = topLearningProgress(lp).map((a) => a.key)
    expect(top).toEqual(['d-learning', 'topic:scope'])
    const bias = lpBiasMap(lp)
    expect(bias.get('d-learning')).toBe(1)
    expect(bias.has('d-noise')).toBe(false)
    expect(bias.has('d-worse')).toBe(false)
  })
})

describe('learning progress reader', () => {
  it('off: no read, no write, no bias', async () => {
    expect(await refreshLearningProgress('u1', NOW)).toBeNull()
    expect(await loadLpBias('u1')).toBeUndefined()
    expect(readKairosPredictions).not.toHaveBeenCalled()
    expect(readKairosSurprise).not.toHaveBeenCalled()
  })

  it('observe: writes ledger.lp but gives no selection bias', async () => {
    process.env.KAIROS_CURIOSITY_LP = 'observe'
    vi.mocked(readKairosPredictions).mockResolvedValue({ v: 1, nextSeq: 7, open: [], closed: calls('wwwrrr', { dominionId: 'd1' }) })
    let stored: unknown = null
    vi.mocked(mutateKairosSurprise).mockImplementation(async (_u, mutate) => {
      stored = mutate(emptySurpriseLedger()).state
      return null as never
    })
    const lp = await refreshLearningProgress('u1', NOW)
    expect(lp?.areas[0]).toMatchObject({ key: 'd1', lp: 0.6 })
    expect(stored).toMatchObject({ lp: { computedAt: NOW.toISOString(), areas: [{ key: 'd1' }] } })
    expect(await loadLpBias('u1')).toBeUndefined()
  })

  it('a failing read never throws', async () => {
    process.env.KAIROS_CURIOSITY_LP = '1'
    vi.mocked(readKairosPredictions).mockRejectedValue(new Error('db down'))
    vi.mocked(readKairosSurprise).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshLearningProgress('u1', NOW)).toBeNull()
    expect(await loadLpBias('u1')).toBeUndefined()
    err.mockRestore()
  })
})
