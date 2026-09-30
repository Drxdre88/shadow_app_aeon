import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { STREAM_CLASSES } from '@/lib/kairos/streamClass'
import { defaultScorers } from '../scorers'
import { Standing, clamp01 } from '../standing'
import type { EngineMemory } from '../types'
import { NOW, daysAgo, makeMemory } from './fixtures'

const standing = new Standing(defaultScorers())

const memoryArb = fc.record({
  streamClass: fc.constantFrom(...STREAM_CLASSES, 'mystery'),
  pinned: fc.boolean(),
  useCount: fc.integer({ min: 0, max: 500 }),
  ageDays: fc.double({ min: 0, max: 3000, noNaN: true }),
  status: fc.constantFrom(undefined, 'pending', 'accepted'),
  positive: fc.integer({ min: 0, max: 50 }),
  negative: fc.integer({ min: 0, max: 50 }),
  supports: fc.integer({ min: 0, max: 50 }),
  challenges: fc.integer({ min: 0, max: 5 }),
})

type Arb = typeof memoryArb extends fc.Arbitrary<infer T> ? T : never

function build(a: Arb, overrides: Partial<EngineMemory> = {}): EngineMemory {
  return makeMemory({
    streamClass: a.streamClass,
    pinned: a.pinned,
    useCount: a.useCount,
    validAt: daysAgo(a.ageDays),
    sourceMetadata: {
      ...(a.status ? { status: a.status } : {}),
      engine: {
        outcome: { positive: a.positive, negative: a.negative },
        support: { independentSupports: a.supports, distinctDays: 1 },
      },
    },
    ...overrides,
  })
}

describe('Standing', () => {
  test.prop([memoryArb])('always lands in [0, 1]', (a) => {
    const s = standing.compute(build(a), { now: NOW, openChallenges: a.challenges }).standing
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })

  test.prop([memoryArb])('pinned is never below unpinned, all else equal', (a) => {
    const ctx = { now: NOW, openChallenges: a.challenges }
    const pinned = standing.compute(build(a, { pinned: true }), ctx).standing
    const unpinned = standing.compute(build(a, { pinned: false }), ctx).standing
    expect(pinned).toBeGreaterThanOrEqual(unpinned)
  })

  test.prop([memoryArb, fc.constantFrom('supersededAt', 'archivedAt', 'invalidAt')])(
    'retired rows score 0 with no factors',
    (a, field) => {
      const b = standing.compute(build(a, { [field]: daysAgo(1) }), { now: NOW })
      expect(b.standing).toBe(0)
      expect(b.factors).toEqual([])
    },
  )

  it('a future invalidAt is still live', () => {
    expect(standing.compute(makeMemory({ invalidAt: new Date(NOW.getTime() + 1000) }), { now: NOW }).standing).toBeGreaterThan(0)
  })

  it('is base × Π factors with the stream-class prior as base', () => {
    const fresh = makeMemory({ streamClass: 'idea' })
    const b = standing.compute(fresh, { now: NOW })
    expect(b.base).toBe(0.6)
    expect(b.standing).toBeCloseTo(0.6, 12)
    expect(standing.compute(makeMemory({ streamClass: 'mystery' }), { now: NOW }).base).toBe(0.5)
    expect(standing.compute(makeMemory({ streamClass: 'concept' }), { now: NOW }).base).toBe(0.75)
  })

  it('clamps an over-boosted reflection to 1', () => {
    const m = makeMemory({ streamClass: 'reflection', pinned: true, useCount: 10 })
    expect(standing.compute(m, { now: NOW }).standing).toBe(1)
  })

  it('clamp01 maps NaN to 0', () => {
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
  })
})
