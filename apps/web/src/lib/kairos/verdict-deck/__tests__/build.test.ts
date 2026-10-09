import { describe, expect, it } from 'vitest'
import { isLondonSunday } from '../../daily-message-time'
import type { DailyMessageInputs } from '../../daily-message-prompt'
import { buildVerdictDeck, numberDeck } from '../build'
import { VERDICT_DECK_FOOTER, type DeckCandidate } from '../types'

const INPUTS: DailyMessageInputs = {
  date: '2026-10-11', isMonday: false, areas: null, aether: null, boardDay: null, promotions: null,
  newBeliefs: null, drift: null, synthesis: null, mindCompare: null, failed: [],
}
const NOW = new Date('2026-10-11T05:00:00.000Z')
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T06:00:00.000Z`
const cand = (over: Partial<DeckCandidate> & Pick<DeckCandidate, 'id' | 'since'>): DeckCandidate =>
  ({ kind: 'ask', label: null, title: `Item ${over.id}`, ...over })

describe('isLondonSunday (DST-safe)', () => {
  it.each([
    ['2026-10-11T05:00:00.000Z', true],   // 06:00 BST Sunday
    ['2026-10-10T23:30:00.000Z', true],   // 00:30 BST Sunday, still Saturday in UTC
    ['2026-10-11T23:30:00.000Z', false],  // 00:30 BST Monday
    ['2026-10-25T06:00:00.000Z', true],   // clocks went back at 01:00Z: 06:00 GMT Sunday
    ['2026-03-29T00:30:00.000Z', true],   // 00:30 GMT Sunday, before clocks go forward
    ['2026-03-28T23:30:00.000Z', false],  // 23:30 GMT Saturday
    ['2026-10-12T05:00:00.000Z', false],
  ])('%s → %s', (iso, sunday) => {
    expect(isLondonSunday(new Date(iso))).toBe(sunday)
  })
})

describe('numberDeck', () => {
  it('numbers oldest first across kinds', () => {
    const { items, overflow } = numberDeck([
      cand({ id: 'q', kind: 'ask', label: 'Q9', since: day(9) }),
      cand({ id: 'i', kind: 'idea', since: day(5) }),
      cand({ id: 'p', kind: 'proposal', label: 'Goal', since: day(7) }),
      cand({ id: 'r', kind: 'prediction', label: 'R2', since: '2026-10-06T00:00:00.000Z' }),
    ])
    expect(items.map((i) => [i.n, i.id])).toEqual([[1, 'i'], [2, 'r'], [3, 'p'], [4, 'q']])
    expect(overflow).toBe(0)
  })

  it('caps at 10 and counts the rest as overflow', () => {
    const many = Array.from({ length: 13 }, (_, i) => cand({ id: `a${i}`, since: day(13 - i) }))
    const { items, overflow } = numberDeck(many)
    expect(items).toHaveLength(10)
    expect(items[0]!.id).toBe('a12')
    expect(items[9]!.id).toBe('a3')
    expect(overflow).toBe(3)
  })
})

describe('buildVerdictDeck', () => {
  it('bold headline, one short line per item, overflow pointer, then the reply footer', () => {
    const many = Array.from({ length: 12 }, (_, i) => cand({ id: `a${i}`, kind: 'ask', label: `Q${i + 1}`, since: day(i + 1), title: `Question ${i + 1} ${'x'.repeat(200)}` }))
    const { brief, items } = buildVerdictDeck('**Big week ahead.**\nMore prose.', many, INPUTS, NOW)
    const lines = brief.text.split('\n')
    expect(lines[0]).toBe('**Big week ahead.**')
    expect(brief.text).toContain('\n1. Q1 · Question 1 ')
    expect(brief.text).toContain('\n10. Q10 · ')
    expect(brief.text).not.toContain('Q11 ·')
    expect(brief.text.endsWith(`+2 more in your inbox.\n${VERDICT_DECK_FOOTER}`)).toBe(true)
    for (const line of lines.filter((l) => /^\d+\. /.test(l))) expect(line.length).toBeLessThanOrEqual(90)
    expect(items).toHaveLength(10)
    expect(brief).toMatchObject({ ideas: [], overflow: 2, quiet: false })
  })

  it('renders each kind and falls back to a plain headline', () => {
    const { brief } = buildVerdictDeck('', [
      cand({ id: 'i', kind: 'idea', title: 'Cut scope', since: day(1) }),
      cand({ id: 'r', kind: 'prediction', label: 'R3', title: 'Beta lands', since: day(2) }),
      cand({ id: 'q', kind: 'ask', label: 'Q7', title: 'Which board first', since: day(3) }),
      cand({ id: 'g', kind: 'proposal', label: 'Goal', title: 'Close Atlas', since: day(4) }),
      cand({ id: 'c', kind: 'proposal', label: 'Cards', title: 'Board plan', since: day(5) }),
    ], INPUTS, NOW)
    expect(brief.text).toBe([
      '**Sunday review.**',
      '1. 💡 Cut scope\n2. R3 · Beta lands — right?\n3. Q7 · Which board first\n4. Goal · Close Atlas\n5. Cards · Board plan',
      VERDICT_DECK_FOOTER,
    ].join('\n\n'))
  })

  it('nothing waiting → the quiet-day line', () => {
    const { brief, items } = buildVerdictDeck('**Calm.**', [], INPUTS, NOW)
    expect(brief).toEqual({ text: '**Quiet night — nothing needs your verdict today.**', ideas: [], overflow: 0, quiet: true })
    expect(items).toEqual([])
  })
})
