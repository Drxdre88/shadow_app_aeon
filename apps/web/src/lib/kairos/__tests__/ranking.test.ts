import { describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { confidenceBoost } from '../confidence'
import { recencyMultiplier } from '@/lib/data/memories'
import { rankRows, rankScore, scoreRows, standingFactor, type RankableRow } from '../ranking'

const NOW = Date.parse('2026-09-30T12:00:00Z')
const DAY = 86_400_000
const daysAgo = (d: number) => new Date(NOW - d * DAY)

// The P0 composite, written out independently of ranking.ts.
function p0(relevance: number, r: RankableRow): number {
  return relevance
    * confidenceBoost({ confidence: r.confidence, updatedAt: r.updatedAt, pinned: r.pinned }, NOW)
    * recencyMultiplier(r.createdAt, NOW)
}

type Row = RankableRow & { id: string; rel: number }

const rowArb: fc.Arbitrary<Row> = fc.record({
  id: fc.uuid(),
  rel: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  createdAt: fc.option(fc.integer({ min: 0, max: 400 }).map(daysAgo), { nil: null }),
  updatedAt: fc.option(fc.integer({ min: 0, max: 400 }).map(daysAgo), { nil: null }),
  pinned: fc.boolean(),
  standing: fc.constant(null),
})

describe('standingFactor', () => {
  it('scored row: 0.5 + standing, ignoring confidence and recency', () => {
    const fresh = { standing: 0.8, confidence: 0.1, createdAt: daysAgo(0), updatedAt: daysAgo(0) }
    const stale = { standing: 0.8, confidence: 0.9, createdAt: daysAgo(300), updatedAt: daysAgo(300) }
    expect(standingFactor(fresh, NOW)).toBeCloseTo(1.3, 12)
    expect(standingFactor(stale, NOW)).toBeCloseTo(1.3, 12)
    expect(standingFactor({ standing: 0 }, NOW)).toBe(0.5)
  })

  it('unscored row (standing NULL/undefined) is exactly the P0 confidence × recency', () => {
    const r = { standing: null, confidence: 0.9, createdAt: daysAgo(3), updatedAt: daysAgo(10), pinned: false }
    expect(standingFactor(r, NOW)).toBeCloseTo(p0(1, r), 12)
    expect(standingFactor({ createdAt: daysAgo(1) }, NOW)).toBeCloseTo(recencyMultiplier(daysAgo(1), NOW), 12)
  })

  it('a non-finite standing is treated as unscored', () => {
    const r = { standing: Number.NaN, confidence: 0.6, createdAt: daysAgo(2), updatedAt: daysAgo(2) }
    expect(standingFactor(r, NOW)).toBeCloseTo(p0(1, r), 12)
  })

  it('a high-trust concept outranks an equally relevant agentic row once scored', () => {
    const concept = { standing: 0.75 }
    const agentic = { standing: 0.45 }
    expect(rankScore(0.5, concept, NOW)).toBeGreaterThan(rankScore(0.5, agentic, NOW))
  })
})

describe('rankRows — P0 regression (standing NULL everywhere)', () => {
  it('ordering and scores are identical to the P0 formula', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 30 }), (rows) => {
        const ranked = scoreRows(rows, (r) => r.rel, { now: NOW })
        const expected = rows
          .map((r) => ({ id: r.id, score: p0(r.rel, r) }))
          .sort((a, b) => b.score - a.score)
        expect(ranked.map((r) => r.score)).toEqual(expected.map((e) => expect.closeTo(e.score, 12)))
        // Order: identical to P0 whenever P0 has no float-level near-ties.
        const distinct = expected.every((e, i) => i === 0 || expected[i - 1].score - e.score > 1e-9)
        if (distinct) expect(ranked.map((r) => r.row.id)).toEqual(expected.map((e) => e.id))
      }),
    )
  })

  it('tier partitions before score; tieBreak only decides exact ties; else stable', () => {
    const rows: Array<Row & { streamClass: string }> = [
      { id: 'idea-hi', rel: 0.9, streamClass: 'idea', createdAt: daysAgo(0) },
      { id: 'refl-lo', rel: 0.1, streamClass: 'reflection', createdAt: daysAgo(0) },
      { id: 'idea-a', rel: 0.5, streamClass: 'idea', createdAt: daysAgo(5) },
      { id: 'idea-b', rel: 0.5, streamClass: 'idea', createdAt: daysAgo(5) },
    ]
    const isRefl = (r: { streamClass: string }) => (r.streamClass === 'reflection' ? 1 : 0)

    expect(rankRows(rows, (r) => r.rel, { now: NOW, tier: isRefl }).map((r) => r.id))
      .toEqual(['refl-lo', 'idea-hi', 'idea-a', 'idea-b'])

    const tied: Array<Row & { streamClass: string }> = [
      { id: 'idea', rel: 0.5, streamClass: 'idea', createdAt: daysAgo(1) },
      { id: 'refl', rel: 0.5, streamClass: 'reflection', createdAt: daysAgo(1) },
    ]
    expect(rankRows(tied, (r) => r.rel, { now: NOW, tieBreak: isRefl }).map((r) => r.id)).toEqual(['refl', 'idea'])
    expect(rankRows(tied, (r) => r.rel, { now: NOW }).map((r) => r.id)).toEqual(['idea', 'refl'])
  })

  it('mixed pool: a scored row competes on 0.5 + standing against P0 fallback rows', () => {
    const rows: Row[] = [
      { id: 'fresh-unscored', rel: 0.5, createdAt: daysAgo(0), confidence: null },
      { id: 'trusted-scored', rel: 0.5, standing: 0.95 },
      { id: 'weak-scored', rel: 0.5, standing: 0.05 },
    ]
    // fresh-unscored = 0.5 × 1.3; trusted = 0.5 × 1.45; weak = 0.5 × 0.55.
    expect(rankRows(rows, (r) => r.rel, { now: NOW }).map((r) => r.id))
      .toEqual(['trusted-scored', 'fresh-unscored', 'weak-scored'])
  })
})
