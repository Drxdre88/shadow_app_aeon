import { describe, expect, it } from 'vitest'
import type { GroundedGenerate } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaCandidate } from '@/lib/kairos/ideas/types'
import { applyCollisionGate } from '../gate'
import type { CollisionContext, CollisionPair } from '../types'

const pair = (id: string, aId: string, bId: string): CollisionPair => ({
  id, pairKey: `${aId}:${bId}`, aId, bId, aArea: 'Work', bArea: 'Garden', aDate: '2026-06-01', bDate: '2026-09-30',
  aText: 'Standup ritual — Morning standup blocks deep work and meetings fragment deep work',
  bText: 'Garden notes — Weeds crowd seedlings and shade starves seedlings',
  cos: 0.2412, relevance: 0.7, score: 0.53,
})
const CTX: CollisionContext = { v: 1, mode: 'on', anchor: 'aether', considered: 4, pairs: [pair('p1', 'ma', 'mb'), pair('p2', 'mc', 'md')] }

const blend = (p: string, holds = true) => ({
  pair: p,
  holds,
  a: [{ rel: 'blocks', x: 'standup', y: 'deep work' }, { rel: 'fragments', x: 'meetings', y: 'deep work' }],
  b: [{ rel: 'crowds', x: 'weeds', y: 'seedlings' }, { rel: 'starves', x: 'shade', y: 'seedlings' }],
  map: [{ a: 'standup', b: 'weeds' }, { a: 'deep work', b: 'seedlings' }, { a: 'meetings', b: 'shade' }],
  insight: 'Clear what crowds focus first.',
})

const cand = (key: string, citedIds: string[], b?: string): IdeaCandidate =>
  ({ key, direction: 'Stop', title: key, claim: 'c', why: 'w', nextStep: 'n', citedIds, ...(b ? { blend: b } : {}) })

const grounded = (candidates: IdeaCandidate[]): GroundedGenerate =>
  ({ directions: [], candidates, dropped: { ungrounded: 0, unknownDirection: 0, overCap: 0 } })

describe('applyCollisionGate', () => {
  it('keeps plain candidates untouched and attaches a bridge to a valid blend', () => {
    const g = grounded([cand('c1', ['x']), cand('c2', ['ma', 'mb'], 'p1')])
    const res = applyCollisionGate(g, CTX, { blends: [blend('p1')] })
    expect(res.grounded).toBe(g)
    expect([...res.bridges.keys()]).toEqual(['c2'])
    expect(res.bridges.get('c2')).toEqual({
      v: 1, pairKey: 'ma:mb', aId: 'ma', bId: 'mb', aArea: 'Work', bArea: 'Garden', cos: 0.241,
      relations: [
        { a: 'standup blocks deep work', b: 'weeds crowds seedlings' },
        { a: 'meetings fragments deep work', b: 'shade starves seedlings' },
      ],
      map: blend('p1').map, insight: 'Clear what crowds focus first.', mappingHolds: null,
    })
    expect(res.stats).toEqual({ offered: 2, blends: 1, declined: 0, kept: 1, dropped: {} })
  })

  it('drops invalid blends, keeps one per pair and renumbers keys', () => {
    const g = grounded([
      cand('c1', ['ma'], 'p1'), // missing the B citation
      cand('c2', ['ma', 'mb'], 'p1'),
      cand('c3', ['ma', 'mb'], 'p1'), // duplicate pair
      cand('c4', ['x']),
      cand('c5', ['mc', 'md'], 'p2'), // declined in blends
      cand('c6', ['x'], 'p9'), // unknown pair
    ])
    const res = applyCollisionGate(g, CTX, { blends: [blend('p1'), blend('p2', false)] })
    expect(res.grounded.candidates.map((c) => [c.key, c.title])).toEqual([['c1', 'c2'], ['c2', 'c4']])
    expect([...res.bridges.keys()]).toEqual(['c1'])
    expect(res.stats).toEqual({
      offered: 2, blends: 5, declined: 1, kept: 1,
      dropped: { missing_citation: 1, duplicate_pair: 1, declined: 1, unknown_pair: 1 },
    })
  })

  it('drops a blend with no structure in the answer', () => {
    const res = applyCollisionGate(grounded([cand('c1', ['ma', 'mb'], 'p1'), cand('c2', ['x'])]), CTX, {})
    expect(res.grounded.candidates.map((c) => c.title)).toEqual(['c2'])
    expect(res.stats.dropped).toEqual({ no_blend: 1 })
  })
})
