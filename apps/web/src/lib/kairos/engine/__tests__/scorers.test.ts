import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import {
  ChallengedScorer,
  FreshnessScorer,
  OutcomeScorer,
  SourceTrustScorer,
  SupportScorer,
  UsageScorer,
  defaultScorers,
} from '../scorers'
import { FRESHNESS_HALF_LIFE_DAYS, freshnessFactor, halfLifeDays } from '../scorers/freshness'
import { NOW, daysAgo, makeMemory } from './fixtures'

const ctx = { now: NOW }

describe('FreshnessScorer', () => {
  const freshness = new FreshnessScorer()

  test.prop([
    fc.double({ min: 0, max: 5000, noNaN: true }),
    fc.double({ min: 0, max: 5000, noNaN: true }),
    fc.constantFrom(...Object.keys(FRESHNESS_HALF_LIFE_DAYS), 'advisory', 'unknown'),
  ])('is monotone non-increasing in age and stays in [0.5, 1]', (a, b, streamClass) => {
    const [young, old] = a <= b ? [a, b] : [b, a]
    const fy = freshness.score(makeMemory({ streamClass, validAt: daysAgo(young) }), ctx).factor
    const fo = freshness.score(makeMemory({ streamClass, validAt: daysAgo(old) }), ctx).factor
    expect(fo).toBeLessThanOrEqual(fy)
    expect(fo).toBeGreaterThanOrEqual(0.5)
    expect(fy).toBeLessThanOrEqual(1)
  })

  test.prop([fc.constantFrom(...Object.keys(FRESHNESS_HALF_LIFE_DAYS))])(
    'gives exactly 0.75 at one half-life for every class',
    (streamClass) => {
      const m = makeMemory({ streamClass, validAt: daysAgo(halfLifeDays(streamClass)) })
      expect(freshness.score(m, ctx).factor).toBeCloseTo(0.75, 12)
    },
  )

  it('uses the spec half-lives', () => {
    expect(FRESHNESS_HALF_LIFE_DAYS).toMatchObject({
      agentic: 21, execution: 21, idea: 30, delta: 7, snapshot: 7,
      cortex: 30, archetype: 30, aether: 30, concept: 120, reflection: 365,
    })
  })

  it('ages from the later of validAt and lastUsedAt', () => {
    const stale = makeMemory({ validAt: daysAgo(300) })
    const used = makeMemory({ validAt: daysAgo(300), lastUsedAt: daysAgo(0) })
    const oldUse = makeMemory({ validAt: daysAgo(30), lastUsedAt: daysAgo(300) })
    expect(freshness.score(used, ctx).factor).toBe(1)
    expect(freshness.score(stale, ctx).factor).toBeLessThan(0.51)
    expect(freshness.score(oldUse, ctx).factor).toBeCloseTo(0.75, 12)
  })

  it('treats future dates as age 0', () => {
    expect(freshnessFactor(-10, 30)).toBe(1)
  })
})

describe('UsageScorer', () => {
  const usage = new UsageScorer()

  test.prop([fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })])(
    'is monotone in useCount and capped at 1.3',
    (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const flo = usage.score(makeMemory({ useCount: lo })).factor
      const fhi = usage.score(makeMemory({ useCount: hi })).factor
      expect(fhi).toBeGreaterThanOrEqual(flo)
      expect(fhi).toBeLessThanOrEqual(1.3 + 1e-12)
      expect(flo).toBeGreaterThanOrEqual(1)
    },
  )

  it('is 1 + 0.05·min(useCount, 6)', () => {
    expect(usage.score(makeMemory({ useCount: 2 })).factor).toBeCloseTo(1.1)
    expect(usage.score(makeMemory({ useCount: 60 })).factor).toBeCloseTo(1.3)
  })
})

describe('OutcomeScorer', () => {
  const outcome = new OutcomeScorer()

  test.prop([fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })])(
    'never drops below the 0.5 floor',
    (positive, negative) => {
      expect(outcome.score(makeMemory(), { now: NOW, outcome: { positive, negative } }).factor).toBeGreaterThanOrEqual(0.5)
    },
  )

  it('reads sourceMetadata.engine.outcome when ctx has none; ctx wins otherwise', () => {
    const m = makeMemory({ sourceMetadata: { engine: { outcome: { positive: 2, negative: 0 } } } })
    expect(outcome.score(m, ctx).factor).toBeCloseTo(1.3)
    expect(outcome.score(m, { now: NOW, outcome: { positive: 0, negative: 1 } }).factor).toBeCloseTo(0.8)
    expect(outcome.score(makeMemory({ sourceMetadata: { engine: { outcome: { negative: 9 } } } }), ctx).factor).toBe(0.5)
    expect(outcome.score(makeMemory(), ctx).factor).toBe(1)
  })
})

describe('SupportScorer', () => {
  const support = new SupportScorer()

  it('reads ctx.support, else sourceMetadata.engine.support, capped at 5', () => {
    const m = makeMemory({ sourceMetadata: { engine: { support: { independentSupports: 3, distinctDays: 2 } } } })
    expect(support.score(m, ctx).factor).toBeCloseTo(1.3)
    expect(support.score(m, { now: NOW, support: { independentSupports: 40, distinctDays: 9 } }).factor).toBeCloseTo(1.5)
    expect(support.score(makeMemory({ sourceMetadata: { engine: { support: 'junk' } } }), ctx).factor).toBe(1)
  })
})

describe('SourceTrustScorer', () => {
  const trust = new SourceTrustScorer()

  it('applies pinned, reflection and pending-proposal factors', () => {
    expect(trust.score(makeMemory()).factor).toBe(1)
    expect(trust.score(makeMemory({ pinned: true })).factor).toBeCloseTo(1.25)
    expect(trust.score(makeMemory({ streamClass: 'reflection' })).factor).toBeCloseTo(1.15)
    expect(trust.score(makeMemory({ sourceMetadata: { status: 'pending' } })).factor).toBeCloseTo(0.6)
    expect(trust.score(makeMemory({ sourceMetadata: { status: 'accepted' } })).factor).toBe(1)
  })
})

describe('ChallengedScorer', () => {
  const challenged = new ChallengedScorer()

  it('is 0.8 with any open challenge, else 1', () => {
    expect(challenged.score(makeMemory(), ctx).factor).toBe(1)
    expect(challenged.score(makeMemory(), { now: NOW, openChallenges: 0 }).factor).toBe(1)
    expect(challenged.score(makeMemory(), { now: NOW, openChallenges: 3 }).factor).toBe(0.8)
  })
})

describe('defaultScorers', () => {
  it('returns one of each scorer with unique names', () => {
    const names = defaultScorers().map((s) => s.name)
    expect(names).toEqual(['source_trust', 'freshness', 'usage', 'support', 'outcome', 'challenged'])
  })
})
