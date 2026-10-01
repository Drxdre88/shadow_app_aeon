import { describe, expect, it } from 'vitest'
import {
  JUNK_OUTPUT_RE,
  MAX_MESSAGE_CHARS,
  buildBeliefsBlock,
  buildDailyMessageUserPrompt,
  buildDeterministicDailyMessage,
  isLondonHour,
  isLondonMonday,
  londonDate,
  londonInstant,
  parseDailyMessageDraft,
  previousDate,
  rejectMessageText,
  type DailyMessageInputs,
} from '../daily-message-prompt'

function inputs(over: Partial<DailyMessageInputs> = {}): DailyMessageInputs {
  return {
    date: '2026-10-01',
    isMonday: false,
    briefs: null,
    aether: null,
    boardDay: null,
    promotions: null,
    newBeliefs: null,
    drift: null,
    pendingAsk: null,
    synthesis: null,
    mindCompare: null,
    failed: [],
    ...over,
  }
}

describe('London time gate', () => {
  it('BST (before 2026-10-25): 08:00 London is 07:00Z', () => {
    expect(isLondonHour(new Date('2026-10-24T07:00:00Z'), 8)).toBe(true)
    expect(isLondonHour(new Date('2026-10-24T08:00:00Z'), 8)).toBe(false)
  })

  it('GMT from 2026-10-25 (clocks back at 01:00Z): 08:00 London is 08:00Z', () => {
    expect(isLondonHour(new Date('2026-10-25T07:00:00Z'), 8)).toBe(false)
    expect(isLondonHour(new Date('2026-10-25T08:00:00Z'), 8)).toBe(true)
    expect(isLondonHour(new Date('2026-10-26T08:59:59Z'), 8)).toBe(true)
  })

  it('londonDate follows the London calendar, not UTC', () => {
    expect(londonDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02') // BST
    expect(londonDate(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01') // GMT
  })

  it('londonInstant resolves 08:00 London on both sides of the boundary', () => {
    expect(londonInstant('2026-10-24').toISOString()).toBe('2026-10-24T07:00:00.000Z')
    expect(londonInstant('2026-10-25').toISOString()).toBe('2026-10-25T08:00:00.000Z')
    expect(londonInstant('2026-03-29').toISOString()).toBe('2026-03-29T07:00:00.000Z') // spring forward day
  })

  it('previousDate and Monday detection', () => {
    expect(previousDate('2026-11-01')).toBe('2026-10-31')
    expect(isLondonMonday(new Date('2026-10-26T08:00:00Z'))).toBe(true)
    expect(isLondonMonday(new Date('2026-10-25T23:30:00Z'))).toBe(false) // Sunday in GMT
  })
})

describe('guard', () => {
  it('rejects headings, URLs, over-length and empty text', () => {
    expect(rejectMessageText('# Title\nbody')).toMatch(/junk/)
    expect(rejectMessageText('see https://x.io')).toMatch(/junk/)
    expect(rejectMessageText('x'.repeat(MAX_MESSAGE_CHARS + 1))).toMatch(/too_long/)
    expect(rejectMessageText('  ')).toBe('empty')
    expect(rejectMessageText('**Today** all calm.')).toBeNull()
  })

  it('parseDailyMessageDraft takes {"message"} JSON and applies the guard', () => {
    expect(parseDailyMessageDraft('```json\n{"message": "**Today** ship it."}\n```')).toEqual({ ok: true, message: '**Today** ship it.' })
    expect(parseDailyMessageDraft('plain text')).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    expect(parseDailyMessageDraft('{"text": "x"}')).toMatchObject({ ok: false, reason: expect.stringMatching(/message/) })
    expect(parseDailyMessageDraft('{"message": "## Heading\\nbody"}')).toMatchObject({ ok: false, reason: expect.stringMatching(/^guard_rejected/) })
  })
})

describe('compose prompt', () => {
  it('includes supplied sections and omits empty ones', () => {
    const prompt = buildDailyMessageUserPrompt(inputs({
      briefs: [{ dominion: 'AEON', lines: ['Ship the board fix.'] }],
      drift: { alert: true, summary: 'mean similarity 0.71' },
      pendingAsk: 'What made Tuesday hard?',
      synthesis: { green: 5, failed: 0, failedStages: [] },
    }))
    expect(prompt).toContain('[AEON]')
    expect(prompt).toContain('DRIFT ALERT: mean similarity 0.71')
    expect(prompt).toContain('What made Tuesday hard?')
    expect(prompt).not.toContain('SYNTHESIS') // healthy → silent
    expect(prompt).not.toContain('AETHER')
  })

  it('includes the mind comparison only on Mondays', () => {
    expect(buildDailyMessageUserPrompt(inputs({ mindCompare: 'agree on 4' }))).not.toContain('agree on 4')
    expect(buildDailyMessageUserPrompt(inputs({ isMonday: true, mindCompare: 'agree on 4' }))).toContain('agree on 4')
  })

  it('reports conscience failures and never claims "within baseline" without a drift reading', () => {
    const unmeasured = buildDailyMessageUserPrompt(inputs({
      drift: { alert: false, summary: null, measured: false, conscience: 'conscience checks: 1/4 flattery pairs split' },
    }))
    expect(unmeasured).not.toContain('within baseline')
    expect(unmeasured).toContain('Self-check failures (say plainly, one line): conscience checks: 1/4 flattery pairs split.')

    const measured = buildDailyMessageUserPrompt(inputs({ drift: { alert: false, summary: null, measured: true, conscience: null } }))
    expect(measured).toContain('Drift: within baseline.')
    expect(measured).not.toContain('Self-check failures')

    const fallback = buildDeterministicDailyMessage(inputs({
      drift: { alert: false, summary: null, measured: false, conscience: 'conscience checks: 2 contradictions' },
    }))
    expect(fallback).toContain('conscience checks: 2 contradictions.')
  })
})

describe('deterministic fallback', () => {
  it('composes from whatever inputs arrived, stripping URLs/headings, within the cap', () => {
    const text = buildDeterministicDailyMessage(inputs({
      briefs: [{ dominion: 'AEON', lines: ['## State', 'see https://evil.example now'] }],
      boardDay: { finished: 2, finishedTitles: ['Fix login', 'Ship gantt'], thinCards: 1 },
      aether: [{ title: 'Focus', insight: 'Fewer threads.', dominionName: null }],
      drift: { alert: true, summary: 'mean 0.7' },
      synthesis: { green: 3, failed: 1, failedStages: ['cortex'] },
      pendingAsk: 'Why the pause?',
    }))
    expect(JUNK_OUTPUT_RE.test(text)).toBe(false)
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(text).toContain('2 cards finished — Fix login; Ship gantt.')
    expect(text).toContain('1 finished card with no notes yet.')
    expect(text).toContain('Drift alert: mean 0.7')
    expect(text).toContain('cortex')
    expect(text).toContain('Why the pause?')
  })

  it('never sends an empty message when every input is missing', () => {
    expect(buildDeterministicDailyMessage(inputs({ failed: ['briefs', 'aether'] }))).toMatch(/quiet start/)
  })
})

describe('beliefs block (shared with the digest)', () => {
  it('lists ≤3 promotions with the undo hint', () => {
    const block = buildBeliefsBlock([{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }])
    expect(block.split('\n')).toEqual(['What I now believe:', '1. a', '2. b', '3. c', 'To undo one, just tell me “undo <title>”.'])
    expect(buildBeliefsBlock([])).toBe('')
  })
})

describe('idea of the day (docs/kairos/35)', () => {
  const idea = { title: 'Batch the Telegram digests', claim: 'Send one weekly digest instead of three', survivedBecause: 'it beat 5 rivals and cites two complaints', othersWaiting: 2 }

  it('puts the idea, why it survived and the waiting count in the compose prompt', () => {
    const prompt = buildDailyMessageUserPrompt(inputs({ idea, ideaDiversityAlarm: true }))
    expect(prompt).toContain('IDEA OF THE DAY')
    expect(prompt).toContain('Idea: Batch the Telegram digests — Send one weekly digest instead of three')
    expect(prompt).toContain('Survived because: it beat 5 rivals and cites two complaints')
    expect(prompt).toContain('Other surviving ideas waiting in the inbox: 2')
    expect(prompt).toContain('Ideas are getting samey this week')
  })

  it('renders one fallback line, plus the samey warning when the alarm is up', () => {
    const text = buildDeterministicDailyMessage(inputs({ idea, ideaDiversityAlarm: true }))
    expect(text).toContain('Idea of the day: Batch the Telegram digests — survived because it beat 5 rivals and cites two complaints (2 more in your inbox).')
    expect(text).toContain('Ideas are getting samey this week.')
    expect(rejectMessageText(text)).toBeNull()
  })

  it('omits the waiting count and the warning when there is nothing to say', () => {
    const text = buildDeterministicDailyMessage(inputs({ idea: { ...idea, othersWaiting: 0, survivedBecause: null }, ideaDiversityAlarm: false }))
    expect(text).toContain('Idea of the day: Batch the Telegram digests.')
    expect(text).not.toMatch(/more in your inbox|samey/)
  })

  it('stays silent without an idea or alarm (older inputs without the fields)', () => {
    expect(buildDailyMessageUserPrompt(inputs())).not.toContain('IDEA OF THE DAY')
    expect(buildDeterministicDailyMessage(inputs())).not.toContain('Idea of the day')
  })
})
