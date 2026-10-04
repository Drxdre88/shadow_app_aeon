import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { detectBid, detectNotNow, goalTerms, isTerse, scoreChangeTalk } from '../lexicon'

describe('scoreChangeTalk', () => {
  it.each([
    ["I'll book the physio tomorrow", { commit: 1, prep: 0, sustain: 0 }],
    ["I've started the marathon plan", { commit: 1, prep: 0, sustain: 0 }],
    ['I want to run a marathon', { commit: 0, prep: 1, sustain: 0 }],
    ['I could maybe try, I should really', { commit: 0, prep: 2, sustain: 0 }],
    ["I can't, no time this week", { commit: 0, prep: 0, sustain: 2 }],
    ["I'm not going to do the course", { commit: 0, prep: 0, sustain: 1 }],
    ["I'll never finish it", { commit: 0, prep: 0, sustain: 1 }],
    ["I don't think I'll go", { commit: 0, prep: 0, sustain: 1 }],
    ['signed up for the 10k, done', { commit: 2, prep: 0, sustain: 0 }],
    ['the weather is nice', { commit: 0, prep: 0, sustain: 0 }],
  ])('%s', (text, expected) => {
    expect(scoreChangeTalk(text)).toMatchObject(expected)
  })

  it('handles curly apostrophes and records markers', () => {
    const talk = scoreChangeTalk('I’ll do it')
    expect(talk.commit).toBe(1)
    expect(talk.markers).toEqual(["i'll"])
  })

  it('does not read "ill" as a commitment', () => {
    expect(scoreChangeTalk('I feel ill today').commit).toBe(0)
  })

  test.prop([fc.string({ maxLength: 300 })])('never throws and counts are non-negative integers', (text) => {
    const t = scoreChangeTalk(text)
    for (const n of [t.commit, t.prep, t.sustain]) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
    }
    expect(t.markers.every((m) => m.length <= 60)).toBe(true)
  })

  test.prop([fc.constantFrom('book it', 'start', 'do the run', 'call her')])('negating a commitment turns it into sustain talk', (rest) => {
    expect(scoreChangeTalk(`I'll ${rest}`).commit).toBe(1)
    const negated = scoreChangeTalk(`I won't ${rest}`)
    expect(negated.commit).toBe(0)
    expect(negated.sustain).toBeGreaterThan(0)
  })
})

describe('detectBid', () => {
  it.each([
    ['https://example.com/cat.gif', 'link'],
    ['hahaha', 'laugh'],
    ['lol that is so true', 'laugh'],
    ['ugh', 'sigh'],
    ['🙄 mondays', 'sigh'],
    ['finally shipped it!!!', 'cheer'],
    ['🎉', 'cheer'],
  ])('%s → %s', (text, kind) => {
    expect(detectBid(text)).toBe(kind)
  })

  it.each([
    'ugh, why is the build failing?',
    'add a card for the lol bug',
    'what do you think haha',
    'haha '.repeat(13),
    'I finished the report and sent it over',
  ])('not a bid: %s', (text) => {
    expect(detectBid(text)).toBeNull()
  })

  test.prop([fc.string({ maxLength: 200 })])('a question is never a bid', (text) => {
    expect(detectBid(`${text}?`)).toBeNull()
  })
})

describe('detectNotNow', () => {
  it.each(['not now', 'Not now, busy', 'later.', 'busy', 'stop', 'leave it please', 'can’t talk', 'not today mate', 'stop asking me about it'])('%s', (text) => {
    expect(detectNotNow(text)).toBe(true)
  })

  it.each(['see you later!', 'stop the timer on the card', 'enough about me, how was your day', "I'll do it later", 'not now — but in this very long message I explain everything about the plan for next week'.replace(/^not now — /, 'well ')])('not a "not now": %s', (text) => {
    expect(detectNotNow(text)).toBe(false)
  })
})

describe('isTerse / goalTerms', () => {
  it('terse replies', () => {
    expect(isTerse('ok')).toBe(true)
    expect(isTerse('fine.')).toBe(true)
    expect(isTerse('sounds good, thanks')).toBe(true)
    expect(isTerse('yes I read it and I think we should go ahead')).toBe(false)
  })

  it('goal terms stem and drop filler', () => {
    expect(goalTerms('Running the marathons')).toEqual(['runn', 'marathon'])
    expect(goalTerms("I'll book the physio")).toEqual(['book', 'physio'])
  })
})
