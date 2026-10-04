import { describe, expect, it } from 'vitest'
import { TAIL_LINE_MAX_CHARS } from '@/lib/kairos/daily-message-tail'
import { resolveTurnArea } from '../areas'
import { scoreOf } from '../compute'
import { isLondonMonday } from '../london'
import { buildTrustFooter, buildTrustTailLine, hasTrustFooterFor, renderTrustMarkdown, stripTrustFooter } from '../render'
import { buildTrustStatement, TRUST_STATEMENT_MAX_CHARS } from '../statement'
import type { KairosTrustView, TrustArea } from '../types'

const MONDAY = new Date('2026-10-05T05:00:00.000Z')
const TUESDAY = new Date('2026-10-06T05:00:00.000Z')

function area(over: Partial<TrustArea> = {}): TrustArea {
  return {
    key: 'dom-a', kind: 'dominion', label: 'AEON', level: 'second', statement: 'Treat me as a second opinion (6 settled, 90 days).',
    scored: scoreOf(4, 6), calls: null, wentAhead: { n: 0, ownerRight: 0, kairosRight: 0 },
    goals: { taken: 0, landed: 0, missed: 0, vetoed: 0 }, promises: { kept: 0, missed: 0 }, ideas: { accepted: 0, dismissed: 0 },
    corrections7d: 0, ...over,
  }
}

const view = (areas: TrustArea[]): KairosTrustView => ({
  windowDays: 90, minN: 5, areas, corrections7d: 0, mode: { trust: 'off', askFirst: 'off' }, generatedAt: MONDAY.toISOString(), missing: [],
})

describe('trust statement', () => {
  it('stays ≤220 chars by dropping detail before the level clause', () => {
    const long = buildTrustStatement({
      level: 'check', scored: scoreOf(30, 60),
      calls: { n: 40, right: 25, hitRate: 0.625, brier: 0.22, overconfidence: 0.2, meanProbability: 0.825 },
      wentAhead: { n: 12, ownerRight: 9, kairosRight: 3 }, goals: { taken: 9, landed: 4, missed: 5, vetoed: 3 }, promises: { kept: 6, missed: 5 },
    }, 90, 5)
    expect(long.length).toBeLessThanOrEqual(TRUST_STATEMENT_MAX_CHARS)
    expect(long).toMatch(/Check me here \(60 settled, 90 days\)\.$/)
    expect(long).toContain('12 times you kept a plan I doubted; you were right 9.')
  })
})

describe('trust footer', () => {
  it('round-trips through stripTrustFooter and leaves other text alone', () => {
    const body = 'My take: ship Friday.'
    const footer = buildTrustFooter(area())
    expect(footer).toBe('⚖️ On AEON: Treat me as a second opinion (6 settled, 90 days).')
    expect(stripTrustFooter(`${body}\n\n${footer}`)).toBe(body)
    expect(stripTrustFooter(body)).toBe(body)
    expect(stripTrustFooter('⚖️ balance is a symbol')).toBe('⚖️ balance is a symbol')
    expect(hasTrustFooterFor(`${body}\n\n${footer}`, 'AEON')).toBe(true)
    expect(hasTrustFooterFor(`${body}\n\n${footer}`, 'Body')).toBe(false)
  })
})

describe('Monday tail line', () => {
  it('is Monday (London) only, ≤3 known areas, within the tail cap', () => {
    expect(isLondonMonday(MONDAY)).toBe(true)
    expect(isLondonMonday(TUESDAY)).toBe(false)
    const areas = ['A', 'B', 'C', 'D'].map((l) => area({ key: l, label: l, level: 'lean' }))
    const line = buildTrustTailLine(view([area({ level: 'unknown', label: 'Z' }), ...areas]), MONDAY)!
    expect(line).toBe('⚖️ How far to trust me: A: lean on me (4/6) · B: lean on me (4/6) · C: lean on me (4/6)')
    expect(buildTrustTailLine(view(areas), TUESDAY)).toBeNull()
    expect(buildTrustTailLine(view([area({ level: 'unknown' })]), MONDAY)).toBeNull()
    const huge = buildTrustTailLine(view(areas.map((a) => ({ ...a, label: a.label.repeat(120) }))), MONDAY)
    expect(huge === null || huge.length <= TAIL_LINE_MAX_CHARS).toBe(true)
  })
})

describe('markdown', () => {
  it('shows ideas as display-only and missing reads', () => {
    const md = renderTrustMarkdown({ ...view([area({ ideas: { accepted: 2, dismissed: 1 }, goals: { taken: 1, landed: 0, missed: 0, vetoed: 2 } })]), missing: ['goals'] })
    expect(md).toContain('## AEON — treat me as a second opinion')
    expect(md).toContain('Ideas (display only, not scored): accepted 2 · dismissed 1')
    expect(md).toContain('vetoed 2 (vetoes not scored)')
    expect(md).toContain('_Could not read: goals_')
  })
})

describe('resolveTurnArea', () => {
  const doms = [{ id: 'd1', name: 'AEON' }, { id: 'd2', name: 'Body' }]
  it('thread Dominion, then whole-word name, then topic hints, else null', () => {
    expect(resolveTurnArea('anything', 'd9', doms)).toBe('d9')
    expect(resolveTurnArea('should I push the aeon release?', null, doms)).toBe('d1')
    expect(resolveTurnArea('somebody said aeons ago', null, doms)).toBeNull()
    expect(resolveTurnArea('should I move the deadline?', null, doms)).toBe('topic:delivery')
    expect(resolveTurnArea('should I hire someone?', null, doms)).toBe('topic:people')
    expect(resolveTurnArea('what do you think?', null, doms)).toBeNull()
  })
})
