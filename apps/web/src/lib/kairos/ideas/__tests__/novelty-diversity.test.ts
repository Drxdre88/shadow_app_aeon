import { describe, expect, it, vi } from 'vitest'
import { test, fc } from '@fast-check/vitest'

vi.mock('@/lib/data/ideas', () => ({ listSurvivorEmbeddingsBetween: vi.fn() }))

import { listSurvivorEmbeddingsBetween } from '@/lib/data/ideas'
import { classifyNovelty, noveltyClassFor } from '../novelty'
import { meanPairwiseCosineDistance, weeklyIdeaDiversity } from '../diversity'
import { DIVERSITY_ALARM_DISTANCE, NOVELTY_BORDERLINE_COSINE, NOVELTY_REPEAT_COSINE } from '../types'

describe('classifyNovelty', () => {
  it('is novel with null nearest fields when there are no neighbours', () => {
    expect(classifyNovelty([])).toEqual({ class: 'novel', maxCosine: 0, nearestId: null, nearestKind: null })
  })

  it('classifies at the exact boundaries', () => {
    expect(noveltyClassFor(NOVELTY_REPEAT_COSINE)).toBe('repeat')
    expect(noveltyClassFor(NOVELTY_REPEAT_COSINE - 1e-9)).toBe('borderline')
    expect(noveltyClassFor(NOVELTY_BORDERLINE_COSINE)).toBe('borderline')
    expect(noveltyClassFor(NOVELTY_BORDERLINE_COSINE - 1e-9)).toBe('novel')
    expect(noveltyClassFor(1)).toBe('repeat')
    expect(noveltyClassFor(-0.5)).toBe('novel')
  })

  it('uses the most similar neighbour regardless of order and skips non-finite scores', () => {
    const res = classifyNovelty([
      { id: 'b1', kind: 'belief', similarity: 0.5 },
      { id: 'x', kind: 'proposal', similarity: Number.NaN },
      { id: 'i1', kind: 'idea', similarity: 0.85 },
      { id: 'p1', kind: 'proposal', similarity: 0.7 },
    ])
    expect(res).toEqual({ class: 'borderline', maxCosine: 0.85, nearestId: 'i1', nearestKind: 'idea' })
  })

  it('flags a repeat against a held belief', () => {
    expect(classifyNovelty([{ id: 'b', kind: 'belief', similarity: 0.9 }]).class).toBe('repeat')
  })
})

const vecArb = (dim: number) =>
  fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: dim, maxLength: dim })
    .filter((v) => v.some((x) => Math.abs(x) > 1e-3))

describe('meanPairwiseCosineDistance', () => {
  it('is null below two vectors', () => {
    expect(meanPairwiseCosineDistance([])).toBeNull()
    expect(meanPairwiseCosineDistance([[1, 0]])).toBeNull()
  })

  it('computes the mean of 1 − cos over unordered pairs', () => {
    // pairs: (a,b)=1−0=1, (a,c)=1−1=0, (b,c)=1 → mean 2/3
    expect(meanPairwiseCosineDistance([[1, 0], [0, 1], [2, 0]])).toBeCloseTo(2 / 3, 12)
    expect(meanPairwiseCosineDistance([[1, 0], [-1, 0]])).toBeCloseTo(2, 12)
  })

  it('skips zero vectors (cosine undefined)', () => {
    expect(meanPairwiseCosineDistance([[0, 0], [1, 0]])).toBeNull()
    expect(meanPairwiseCosineDistance([[0, 0], [1, 0], [0, 1]])).toBeCloseTo(1, 12)
  })

  test.prop([fc.array(vecArb(6), { minLength: 2, maxLength: 8 })])('stays within [0, 2]', (vs) => {
    const d = meanPairwiseCosineDistance(vs)!
    expect(d).toBeGreaterThanOrEqual(-1e-9)
    expect(d).toBeLessThanOrEqual(2 + 1e-9)
  })

  test.prop([fc.array(vecArb(5), { minLength: 2, maxLength: 7 }), fc.double({ min: 0.01, max: 100, noNaN: true })])(
    'is invariant to scaling and order',
    (vs, k) => {
      const base = meanPairwiseCosineDistance(vs)!
      expect(meanPairwiseCosineDistance(vs.map((v) => v.map((x) => x * k)))!).toBeCloseTo(base, 9)
      expect(meanPairwiseCosineDistance([...vs].reverse())!).toBeCloseTo(base, 9)
    },
  )

  test.prop([vecArb(8), fc.integer({ min: 2, max: 6 })])('is 0 for copies of one vector', (v, n) => {
    expect(meanPairwiseCosineDistance(Array.from({ length: n }, () => v))!).toBeCloseTo(0, 9)
  })
})

describe('weeklyIdeaDiversity', () => {
  const NOW = new Date('2026-10-08T12:00:00Z')

  it('reads the trailing 7 days and raises the alarm on collapse with ≥ 3 survivors', async () => {
    vi.mocked(listSurvivorEmbeddingsBetween).mockResolvedValueOnce([
      { id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [1, 0.01] }, { id: 'c', embedding: [1, 0.02] },
    ])
    const res = await weeklyIdeaDiversity('u', NOW)
    expect(listSurvivorEmbeddingsBetween).toHaveBeenCalledWith('u', new Date('2026-10-01T12:00:00Z'), NOW)
    expect(res.survivors).toBe(3)
    expect(res.meanDistance!).toBeLessThan(DIVERSITY_ALARM_DISTANCE)
    expect(res).toMatchObject({ alarm: true, weekStart: '2026-10-01' })
  })

  it('does not alarm with fewer than 3 survivors or diverse ones', async () => {
    vi.mocked(listSurvivorEmbeddingsBetween).mockResolvedValueOnce([{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [1, 0] }])
    expect((await weeklyIdeaDiversity('u', NOW)).alarm).toBe(false)
    vi.mocked(listSurvivorEmbeddingsBetween).mockResolvedValueOnce([
      { id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0, 1] }, { id: 'c', embedding: [-1, 0] },
    ])
    const res = await weeklyIdeaDiversity('u', NOW)
    expect(res.alarm).toBe(false)
    expect(res.meanDistance).toBeGreaterThan(DIVERSITY_ALARM_DISTANCE)
  })

  it('reports null distance and no alarm for an empty week', async () => {
    vi.mocked(listSurvivorEmbeddingsBetween).mockResolvedValueOnce([])
    expect(await weeklyIdeaDiversity('u', NOW)).toEqual({ survivors: 0, meanDistance: null, alarm: false, weekStart: '2026-10-01' })
  })
})
