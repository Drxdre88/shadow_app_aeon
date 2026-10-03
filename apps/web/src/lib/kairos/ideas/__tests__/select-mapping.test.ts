import { describe, expect, it } from 'vitest'
import { eliminationReason, selectSurvivors, type SelectionInput } from '../select'
import type { IdeaCritique } from '../types'

const crit = (over: Partial<IdeaCritique> = {}): IdeaCritique =>
  ({ verdict: 'grounded', supports: ['m1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', ...over })
const input = (key: string, over: Partial<SelectionInput> = {}): SelectionInput => ({
  key,
  novelty: { class: 'novel', maxCosine: 0.2, nearestId: null, nearestKind: null },
  critique: crit(),
  record: { elo: 1000, wins: 0, losses: 0, draws: 0 },
  ...over,
})

describe('mapping_failed elimination (lane B)', () => {
  it('eliminates a bridged candidate only on an explicit mappingHolds false', () => {
    expect(eliminationReason(input('c1', { bridged: true, critique: crit({ mappingHolds: false }) }))).toBe('mapping_failed')
    expect(eliminationReason(input('c1', { bridged: true, critique: crit() }))).toBeNull()
    expect(eliminationReason(input('c1', { bridged: true, critique: crit({ mappingHolds: null }) }))).toBeNull()
    expect(eliminationReason(input('c1', { bridged: true, critique: crit({ mappingHolds: true }) }))).toBeNull()
  })

  it('ignores mappingHolds on unbridged candidates', () => {
    expect(eliminationReason(input('c1', { critique: crit({ mappingHolds: false }) }))).toBeNull()
    expect(eliminationReason(input('c1', { bridged: false, critique: crit({ mappingHolds: false }) }))).toBeNull()
  })

  it('earlier reasons still win', () => {
    expect(eliminationReason(input('c1', { bridged: true, critique: crit({ alreadyKnown: true, mappingHolds: false }) }))).toBe('already_known')
  })

  it('selection without bridged inputs is unchanged', () => {
    const plain = [input('c1'), input('c2', { record: { elo: 1016, wins: 1, losses: 0, draws: 0 } }), input('c3', { critique: null })]
    const flagged = plain.map((p) => ({ ...p, bridged: false }))
    expect(selectSurvivors(flagged)).toEqual(selectSurvivors(plain))
    const failed = selectSurvivors([...plain, input('c4', { bridged: true, critique: crit({ mappingHolds: false }) })])
    expect(failed[3]).toEqual({ key: 'c4', status: 'eliminated', eliminatedReason: 'mapping_failed', rank: null })
    expect(failed.slice(0, 3)).toEqual(selectSurvivors(plain))
  })
})
