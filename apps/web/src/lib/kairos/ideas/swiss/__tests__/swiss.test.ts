import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import type { IdeaPair } from '../../pairing'
import { pairKey, pairRound1, pairSwissRound, swissStandings, toRoundSchedule } from '../pairing'
import { SWISS_ROUND_SYSTEM_PROMPT, buildSwissRoundPrompt, parseSwissRoundText } from '../round-prompt'

const keys = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`)

describe('round 1 fold', () => {
  it('top half vs bottom half in key order; odd gives the last a bye', () => {
    expect(pairRound1(['c10', 'c2', 'c1', 'c3'])).toEqual({ pairs: [['c1', 'c3'], ['c2', 'c10']], bye: null })
    expect(pairRound1(keys(5))).toEqual({ pairs: [['c1', 'c3'], ['c2', 'c4']], bye: 'c5' })
  })
})

describe('standings', () => {
  it('1 / ½ / 0 per both-orders pair, byes ½, Buchholz = opponents\' scores', () => {
    const sched = toRoundSchedule([['c1', 'c2'], ['c3', 'c4']], { pair: 0, match: 0 })
    const votes = new Map([['m1', 'c1'], ['m3', 'c1'], ['m2', 'c3'], ['m4', 'c4']])
    const st = swissStandings(keys(5), sched.pairs, votes, ['c5'])
    expect([...st.values()].map((s) => [s.key, s.score, s.buchholz])).toEqual([
      ['c1', 1, 0], ['c2', 0, 1], ['c3', 0.5, 0.5], ['c4', 0.5, 0.5], ['c5', 0.5, 0],
    ])
  })
})

describe('later rounds', () => {
  it('pairs within score groups and never rematches', () => {
    const st = swissStandings(keys(4), toRoundSchedule([['c1', 'c3'], ['c2', 'c4']], { pair: 0, match: 0 }).pairs,
      new Map([['m1', 'c1'], ['m3', 'c1'], ['m2', 'c2'], ['m4', 'c2']]))
    const played = new Set([pairKey('c1', 'c3'), pairKey('c2', 'c4')])
    expect(pairSwissRound(keys(4), st, played)).toEqual({ pairs: [['c1', 'c2'], ['c3', 'c4']], bye: null })
  })

  it('returns null when only rematches are left', () => {
    const st = swissStandings(['c1', 'c2'], [], new Map())
    expect(pairSwissRound(['c1', 'c2'], st, new Set([pairKey('c1', 'c2')]))).toBeNull()
  })

  it('an odd field byes the lowest-ranked player without a prior bye', () => {
    const st = swissStandings(keys(3), [], new Map(), ['c3'])
    const r = pairSwissRound(keys(3), st, new Set(), new Set(['c3']))
    expect(r?.bye).toBe('c2')
    expect(r?.pairs).toEqual([['c3', 'c1']])
  })

  test.prop([fc.integer({ min: 2, max: 16 }), fc.integer({ min: 1, max: 5 }), fc.array(fc.boolean(), { minLength: 400, maxLength: 400 })])(
    'any chain of rounds: no rematch, each key at most once per round, unique ids',
    (n, rounds, coin) => {
      const ks = keys(n)
      const allPairs: IdeaPair[] = []
      const votes = new Map<string, string>()
      const byes: string[] = []
      let flip = 0
      let after = { pair: 0, match: 0 }
      for (let r = 0; r < rounds; r++) {
        const st = swissStandings(ks, allPairs, votes, byes)
        const played = new Set(allPairs.map((p) => pairKey(p.a, p.b)))
        const pairing = r === 0 ? pairRound1(ks) : pairSwissRound(ks, st, played, new Set(byes))
        if (!pairing) break
        const seen = new Set<string>()
        for (const [a, b] of pairing.pairs) {
          expect(played.has(pairKey(a, b))).toBe(false)
          expect(seen.has(a) || seen.has(b) || a === b).toBe(false)
          seen.add(a)
          seen.add(b)
        }
        expect(seen.size + (pairing.bye ? 1 : 0)).toBe(n)
        if (pairing.bye) byes.push(pairing.bye)
        const sched = toRoundSchedule(pairing.pairs, after)
        for (const p of sched.pairs) {
          votes.set(p.forward, coin[flip++ % coin.length] ? p.a : p.b)
          votes.set(p.swapped, coin[flip++ % coin.length] ? p.a : p.b)
        }
        allPairs.push(...sched.pairs)
        after = { pair: after.pair + sched.pairs.length, match: after.match + sched.matches.length }
      }
      const ids = allPairs.flatMap((p) => [p.id, p.forward, p.swapped])
      expect(new Set(ids).size).toBe(ids.length)
    },
  )
})

describe('votes-only round prompt', () => {
  const sched = toRoundSchedule([['c1', 'c2']], { pair: 3, match: 6 })
  const cands = ['c1', 'c2', 'c3'].map((key) => ({ key, direction: 'Stop', title: `T ${key}`, claim: `claim ${key}`, why: 'w', nextStep: 'n' }))

  it('shows only the round\'s candidates and matches, no evidence', () => {
    const p = buildSwissRoundPrompt({ date: '2026-10-01', round: 2, rounds: 5, candidates: cands, matches: sched.matches })
    expect(p).toContain('# Idea tournament — round 2 of 5 for 2026-10-01')
    expect(p).toContain('### c1 · Stop')
    expect(p).not.toContain('### c3')
    expect(p).toContain('- m7: A = c1, B = c2')
    expect(p).toContain('- m8: A = c2, B = c1')
    expect(p).not.toContain('Evidence')
    expect(SWISS_ROUND_SYSTEM_PROMPT).toContain('{"votes":[{"match":"m1","winner":"c1"}]}')
  })

  it('maps A/B, ignores unknown matches and throws on no valid vote', () => {
    const ok = '```json\n{"votes":[{"match":"m7","winner":"B"},{"match":"m8","winner":"c2"},{"match":"m99","winner":"c1"}]}\n```'
    expect([...parseSwissRoundText(ok, sched.matches)]).toEqual([['m7', 'c2'], ['m8', 'c2']])
    expect(() => parseSwissRoundText('```json\n{"votes":[{"match":"m7","winner":"c9"}]}\n```', sched.matches)).toThrow()
    expect(() => parseSwissRoundText('nope', sched.matches)).toThrow()
  })
})
