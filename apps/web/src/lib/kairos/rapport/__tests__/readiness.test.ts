import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { scoreChangeTalk } from '../lexicon'
import type { ReadinessBand } from '@/lib/data/validators/kairos-rapport'
import { applyGoalTurn, balanceOf, decayFactor, nextBand, tipForTurn, type GoalTurn } from '../readiness'

const T0 = new Date('2026-10-01T09:00:00.000Z')
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000)
const turn = (body: string, ref: string, when: Date = T0): GoalTurn => ({ objectiveId: 'o1', title: 'Run a marathon', ref, talk: scoreChangeTalk(body), at: when })

describe('readiness bands', () => {
  it('preparing talk stays preparing; a commitment tips once', () => {
    const a = applyGoalTurn(undefined, turn('I want to run a marathon', 'r1'))
    expect(a.goal.band).toBe('preparing')
    expect(a.tip).toBeNull()
    const b = applyGoalTurn(a.goal, turn("I'll sign up for the marathon, I'm going to do it", 'r2', at(1)))
    expect(b.goal.band).toBe('committed')
    expect(b.tip).toMatchObject({ kind: 'commit', marker: "i'll", ref: 'r2' })
  })

  it('sustain talk after a commitment tips back to wavering', () => {
    const a = applyGoalTurn(undefined, turn("I'll do the marathon", 'r1'))
    expect(a.tip?.kind).toBe('commit')
    const b = applyGoalTurn(a.goal, turn("I can't, no time for the marathon, too hard", 'r2', at(8)))
    expect(b.goal.band).toBe('wavering')
    expect(b.tip).toMatchObject({ kind: 'back', ref: 'r2' })
  })

  it('a second tip within 7 days changes the band but fires no tip', () => {
    const a = applyGoalTurn(undefined, turn("I'll do the marathon", 'r1'))
    const b = applyGoalTurn(a.goal, turn("I can't, no time, too hard", 'r2', at(2)))
    expect(b.goal.band).toBe('wavering')
    expect(b.tip).toBeNull()
    expect(b.goal.lastTip?.ref).toBe('r1')
  })

  it('the same message ref is never counted twice', () => {
    const a = applyGoalTurn(undefined, turn("I'll do the marathon", 'r1'))
    const again = applyGoalTurn(a.goal, turn("I'll do the marathon", 'r1'))
    expect(again.duplicate).toBe(true)
    expect(again.goal).toBe(a.goal)
  })

  it('tipForTurn agrees whether or not the capture already stored the turn', () => {
    const t = turn("I'll do the marathon", 'r1')
    const fresh = tipForTurn(undefined, t)
    const stored = applyGoalTurn(undefined, t).goal
    expect(tipForTurn(stored, t)).toEqual(fresh)
    expect(tipForTurn(stored, { ...t, ref: 'r9', talk: scoreChangeTalk('I want to') })).toBeNull()
  })

  it('tallies decay with a 7-day half-life', () => {
    expect(decayFactor(T0.toISOString(), at(7))).toBeCloseTo(0.5)
    const a = applyGoalTurn(undefined, turn('I want to I could I might', 'r1'))
    const b = applyGoalTurn(a.goal, turn('the marathon', 'r2', at(14)))
    expect(b.goal.prep).toBeCloseTo(0.75, 2)
  })

  test.prop([fc.nat(20), fc.nat(20), fc.nat(20), fc.constantFrom<ReadinessBand[]>('none', 'preparing', 'committed', 'wavering')])(
    'balance stays in (-1, 1) and committed needs commit ≥ 1',
    (commit, prep, sustain, prev) => {
      const b = balanceOf({ commit, prep, sustain })
      expect(b).toBeGreaterThan(-1)
      expect(b).toBeLessThan(1)
      const band = nextBand(prev, { commit, prep, sustain })
      if (band === 'committed') expect(commit).toBeGreaterThanOrEqual(1)
      if (band === 'wavering') expect(['committed', 'wavering']).toContain(prev)
    },
  )
})
