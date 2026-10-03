import { describe, expect, it } from 'vitest'
import {
  ageBucket,
  ANCHOR_FLOOR,
  dreamPickTarget,
  pickAnchor,
  pickDreamMemories,
  pickSeeds,
  type DreamCandidate,
  type DreamSeedItem,
} from '../pick'

const NOW = new Date('2026-10-03T02:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

function cand(id: string, dominionId: string | null, ageDays: number, embedding: number[], streamClass = 'idea'): DreamCandidate {
  return { id, dominionId, streamClass, title: `t-${id}`, summary: null, createdAt: daysAgo(ageDays), embedding }
}

const pool: DreamCandidate[] = [
  cand('a1', 'A', 1, [1, 0, 0], 'reflection'),
  cand('a2', 'A', 2, [0.95, 0.3, 0]),
  cand('b1', 'B', 10, [0.6, 0.8, 0]),
  cand('b2', 'B', 3, [0.5, 0.5, 0.5]),
  cand('c1', 'C', 60, [0.3, 0, 0.95]),
  cand('d1', 'D', 400, [0.4, 0.6, 0.6]),
  cand('far', 'E', 200, [-1, 0, 0]),
]

describe('dream picking', () => {
  it('buckets ages at 7, 30 and 120 days', () => {
    expect(ageBucket(daysAgo(6.9), NOW)).toBe('0-7d')
    expect(ageBucket(daysAgo(7), NOW)).toBe('7-30d')
    expect(ageBucket(daysAgo(30), NOW)).toBe('30-120d')
    expect(ageBucket(daysAgo(120), NOW)).toBe('120d+')
  })

  it('anchors on the candidate closest to the seed vector, else the newest reflection', () => {
    expect(pickAnchor(pool, [0.3, 0, 1])?.id).toBe('c1')
    expect(pickAnchor(pool, null)?.id).toBe('a1')
    expect(pickAnchor(pool.filter((c) => c.streamClass !== 'reflection'), null)?.id).toBe('a2')
  })

  it('is deterministic in any input order', () => {
    const a = pickDreamMemories(pool, [1, 0, 0], NOW).map((p) => p.candidate.id)
    const b = pickDreamMemories([...pool].reverse(), [1, 0, 0], NOW).map((p) => p.candidate.id)
    expect(a).toEqual(b)
    expect(a[0]).toBe('a1')
  })

  it('spreads across new areas and new age buckets first', () => {
    const picks = pickDreamMemories(pool, [1, 0, 0], NOW)
    expect(picks).toHaveLength(dreamPickTarget(pool))
    const firstFour = picks.slice(0, 4)
    expect(new Set(firstFour.map((p) => p.candidate.dominionId)).size).toBe(4)
    expect(new Set(firstFour.map((p) => p.bucket)).size).toBe(4)
    expect(picks.map((p) => p.candidate.id).slice(0, 4)).toEqual(['a1', 'c1', 'b1', 'd1'])
  })

  it('never picks below the cosine floor to the anchor', () => {
    const picks = pickDreamMemories(pool, [1, 0, 0], NOW)
    expect(picks.map((p) => p.candidate.id)).not.toContain('far')
    expect(ANCHOR_FLOOR).toBe(0.1)
  })

  it('relaxes the area rule before the bucket rule', () => {
    const sameArea: DreamCandidate[] = [
      cand('x1', 'A', 1, [1, 0, 0], 'reflection'),
      cand('x2', 'B', 2, [0.3, 1, 0]),
      cand('x3', 'A', 50, [0.7, 0.7, 0]),
    ]
    const ids = pickDreamMemories(sameArea, null, NOW).map((p) => p.candidate.id)
    expect(ids).toEqual(['x1', 'x3', 'x2'])
  })

  it('takes five when the pool spans five areas, four otherwise', () => {
    expect(dreamPickTarget(pool)).toBe(5)
    expect(dreamPickTarget(pool.filter((c) => c.dominionId !== 'E'))).toBe(4)
  })
})

describe('dream seeds', () => {
  const seed = (kind: DreamSeedItem['kind'], ref: string, touchedDaysAgo: number | null): DreamSeedItem => ({
    kind,
    ref,
    text: ref,
    touchedAt: touchedDaysAgo === null ? null : daysAgo(touchedDaysAgo),
  })

  it('keeps priority order and caps at three', () => {
    const out = pickSeeds([seed('goal', 'g', 9), seed('focus', 'f', 9), seed('ask', 'q1', 9), seed('promise', 'p', 9)], NOW)
    expect(out.map((s) => s.ref)).toEqual(['f', 'q1', 'p'])
  })

  it('moves anything touched in the last 36h ahead', () => {
    const out = pickSeeds([seed('focus', 'f', 5), seed('ask', 'q1', 5), seed('goal', 'g', 1)], NOW)
    expect(out.map((s) => s.ref)).toEqual(['g', 'f', 'q1'])
  })
})
