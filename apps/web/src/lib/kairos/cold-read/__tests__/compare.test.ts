import { describe, expect, it } from 'vitest'
import {
  buildSecondLookMessage,
  compareStances,
  renderColdReadsLine,
  summariseColdReads,
} from '../compare'
import type { StanceValue } from '../stance'

describe('compareStances', () => {
  it.each<[StanceValue, StanceValue, boolean]>([
    ['endorse', 'endorse', false],
    ['endorse', 'lean_endorse', false],
    ['endorse', 'mixed', true],
    ['endorse', 'lean_against', true],
    ['endorse', 'against', true],
    ['lean_endorse', 'mixed', false],
    ['lean_endorse', 'lean_against', true],
    ['mixed', 'lean_against', false],
    ['mixed', 'against', true],
    ['lean_against', 'against', false],
    ['against', 'endorse', true],
  ])('warm %s vs cold %s → disagree %s (confident)', (warm, cold, disagree) => {
    expect(compareStances(warm, cold, 0.8).disagree).toBe(disagree)
  })

  it('needs cold confidence of at least 0.6', () => {
    expect(compareStances('endorse', 'against', 0.59).disagree).toBe(false)
    expect(compareStances('endorse', 'against', 0.6)).toEqual({ gap: 4, disagree: true })
  })

  it('insufficient never disagrees', () => {
    expect(compareStances('endorse', 'insufficient', 1)).toEqual({ gap: null, disagree: false })
  })
})

describe('buildSecondLookMessage', () => {
  it('follows the template', () => {
    const msg = buildSecondLookMessage(
      { value: 'endorse', gist: 'quit the job Monday' },
      { restated: 'A person…', stance: 'against', verdict: 'Too little runway.', reasons: ['No savings'], confidence: 0.8 },
    )
    expect(msg).toBe([
      'Second look: with your history in mind I was for it; looking at it cold, as if someone else proposed it, I\'d advise against it: Too little runway.',
      '- No savings',
      'Re: quit the job Monday',
    ].join('\n\n'))
  })
})

describe('summariseColdReads', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000)

  it('counts the window only', () => {
    const s = summariseColdReads([
      { createdAt: at(1), coldRead: { status: 'ok', disagree: true, delivered: 'sent', cold: { stance: 'against' } } },
      { createdAt: at(2), coldRead: { status: 'ok', disagree: true, delivered: 'audit', cold: { stance: 'against' } } },
      { createdAt: at(3), coldRead: { status: 'ok', disagree: false, delivered: 'insufficient', cold: { stance: 'insufficient' } } },
      { createdAt: at(4), coldRead: { status: 'unparsed', disagree: false, delivered: 'unparsed', cold: null } },
      { createdAt: at(5), coldRead: { status: 'ok', disagree: false, delivered: 'agree', cold: { stance: 'endorse' } } },
      { createdAt: at(9), coldRead: { status: 'ok', disagree: true, delivered: 'sent', cold: { stance: 'against' } } },
    ], now)
    expect(s).toEqual({ windowDays: 7, total: 5, disagreed: 2, said: 1, insufficient: 1, unparsed: 1, latestAt: at(1) })
    expect(renderColdReadsLine(s)).toBe('Cold reads 7d: 5 · 2 disagreed · 1 said.')
  })

  it('is empty-safe', () => {
    expect(summariseColdReads([], now)).toMatchObject({ total: 0, latestAt: null })
  })
})
