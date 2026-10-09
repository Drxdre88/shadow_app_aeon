import { describe, expect, it } from 'vitest'
import {
  DAILY_BRIEF_MAX_CHARS,
  FULL_BRIEF_POINTER,
  QUIET_DAY_LINE,
  briefHeadline,
  buildDailyBrief,
} from '../daily-brief'
import type { DailyMessageInputs } from '../daily-message-prompt'

const NOW = new Date('2026-10-09T05:00:00.000Z') // 06:00 London
const IDEA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NARRATIVE = '**Atlas is one fix away from shipping.**\n**Today**\nAEON: Ship the board fix.\nNext: the beta cohort lands Monday.'

const BASE: DailyMessageInputs = {
  date: '2026-10-09', isMonday: false, areas: [{ dominion: 'AEON', headline: 'Ship the board fix.' }], aether: null,
  boardDay: null, promotions: [], newBeliefs: [], drift: null, openAsks: null, synthesis: null, mindCompare: null, failed: [],
}

const asks = (n: number) => Array.from({ length: n }, (_, i) => ({
  seq: 10 + i, question: `Question number ${10 + i}?`, askedAt: `2026-10-0${1 + (i % 8)}T04:30:00.000Z`,
}))

describe('buildDailyBrief — 3 verdict items + 1 look-ahead', () => {
  it('leads with the headline, keeps Q numbers, adds the look-ahead and the overflow pointer', () => {
    const inputs: DailyMessageInputs = {
      ...BASE,
      idea: { id: IDEA_ID, title: 'Cut the PPA scope', claim: 'Cut it', survivedBecause: null, othersWaiting: 1 },
      openAsks: asks(4),
      verdicts: [{ seq: 3, claim: 'Login fix holds a week' }],
    }
    const brief = buildDailyBrief(NARRATIVE, inputs, NOW)
    const lines = brief.text.split('\n')
    expect(lines[0]).toBe('**Atlas is one fix away from shipping.**')
    expect(brief.text).toContain('💡 Idea: Cut the PPA scope — Keep or Drop below.')
    expect(brief.text).toContain('Q10 · Question number 10?')
    expect(brief.text).toContain('R3 · Login fix holds a week — right or wrong?')
    // 3 shown: idea, oldest Q, first R. Cut: Q11–Q13 and the other waiting idea.
    expect(brief.text).not.toContain('Q11')
    expect(brief.overflow).toBe(4)
    expect(lines.at(-2)).toBe('Next: the beta cohort lands Monday.')
    expect(lines.at(-1)).toBe('+4 more in your inbox.')
    expect(brief.ideas).toEqual([{ id: IDEA_ID, title: 'Cut the PPA scope' }])
    expect(brief.quiet).toBe(false)
  })

  it('questions alone: the three oldest, by number, oldest first', () => {
    const brief = buildDailyBrief(NARRATIVE, { ...BASE, openAsks: asks(5) }, NOW)
    const qLines = brief.text.split('\n').filter((l) => /^Q\d+ · /.test(l))
    expect(qLines.map((l) => l.split(' ')[0])).toEqual(['Q10', 'Q11', 'Q12'])
    expect(brief.text.endsWith('+2 more in your inbox.')).toBe(true)
    expect(brief.ideas).toEqual([])
  })

  it(`stays under ${DAILY_BRIEF_MAX_CHARS} characters on a heavy day without losing the numbers`, () => {
    const long = 'x'.repeat(400)
    const inputs: DailyMessageInputs = {
      ...BASE,
      idea: { id: IDEA_ID, title: long, claim: long, survivedBecause: long, othersWaiting: 2 },
      openAsks: asks(30).map((a) => ({ ...a, question: long })),
      verdicts: [{ seq: 7, claim: long }],
      moment: { openings: [long] },
    }
    const brief = buildDailyBrief(`**${long}**\nNext: ${long}`, inputs, NOW)
    expect(brief.text.length).toBeLessThanOrEqual(DAILY_BRIEF_MAX_CHARS)
    expect(brief.text).toMatch(/^Q10 · /m)
    expect(brief.text).toMatch(/^R7 · /m)
    expect(brief.text).toContain(`+${30 - 1 + 2} more in your inbox.`)
  })

  it('no verdict pending but something notable: headline, look-ahead, full-brief pointer', () => {
    const brief = buildDailyBrief(NARRATIVE, { ...BASE, boardDay: { finished: 2, finishedTitles: [], thinCards: 0 } }, NOW)
    expect(brief.text).toBe(['**Atlas is one fix away from shipping.**', '', 'Next: the beta cohort lands Monday.', FULL_BRIEF_POINTER].join('\n'))
    expect(brief.overflow).toBe(0)
  })

  it('an idea without an inbox id points at the inbox instead of buttons', () => {
    const brief = buildDailyBrief(NARRATIVE, { ...BASE, idea: { title: 'Cut it', claim: 'Cut it', survivedBecause: null, othersWaiting: 0 } }, NOW)
    expect(brief.text).toContain('💡 Idea: Cut it — in your inbox.')
    expect(brief.ideas).toEqual([])
  })
})

describe('buildDailyBrief — quiet day', () => {
  it('nothing needs a verdict and nothing notable: exactly one line', () => {
    const brief = buildDailyBrief('**Today**\nAEON: Steady.', BASE, NOW)
    expect(brief).toEqual({ text: QUIET_DAY_LINE, ideas: [], overflow: 0, quiet: true })
    expect(brief.text.split('\n')).toHaveLength(1)
  })

  it('keeps a look-ahead on the same single line', () => {
    const agenda = [{ seq: 2, dueAt: '2026-10-10T08:00:00.000Z', what: 'Check the deploy held' }]
    const brief = buildDailyBrief('Calm.', { ...BASE, agenda }, NOW)
    expect(brief.text).toBe(`${QUIET_DAY_LINE} Next: A2 Sat 10/10 — Check the deploy held`)
    expect(brief.text).not.toContain('\n')
  })
})

describe('briefHeadline', () => {
  it('skips bold section labels and Next: lines, strips markdown', () => {
    expect(briefHeadline('**Today**\nAEON: **Ship** it.')).toBe('AEON: Ship it.')
    expect(briefHeadline('Next: later\n**Big day for Atlas.**')).toBe('Big day for Atlas.')
    expect(briefHeadline('  \n')).toBeNull()
  })
})
