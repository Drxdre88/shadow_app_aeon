import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  formatNumberedAck,
  hasNumberedMatches,
  mightContainNumberedAnswers,
  parseNumberedAnswers,
} from '../ask-numbered'

const OPEN = [12, 14, 15]

describe('parseNumberedAnswers', () => {
  it.each([
    ['Q12: yes, ship it', 'yes, ship it'],
    ['Q12 - yes, ship it', 'yes, ship it'],
    ['Q12) yes, ship it', 'yes, ship it'],
    ['q12: yes, ship it', 'yes, ship it'],
    ['  Q12 — yes, ship it  ', 'yes, ship it'],
  ])('accepts %j', (body, text) => {
    expect(parseNumberedAnswers(body, OPEN)).toEqual({ answers: [{ seq: 12, text }], skips: [] })
  })

  it('splits several blocks: each label starts a block until the next', () => {
    const body = 'Q12: yes, ship it.\nIt is ready.\nQ14) Tuesday was the deploy.\n\nQ15 - keep it'
    expect(parseNumberedAnswers(body, OPEN).answers).toEqual([
      { seq: 12, text: 'yes, ship it.\nIt is ready.' },
      { seq: 14, text: 'Tuesday was the deploy.' },
      { seq: 15, text: 'keep it' },
    ])
  })

  it('splits blocks on one line after sentence punctuation', () => {
    expect(parseNumberedAnswers('Q12: yes. Q14: no', OPEN).answers).toEqual([
      { seq: 12, text: 'yes.' },
      { seq: 14, text: 'no' },
    ])
  })

  it('reads skip / drop commands, including lists', () => {
    expect(parseNumberedAnswers('skip Q12', OPEN)).toEqual({ answers: [], skips: [12] })
    expect(parseNumberedAnswers('drop Q14, Q15', OPEN)).toEqual({ answers: [], skips: [14, 15] })
    expect(parseNumberedAnswers('Q12: yes\nskip Q14 and Q15', OPEN)).toEqual({
      answers: [{ seq: 12, text: 'yes' }],
      skips: [14, 15],
    })
  })

  it('ignores labels and skips for numbers that are not open (text flows to chat)', () => {
    const none = parseNumberedAnswers('Q99: what about this?\nskip Q98', OPEN)
    expect(none).toEqual({ answers: [], skips: [] })
    expect(hasNumberedMatches(none)).toBe(false)
    // A non-open label inside an open block is just text of that block.
    expect(parseNumberedAnswers('Q12: yes\nQ99: still Q12', OPEN).answers).toEqual([{ seq: 12, text: 'yes\nQ99: still Q12' }])
  })

  it('requires the Q prefix — bare numbered card-note lines are never matched', () => {
    expect(parseNumberedAnswers('12. shipped the fix\n14) wrote docs', OPEN)).toEqual({ answers: [], skips: [] })
    expect(mightContainNumberedAnswers('1. first card\n2. second card')).toBe(false)
  })

  it('does not read a mid-sentence quarter as a label', () => {
    expect(parseNumberedAnswers('revenue in Q12 - Q14 looked flat', OPEN)).toEqual({ answers: [], skips: [] })
  })

  it('drops an empty block and lets an answer win over a skip of the same question', () => {
    expect(parseNumberedAnswers('Q12:', OPEN)).toEqual({ answers: [], skips: [] })
    expect(parseNumberedAnswers('skip Q12\nQ12: actually, yes', OPEN)).toEqual({ answers: [{ seq: 12, text: 'actually, yes' }], skips: [] })
  })

  it('matches nothing when nothing is open', () => {
    expect(parseNumberedAnswers('Q12: yes', [])).toEqual({ answers: [], skips: [] })
  })

  it('only routes messages that START with a Q label or a skip command', () => {
    expect(parseNumberedAnswers('Thanks. Q12 - not sure yet', OPEN)).toEqual({ answers: [], skips: [] })
    expect(parseNumberedAnswers('Also, skip Q12', OPEN)).toEqual({ answers: [], skips: [] })
    expect(mightContainNumberedAnswers('  Q12: yes')).toBe(true)
    expect(mightContainNumberedAnswers('skip Q12')).toBe(true)
  })

  it('treats a short question back to Kairos as chat, not an answer', () => {
    expect(parseNumberedAnswers('Q12: what do you mean by leverage?', OPEN)).toEqual({ answers: [], skips: [] })
    expect(parseNumberedAnswers('Q12: yes, ship it.\nQ14: which deploy do you mean?', OPEN).answers).toEqual([
      { seq: 12, text: 'yes, ship it.' },
    ])
  })

  fcTest.prop([
    fc.string({ maxLength: 300 }),
    fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 8 }),
  ])('never matches a number that is not open', (body, open) => {
    const parsed = parseNumberedAnswers(body, open)
    const openSet = new Set(open)
    for (const a of parsed.answers) expect(openSet.has(a.seq)).toBe(true)
    for (const s of parsed.skips) expect(openSet.has(s)).toBe(true)
  })

  fcTest.prop([
    fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 6 }),
    fc.integer({ min: 1, max: 60 }),
  ])('never matches non-open numbers even in well-formed answer messages', (open, labelled) => {
    fc.pre(!open.includes(labelled))
    expect(parseNumberedAnswers(`Q${labelled}: yes\nskip Q${labelled}`, open)).toEqual({ answers: [], skips: [] })
  })

  // Answer text from an alphabet with no Q/punctuation, so it can never look like a label.
  const answerText = fc.stringMatching(/^[a-z ]{0,30}[a-z]$/)
  const separator = fc.constantFrom(': ', ' - ', ') ', ' — ')

  fcTest.prop([
    fc.uniqueArray(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 6 }),
    fc.array(fc.tuple(answerText, separator), { minLength: 6, maxLength: 6 }),
  ])('splits a multi-block message into exactly its blocks, in order', (seqs, parts) => {
    const body = seqs.map((seq, i) => `Q${seq}${parts[i]![1]}${parts[i]![0]}`).join('\n')
    expect(parseNumberedAnswers(body, seqs)).toEqual({
      answers: seqs.map((seq, i) => ({ seq, text: parts[i]![0].trim() })),
      skips: [],
    })
  })
})

describe('formatNumberedAck', () => {
  it('lists answered, skipped, failed and what is still open', () => {
    expect(formatNumberedAck({ answered: [14, 12], skipped: [], failed: [], stillOpen: [16, 15] }))
      .toBe('✓ Q12, Q14 · still open: Q15, Q16')
    expect(formatNumberedAck({ answered: [], skipped: [13], failed: [17], stillOpen: [] }))
      .toBe("skipped Q13 · couldn't record Q17 · nothing else open")
  })
})
