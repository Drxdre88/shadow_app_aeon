import { describe, expect, it } from 'vitest'
import {
  DAILY_MESSAGE_HOUR,
  DAILY_MESSAGE_TOTAL_MAX_CHARS,
  DAILY_MESSAGE_SYSTEM_PROMPT,
  JUNK_OUTPUT_RE,
  MAX_MESSAGE_CHARS,
  appendOpenQuestionsBlock,
  buildBeliefsBlock,
  buildDailyMessageUserPrompt,
  buildDeterministicDailyMessage,
  buildOpenQuestionsBlock,
  isLondonHour,
  isLondonMonday,
  londonDate,
  londonInstant,
  parseDailyMessageDraft,
  previousDate,
  rejectMessageText,
  type DailyMessageInputs,
  type OpenAskDigest,
} from '../daily-message-prompt'

function inputs(over: Partial<DailyMessageInputs> = {}): DailyMessageInputs {
  return {
    date: '2026-10-01',
    isMonday: false,
    areas: null,
    aether: null,
    boardDay: null,
    promotions: null,
    newBeliefs: null,
    drift: null,
    openAsks: null,
    synthesis: null,
    mindCompare: null,
    failed: [],
    ...over,
  }
}

describe('London time gate', () => {
  it('the daily message goes out at 06:00 London', () => {
    expect(DAILY_MESSAGE_HOUR).toBe(6)
    expect(DAILY_MESSAGE_SYSTEM_PROMPT).toContain('06:00 UK')
  })

  it('BST (before 2026-10-25): 06:00 London is 05:00Z — the 05:00Z cron slot runs, 06:00Z does not', () => {
    expect(isLondonHour(new Date('2026-10-24T05:00:00Z'), DAILY_MESSAGE_HOUR)).toBe(true)
    expect(isLondonHour(new Date('2026-10-24T06:00:00Z'), DAILY_MESSAGE_HOUR)).toBe(false)
  })

  it('GMT from 2026-10-25 (clocks back at 01:00Z): 06:00 London is 06:00Z', () => {
    expect(isLondonHour(new Date('2026-10-25T05:00:00Z'), DAILY_MESSAGE_HOUR)).toBe(false)
    expect(isLondonHour(new Date('2026-10-25T06:00:00Z'), DAILY_MESSAGE_HOUR)).toBe(true)
    expect(isLondonHour(new Date('2026-10-26T06:59:59Z'), DAILY_MESSAGE_HOUR)).toBe(true)
  })

  it('londonDate follows the London calendar, not UTC', () => {
    expect(londonDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02') // BST
    expect(londonDate(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01') // GMT
  })

  it('londonInstant resolves 06:00 London on both sides of the boundary', () => {
    expect(londonInstant('2026-10-24').toISOString()).toBe('2026-10-24T05:00:00.000Z')
    expect(londonInstant('2026-10-25').toISOString()).toBe('2026-10-25T06:00:00.000Z')
    expect(londonInstant('2026-03-29').toISOString()).toBe('2026-03-29T05:00:00.000Z') // spring forward day
    expect(londonInstant('2026-10-24', 8).toISOString()).toBe('2026-10-24T07:00:00.000Z')
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
      areas: [{ dominion: 'AEON', headline: 'Ship the board fix.' }],
      drift: { alert: true, summary: 'mean similarity 0.71' },
      openAsks: [{ seq: 3, question: 'What made Tuesday hard?', askedAt: '2026-09-30T04:30:00.000Z' }],
      synthesis: { green: 5, failed: 0, failedStages: [] },
    }))
    expect(prompt).toContain('[AEON] Ship the board fix.')
    expect(prompt).not.toMatch(/brief/i)
    expect(prompt).toContain('DRIFT ALERT: mean similarity 0.71')
    // Open questions are code-built at send time — never handed to the model.
    expect(prompt).not.toContain('What made Tuesday hard?')
    expect(prompt).not.toMatch(/PENDING QUESTION/)
    expect(DAILY_MESSAGE_SYSTEM_PROMPT).not.toMatch(/verbatim/)
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
      areas: [{ dominion: 'AEON', headline: '## State: see https://evil.example now' }],
      boardDay: { finished: 2, finishedTitles: ['Fix login', 'Ship gantt'], thinCards: 1 },
      aether: [{ title: 'Focus', insight: 'Fewer threads.', dominionName: null }],
      drift: { alert: true, summary: 'mean 0.7' },
      synthesis: { green: 3, failed: 1, failedStages: ['cortex'] },
      openAsks: [{ seq: 1, question: 'Why the pause?', askedAt: '2026-09-30T04:30:00.000Z' }],
    }))
    expect(JUNK_OUTPUT_RE.test(text)).toBe(false)
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(text).toContain('AEON: State: see now')
    expect(text).toContain('2 cards finished — Fix login; Ship gantt.')
    expect(text).toContain('1 finished card with no notes yet.')
    expect(text).toContain('Drift alert: mean 0.7')
    expect(text).toContain('cortex')
    expect(text).not.toContain('Why the pause?') // the block is appended by compose, not the narrative
  })

  it('never sends an empty message when every input is missing', () => {
    expect(buildDeterministicDailyMessage(inputs({ failed: ['areas', 'aether'] }))).toMatch(/quiet start/)
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

describe('open questions block', () => {
  const NOW = new Date('2026-10-02T05:00:00.000Z')
  const ask = (seq: number, question: string, askedAt: string): OpenAskDigest => ({ seq, question, askedAt })

  it('lists every open question oldest first with its Q number and age, then the answer hint', () => {
    const block = buildOpenQuestionsBlock([
      ask(15, 'Is the Gantt rewrite still the priority?', '2026-10-02T04:30:00.000Z'),
      ask(12, 'Should Atlas ship this week?', '2026-09-29T04:30:00.000Z'),
      ask(14, 'What made Tuesday hard?', '2026-10-01T04:30:00.000Z'),
    ], NOW)
    expect(block.split('\n')).toEqual([
      'Open questions (3):',
      'Q12 · 3 days · Should Atlas ship this week?',
      'Q14 · 1 day · What made Tuesday hard?',
      'Q15 · today · Is the Gantt rewrite still the priority?',
      "Reply on Telegram with the number, e.g. 'Q12: …'. 'skip Q12' drops one.",
    ])
  })

  it('clips each question to ~160 chars and strips URLs/headings', () => {
    const block = buildOpenQuestionsBlock([ask(1, `## ${'why '.repeat(80)} https://x.io`, '2026-10-01T00:00:00.000Z')], NOW)
    const line = block.split('\n')[1]!
    expect(line.length).toBeLessThanOrEqual('Q1 · 1 day · '.length + 160)
    expect(line).not.toMatch(/https?:|##/)
    expect(line.endsWith('…')).toBe(true)
  })

  it('is empty with nothing open, and the message is left untouched', () => {
    expect(buildOpenQuestionsBlock([], NOW)).toBe('')
    expect(appendOpenQuestionsBlock('**Today** calm.', [], NOW)).toBe('**Today** calm.')
    expect(appendOpenQuestionsBlock('**Today** calm.', null, NOW)).toBe('**Today** calm.')
  })

  it('appends after the narrative and keeps a full 10-question backlog under the 4000-char cap', () => {
    const asks = Array.from({ length: 10 }, (_, i) => ask(i + 1, `Question ${i + 1} ${'x'.repeat(400)}`, `2026-09-2${i % 10}T04:30:00.000Z`))
    const narrative = 'n'.repeat(MAX_MESSAGE_CHARS)
    const out = appendOpenQuestionsBlock(`${narrative}\n\nWhat I now believe:\n1. a`, asks, NOW)
    expect(out.length).toBeLessThanOrEqual(DAILY_MESSAGE_TOTAL_MAX_CHARS)
    expect(out.startsWith(narrative)).toBe(true)
    for (let seq = 1; seq <= 10; seq++) expect(out).toContain(`Q${seq} · `)
  })

  it('shrinks question lines, then the narrative — never the numbered list — to stay under the cap', () => {
    const asks = Array.from({ length: 10 }, (_, i) => ask(i + 1, 'q'.repeat(300), '2026-09-30T04:30:00.000Z'))
    const out = appendOpenQuestionsBlock('n'.repeat(3900), asks, NOW)
    expect(out.length).toBeLessThanOrEqual(DAILY_MESSAGE_TOTAL_MAX_CHARS)
    for (let seq = 1; seq <= 10; seq++) expect(out).toContain(`Q${seq} · `)
    expect(out).toContain("'skip Q1' drops one.")
  })
})
