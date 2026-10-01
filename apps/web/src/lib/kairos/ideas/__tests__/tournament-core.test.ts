import { describe, expect, it } from 'vitest'
import { computeElo, expectedScore, pairOutcome, updateElo } from '../elo'
import { scheduleMatches, schedulePairs } from '../pairing'
import { eliminationReason, selectSurvivors, type SelectionInput } from '../select'
import { ELO_K, ELO_START, IDEA_SURVIVORS_MAX, MATCHES_PER_CANDIDATE, type IdeaCritique, type NoveltyResult } from '../types'

const keys = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`)

describe('pairing', () => {
  it('is deterministic', () => {
    expect(scheduleMatches(keys(11))).toEqual(scheduleMatches(keys(11)))
  })

  it.each([2, 3, 4, 5, 8, 12, 16])('gives every one of %i candidates 1..MATCHES_PER_CANDIDATE distinct opponents', (n) => {
    const pairs = schedulePairs(keys(n))
    const degree = new Map<string, number>()
    const seen = new Set<string>()
    for (const [a, b] of pairs) {
      expect(a).not.toBe(b)
      const id = [a, b].sort().join('|')
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
    }
    for (const k of keys(n)) {
      expect(degree.get(k) ?? 0).toBeGreaterThanOrEqual(Math.min(n - 1, MATCHES_PER_CANDIDATE - 1, 1))
      expect(degree.get(k) ?? 0).toBeLessThanOrEqual(MATCHES_PER_CANDIDATE)
    }
    if (n >= 8) for (const k of keys(n)) expect(degree.get(k)).toBe(MATCHES_PER_CANDIDATE)
  })

  it('schedules nothing for fewer than two candidates', () => {
    expect(scheduleMatches([])).toEqual({ pairs: [], matches: [] })
    expect(scheduleMatches(['c1'])).toEqual({ pairs: [], matches: [] })
  })

  it('lists every pair twice with the order swapped, under unique match ids, never adjacent', () => {
    const { pairs, matches } = scheduleMatches(keys(9))
    expect(matches).toHaveLength(pairs.length * 2)
    expect(new Set(matches.map((m) => m.id)).size).toBe(matches.length)
    for (const p of pairs) {
      const f = matches.find((m) => m.id === p.forward)!
      const s = matches.find((m) => m.id === p.swapped)!
      expect([f.first, f.second]).toEqual([p.a, p.b])
      expect([s.first, s.second]).toEqual([p.b, p.a])
      expect(Math.abs(matches.indexOf(f) - matches.indexOf(s))).toBeGreaterThan(1)
    }
  })
})

describe('elo', () => {
  it('matches the textbook update', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
    const [a, b] = updateElo(1000, 1000, 1)
    expect(a).toBeCloseTo(1000 + ELO_K / 2)
    expect(b).toBeCloseTo(1000 - ELO_K / 2)
    const [c, d] = updateElo(1200, 1000, 0.5)
    expect(c).toBeLessThan(1200)
    expect(d).toBeGreaterThan(1000)
    expect(c + d).toBeCloseTo(2200)
  })

  const pair = { id: 'p1', a: 'c1', b: 'c2', forward: 'm1', swapped: 'm2' }

  it('needs the same winner in both orders for a win; a split or a single vote is a draw', () => {
    expect(pairOutcome(pair, new Map([['m1', 'c1'], ['m2', 'c1']]))).toEqual({ kind: 'win', winner: 'c1', loser: 'c2' })
    expect(pairOutcome(pair, new Map([['m1', 'c1'], ['m2', 'c2']]))).toEqual({ kind: 'draw' })
    expect(pairOutcome(pair, new Map([['m1', 'c2']]))).toEqual({ kind: 'draw' })
    expect(pairOutcome(pair, new Map())).toEqual({ kind: 'none' })
    expect(pairOutcome(pair, new Map([['m1', 'c9'], ['m2', 'c9']]))).toEqual({ kind: 'none' })
  })

  it('computes ratings and records over the schedule', () => {
    const { pairs } = scheduleMatches(['c1', 'c2', 'c3'])
    const votes = new Map<string, string>()
    for (const p of pairs) {
      const w = [p.a, p.b].includes('c1') ? 'c1' : null
      if (w) {
        votes.set(p.forward, w)
        votes.set(p.swapped, w)
      } else {
        votes.set(p.forward, p.a) // c2 vs c3 split → draw
        votes.set(p.swapped, p.b)
      }
    }
    const t = computeElo(['c1', 'c2', 'c3'], pairs, votes)
    expect(t.get('c1')).toMatchObject({ wins: 2, losses: 0, draws: 0 })
    expect(t.get('c1')!.elo).toBeGreaterThan(ELO_START)
    expect(t.get('c2')).toMatchObject({ wins: 0, losses: 1, draws: 1 })
    expect(t.get('c3')).toMatchObject({ wins: 0, losses: 1, draws: 1 })
    const total = [...t.values()].reduce((s, r) => s + r.elo, 0)
    expect(total).toBeCloseTo(3 * ELO_START)
  })

  it('leaves ratings alone when no vote came back', () => {
    const { pairs } = scheduleMatches(['c1', 'c2'])
    const t = computeElo(['c1', 'c2'], pairs, new Map())
    expect(t.get('c1')!.elo).toBe(ELO_START)
  })
})

const novel: NoveltyResult = { class: 'novel', maxCosine: 0.3, nearestId: null, nearestKind: null }
const borderline: NoveltyResult = { class: 'borderline', maxCosine: 0.84, nearestId: 'n1', nearestKind: 'idea' }
const repeat: NoveltyResult = { class: 'repeat', maxCosine: 0.93, nearestId: 'n2', nearestKind: 'proposal' }
const ok = (over: Partial<IdeaCritique> = {}): IdeaCritique => ({
  verdict: 'grounded', supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', ...over,
})
const rec = (elo: number, wins = 0) => ({ elo, wins, losses: 0, draws: 0 })
const cand = (key: string, over: Partial<SelectionInput> = {}): SelectionInput => ({ key, novelty: novel, critique: ok(), record: rec(ELO_START), ...over })

describe('selection', () => {
  it.each([
    ['repeat', cand('c1', { novelty: repeat })],
    ['ungrounded', cand('c1', { critique: null })],
    ['ungrounded', cand('c1', { critique: ok({ verdict: 'ungrounded' }) })],
    ['contradicted', cand('c1', { critique: ok({ verdict: 'contradicted', contradicts: ['e2'] }) })],
    ['already_known', cand('c1', { critique: ok({ alreadyKnown: true }) })],
    ['not_different', cand('c1', { novelty: borderline, critique: ok({ meaningfullyDifferent: false }) })],
    ['not_different', cand('c1', { novelty: borderline, critique: ok({ meaningfullyDifferent: null }) })],
    ['ungrounded', cand('c1', { critique: ok({ supports: [] }) })],
  ])('eliminates %s', (reason, c) => {
    expect(eliminationReason(c)).toBe(reason)
    const [r] = selectSurvivors([c])
    expect(r.status).toBe(reason === 'repeat' ? 'repeat' : 'eliminated')
    expect(r.eliminatedReason).toBe(reason)
    expect(r.rank).toBeNull()
  })

  it('keeps a borderline idea the judge found meaningfully different', () => {
    expect(eliminationReason(cand('c1', { novelty: borderline, critique: ok({ meaningfullyDifferent: true }) }))).toBeNull()
  })

  it('caps survivors at IDEA_SURVIVORS_MAX, ranked by Elo then wins', () => {
    const inputs = [
      cand('c1', { record: rec(1010, 1) }),
      cand('c2', { record: rec(1040, 2) }),
      cand('c3', { record: rec(1010, 2) }),
      cand('c4', { record: rec(1020) }),
      cand('c5', { record: rec(1005) }),
    ]
    const out = selectSurvivors(inputs)
    const survivors = out.filter((r) => r.status === 'survivor')
    expect(survivors).toHaveLength(IDEA_SURVIVORS_MAX)
    expect(out.map((r) => r.rank)).toEqual([4, 1, 3, 2, 5])
    expect(out.find((r) => r.key === 'c1')).toMatchObject({ status: 'eliminated', eliminatedReason: 'ranked_out' })
  })

  it('past the top one, a survivor needs Elo ≥ ELO_START', () => {
    const out = selectSurvivors([cand('c1', { record: rec(990) }), cand('c2', { record: rec(980) })])
    expect(out.map((r) => r.status)).toEqual(['survivor', 'eliminated'])
    expect(out[1].eliminatedReason).toBe('ranked_out')
  })

  it('an empty-survivor night: everything eliminated', () => {
    const out = selectSurvivors([cand('c1', { novelty: repeat }), cand('c2', { critique: ok({ alreadyKnown: true }) })])
    expect(out.filter((r) => r.status === 'survivor')).toHaveLength(0)
  })
})
