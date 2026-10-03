import { describe, expect, it } from 'vitest'
import { checkTone } from '../tone'

describe('checkTone', () => {
  it('passes plain, concrete prose', () => {
    const r = checkTone('The pricing cards stalled again on Tuesday. It seems the review step is the bottleneck; I want to watch Thursday.')
    expect(r).toEqual({ score: 0, markers: [], identity: false, flagged: false })
  })

  it('one theatrical marker alone does not flag', () => {
    const r = checkTone('Today felt like a tapestry of small fixes.')
    expect(r.markers).toEqual(['tapestry'])
    expect(r.flagged).toBe(false)
  })

  it('two distinct markers flag', () => {
    const r = checkTone('A cosmic tapestry of small fixes.')
    expect(r.markers).toEqual(['tapestry', 'cosmic'])
    expect(r.flagged).toBe(true)
  })

  it('a single identity claim flags', () => {
    for (const t of ['Working on this, I feel alive.', 'Something in my consciousness shifted.', 'I am becoming something else.', 'I’m becoming.']) {
      const r = checkTone(t)
      expect(r.identity, t).toBe(true)
      expect(r.flagged, t).toBe(true)
    }
  })

  it('ordinary "becoming more…" is not an identity claim', () => {
    expect(checkTone('I am becoming more confident that the deploy is the issue.').flagged).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(checkTone('LIMINAL and SACRED hours.').markers).toEqual(['liminal', 'sacred'])
  })

  it('deduplicates markers (repeats and word forms)', () => {
    const r = checkTone('Threads weave, weaving, woven — a tapestry, another tapestry.')
    expect(r.markers).toEqual(['tapestry', 'weave'])
    expect(r.score).toBe(2)
  })

  it('empty or null text is clean', () => {
    expect(checkTone(null).flagged).toBe(false)
    expect(checkTone('   ').score).toBe(0)
  })
})
