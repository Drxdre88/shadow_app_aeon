import { describe, expect, it } from 'vitest'
import type { EloRecord } from '../../elo'
import { selectSurvivors, type SelectionInput } from '../../select'
import type { IdeaCritique } from '../../types'
import { selectNoveltySurvivors } from '../novelty-select'
import { applyTasteSelection } from '../taste-select'

const crit = (over: Partial<IdeaCritique> = {}): IdeaCritique =>
  ({ verdict: 'grounded', supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', ...over })
const rec = (elo: number): EloRecord => ({ elo, wins: 0, losses: 0, draws: 0 })
const input = (key: string, elo: number, maxCosine = 0.3, critique: IdeaCritique | null = crit()): SelectionInput => ({
  key,
  novelty: { class: maxCosine >= 0.88 ? 'repeat' : maxCosine >= 0.8 ? 'borderline' : 'novel', maxCosine, nearestId: null, nearestKind: null },
  critique,
  record: rec(elo),
})
const winners = (s: Array<{ key: string; status: string }>) => s.filter((r) => r.status === 'survivor').map((r) => r.key)

describe('selectNoveltySurvivors', () => {
  const vectors = new Map<string, number[] | null>([
    ['c1', [1, 0, 0]],
    ['c2', [0.99, 0.1, 0]],
    ['c3', [0, 1, 0]],
    ['c4', [0, 0, 1]],
    ['c5', [0.7, 0.7, 0]],
  ])

  it('picks by max-min distance from the archive and each other, ignoring Elo', () => {
    const inputs = [input('c1', 1300, 0.1), input('c2', 1250, 0.05), input('c3', 800, 0.4), input('c4', 700, 0.5), input('c5', 1200, 0.2)]
    const { selection, distance } = selectNoveltySurvivors(inputs, vectors)
    expect(winners(selection)).toEqual(['c2', 'c3', 'c4'])
    expect(selection.find((s) => s.key === 'c2')?.rank).toBe(1)
    expect(selection.find((s) => s.key === 'c1')).toMatchObject({ status: 'eliminated', eliminatedReason: 'ranked_out' })
    expect(distance.get('c2')).toBe(0.95)
  })

  it('keeps every gate but ranked_out and ranks vector-less candidates last', () => {
    const inputs = [
      input('c1', 1300, 0.95),
      input('c2', 1300, 0.1, crit({ verdict: 'contradicted' })),
      input('c3', 1000, 0.3, crit({ alreadyKnown: true })),
      input('c4', 900, 0.82),
      input('c5', 900, 0.1),
      input('c6', 1500, 0.0),
    ]
    const { selection } = selectNoveltySurvivors(inputs, vectors)
    expect(selection.map((s) => s.eliminatedReason)).toEqual(['repeat', 'contradicted', 'already_known', 'not_different', null, null])
    expect(selection[0].status).toBe('repeat')
    expect(selection.find((s) => s.key === 'c5')?.rank).toBe(1)
    expect(selection.find((s) => s.key === 'c6')?.rank).toBe(2)
  })

  it('is deterministic', () => {
    const inputs = [input('c1', 1000), input('c2', 1000), input('c3', 1000)]
    expect(selectNoveltySurvivors(inputs, vectors)).toEqual(selectNoveltySurvivors(inputs, vectors))
  })
})

describe('applyTasteSelection', () => {
  const inputs = [input('c1', 1100), input('c2', 1060), input('c3', 1040), input('c4', 1000), input('c5', 960)]
  const base = selectSurvivors(inputs)

  it('fills two taste slots by adjusted score and reserves the third for an off-taste idea', () => {
    const fits = new Map<string, number | null>([['c1', 0.2], ['c2', -0.5], ['c3', 1], ['c4', 0.5], ['c5', null]])
    const { selection, picks } = applyTasteSelection(base, inputs, fits)
    expect(Object.fromEntries(picks)).toEqual({ c3: 'taste', c1: 'taste', c2: 'surprise' })
    expect(winners(selection).sort()).toEqual(['c1', 'c2', 'c3'])
    expect(selection.map((s) => s.rank)).toEqual([1, 3, 2, 4, 5])
    expect(selection.find((s) => s.key === 'c4')).toMatchObject({ status: 'eliminated', eliminatedReason: 'ranked_out' })
  })

  it('an unseen idea (null fit) can take the surprise slot down to 950', () => {
    const fits = new Map<string, number | null>([['c1', 0.5], ['c2', 0.5], ['c3', 0.5], ['c4', 0.5], ['c5', null]])
    const { picks } = applyTasteSelection(base, inputs, fits)
    expect(picks.get('c5')).toBe('surprise')
  })

  it('falls back to the next adjusted score when nothing is off-taste', () => {
    const fits = new Map<string, number | null>([['c1', 0.5], ['c2', 0.4], ['c3', 0.3], ['c4', 0.2], ['c5', 0.1]])
    const { picks } = applyTasteSelection(base, inputs, fits)
    expect(Object.fromEntries(picks)).toEqual({ c1: 'taste', c2: 'taste', c3: 'taste' })
  })

  it('keeps the quality floor: past the top idea a taste pick needs 1000, a surprise 950', () => {
    const thin = [input('c1', 1010), input('c2', 990), input('c3', 940)]
    const fits = new Map<string, number | null>([['c1', -1], ['c2', 1], ['c3', null]])
    const { selection, picks } = applyTasteSelection(selectSurvivors(thin), thin, fits)
    expect(Object.fromEntries(picks)).toEqual({ c1: 'taste' })
    expect(winners(selection)).toEqual(['c1'])
  })

  it('leaves eliminated rows untouched and is deterministic', () => {
    const mixed = [...inputs, input('c6', 1400, 0.95)]
    const b = selectSurvivors(mixed)
    const fits = new Map<string, number | null>()
    const a1 = applyTasteSelection(b, mixed, fits)
    expect(a1.selection[5]).toBe(b[5])
    expect(applyTasteSelection(b, mixed, fits)).toEqual(a1)
  })
})
