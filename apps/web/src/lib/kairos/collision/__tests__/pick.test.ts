import { describe, expect, it } from 'vitest'
import { ageBucket, pickCollisionPairs } from '../pick'
import type { CollisionCandidate } from '../types'

const NOW = new Date('2026-10-01T04:00:00Z')
const DAY = 86_400_000
const ANCHOR = [1, 0, 0]

function mk(id: string, dominionId: string | null, daysAgo: number, embedding: number[], title = id, linkedIds: string[] = []): CollisionCandidate {
  return { id, dominionId, title, summary: null, createdAt: new Date(NOW.getTime() - daysAgo * DAY), embedding, linkedIds }
}

// cos(A,B) ≈ 0.24 (inside the band); both near the anchor.
const A = [1, 1, 0]
const B = [1, -0.6, 0]

describe('pickCollisionPairs', () => {
  it('picks a far-apart pair from different areas and times', () => {
    const res = pickCollisionPairs([mk('a', 'd1', 100, A), mk('b', 'd2', 1, B)], ANCHOR, { now: NOW })
    expect(res.anchor).toBe('aether')
    expect(res.pairs).toHaveLength(1)
    const p = res.pairs[0]
    expect([p.a.id, p.b.id]).toEqual(['a', 'b'])
    expect(p.pairKey).toBe('a:b')
    expect(p.cos).toBeGreaterThan(0.1)
    expect(p.cos).toBeLessThan(0.45)
    expect(p.score).toBeCloseTo((1 - p.cos) * p.relevance)
  })

  it('is deterministic under shuffled input', () => {
    const cands = [
      mk('a', 'd1', 100, A), mk('b', 'd2', 1, B), mk('c', 'd3', 50, [1, 0.2, 1]),
      mk('d', 'd4', 3, [1, -1, 0.4]), mk('e', null, 200, [0.8, 0.5, -0.6]),
    ]
    const first = pickCollisionPairs(cands, ANCHOR, { now: NOW }).pairs.map((p) => p.pairKey)
    const reversed = pickCollisionPairs([...cands].reverse(), ANCHOR, { now: NOW }).pairs.map((p) => p.pairKey)
    const rotated = pickCollisionPairs([...cands.slice(2), ...cands.slice(0, 2)], ANCHOR, { now: NOW }).pairs.map((p) => p.pairKey)
    expect(first.length).toBeGreaterThan(0)
    expect(reversed).toEqual(first)
    expect(rotated).toEqual(first)
  })

  it.each([
    ['same area', [mk('a', 'd1', 100, A), mk('b', 'd1', 1, B)]],
    ['same age bucket and close in time', [mk('a', 'd1', 2, A), mk('b', 'd2', 1, B)]],
    ['too similar (cosine above the band)', [mk('a', 'd1', 100, A), mk('b', 'd2', 1, [1, 0.9, 0])]],
    ['unrelated (cosine below the band)', [mk('a', 'd1', 100, [1, 1, 0]), mk('b', 'd2', 1, [1, -1, 0])]],
    ['surface twins (shared words)', [mk('a', 'd1', 100, A, 'weekly planning ritual'), mk('b', 'd2', 1, B, 'weekly planning ritual notes')]],
    ['already linked', [mk('a', 'd1', 100, A, 'x', ['b']), mk('b', 'd2', 1, B)]],
  ])('drops a pair: %s', (_name, cands) => {
    expect(pickCollisionPairs(cands, ANCHOR, { now: NOW }).pairs).toEqual([])
  })

  it('accepts a 30-day gap inside one age bucket', () => {
    expect(ageBucket(new Date(NOW.getTime() - 119 * DAY), NOW)).toBe(ageBucket(new Date(NOW.getTime() - 35 * DAY), NOW))
    const res = pickCollisionPairs([mk('a', 'd1', 119, A), mk('b', 'd2', 35, B)], ANCHOR, { now: NOW })
    expect(res.pairs).toHaveLength(1)
  })

  it('skips pairs offered recently', () => {
    const res = pickCollisionPairs([mk('a', 'd1', 100, A), mk('b', 'd2', 1, B)], ANCHOR, { now: NOW, recentPairKeys: new Set(['a:b']) })
    expect(res.pairs).toEqual([])
  })

  it('needs both sides near the anchor', () => {
    const res = pickCollisionPairs([mk('a', 'd1', 100, A), mk('b', 'd2', 1, B)], [0, 0, 1], { now: NOW })
    expect(res.pairs).toEqual([])
  })

  it('never reuses a memory and keeps one pair per area pair', () => {
    const cands = [mk('a', 'd1', 100, A), mk('b', 'd2', 1, B), mk('c', 'd3', 2, [1, -0.5, 0.1])]
    const res = pickCollisionPairs(cands, ANCHOR, { now: NOW })
    expect(res.considered).toBe(2)
    expect(res.pairs).toHaveLength(1)
    const sameAreas = [mk('a', 'd1', 100, A), mk('b', 'd2', 1, B), mk('x', 'd1', 101, A), mk('y', 'd2', 2, B)]
    const res2 = pickCollisionPairs(sameAreas, ANCHOR, { now: NOW })
    expect(res2.pairs).toHaveLength(1)
  })

  it('caps the number of pairs', () => {
    const cands = [
      mk('a1', 'd1', 100, A), mk('b1', 'd2', 1, B),
      mk('a2', 'd3', 100, A), mk('b2', 'd4', 1, B),
      mk('a3', 'd5', 100, A), mk('b3', 'd6', 1, B),
      mk('a4', 'd7', 100, A), mk('b4', 'd8', 1, B),
    ]
    expect(pickCollisionPairs(cands, ANCHOR, { now: NOW }).pairs).toHaveLength(3)
    expect(pickCollisionPairs(cands, ANCHOR, { now: NOW, max: 1 }).pairs).toHaveLength(1)
  })

  describe('triangle fallback (no anchor)', () => {
    it('needs a shared neighbour close to both sides', () => {
      const lonely = pickCollisionPairs([mk('a', 'd1', 100, A), mk('b', 'd2', 1, B)], null, { now: NOW })
      expect(lonely.anchor).toBe('triangle')
      expect(lonely.pairs).toEqual([])
      const withBridge = pickCollisionPairs([mk('a', 'd1', 100, A), mk('b', 'd2', 1, B), mk('c', 'd1', 101, [1, 0.2, 0])], null, { now: NOW })
      expect(withBridge.pairs.map((p) => p.pairKey)).toContain('a:b')
    })

    it('treats an empty anchor vector as no anchor', () => {
      expect(pickCollisionPairs([], [], { now: NOW }).anchor).toBe('triangle')
    })
  })
})
