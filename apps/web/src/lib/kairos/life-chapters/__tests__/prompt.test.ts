import { describe, expect, it } from 'vitest'
import { lintChapter, parseLifeChapterText, buildLifeChapterPrompt, LIFE_CHAPTER_SYSTEM_PROMPT } from '../prompt'
import { renderChapterContinuity, renderChapterNotice, renderLifeChapterMarkdown, renderLifeChaptersMarkdown, CHAPTER_CONTINUITY_MAX_CHARS } from '../render'
import { citableIds, hasChapterSignal, type LifeChapterInputs } from '../inputs'

const VALID = new Set(['a', 'b', 'c'])

const inputs = (o: Partial<LifeChapterInputs> = {}): LifeChapterInputs => ({
  month: '2026-09', reviews: [], beliefs: [], predictions: [], promises: [], goals: [], constitution: [],
  aether: { start: null, end: null }, previous: null, errors: [], ...o,
})

describe('parseLifeChapterText', () => {
  it('drops items whose ids do not ground and keeps only listed ids', () => {
    const out = parseLifeChapterText(JSON.stringify({
      title: 'T', summary: 'S',
      turningPoints: [{ what: 'w', before: 'b', after: 'a', evidenceIds: ['a', 'zzz'] }, { what: 'no ids', evidenceIds: [] }],
      whatChanged: [{ text: 'c', evidenceIds: ['zzz'] }, { text: 'ok', evidenceIds: ['b', 'b'] }],
      unresolved: ['open', '', 7],
    }), VALID)
    expect(out.turningPoints).toEqual([{ what: 'w', before: 'b', after: 'a', evidenceIds: ['a'] }])
    expect(out.whatChanged).toEqual([{ text: 'ok', evidenceIds: ['b'] }])
    expect(out.unresolved).toEqual(['open'])
    expect(out.dropped).toBe(2)
  })

  it('unresolved is required; a missing title fails the envelope', () => {
    expect(() => parseLifeChapterText(JSON.stringify({ title: 'T', summary: 'S' }), VALID)).toThrow()
    expect(() => parseLifeChapterText(JSON.stringify({ title: ' ', summary: 'S', unresolved: [] }), VALID)).toThrow()
    expect(parseLifeChapterText(JSON.stringify({ title: 'T', summary: 'S', unresolved: [] }), VALID).unresolved).toEqual([])
  })

  it('caps turning points at 4', () => {
    const tp = Array.from({ length: 6 }, (_, i) => ({ what: `w${i}`, evidenceIds: ['a'] }))
    const out = parseLifeChapterText(JSON.stringify({ title: 'T', summary: 'S', turningPoints: tp, unresolved: [] }), VALID)
    expect(out.turningPoints).toHaveLength(4)
    expect(out.dropped).toBe(2)
  })
})

describe('lint is measurement only', () => {
  it('counts grand words, and no renderer ever shows lintHits', () => {
    const c = { title: 'My journey', summary: 'I was finally at peace.', turningPoints: [], whatChanged: [], unresolved: [] }
    expect(lintChapter(c)).toBe(3)
    const meta = { ...c, month: '2026-09', lintHits: 98765 }
    expect(renderLifeChapterMarkdown('2026-09', meta)).not.toContain('98765')
    expect(renderChapterContinuity(meta)).not.toContain('98765')
    expect(JSON.stringify(renderChapterNotice('2026-09', meta))).not.toContain('98765')
  })
})

describe('prompt', () => {
  it('previous chapter is context only: shown, never in the citable ids', () => {
    const i = inputs({
      reviews: [{ id: 'rev', isoWeek: 'W', summary: 's', wins: [], drift: [] }],
      previous: { month: '2026-08', title: 'August', summary: 'Quiet.', unresolved: ['auth'] },
    })
    const p = buildLifeChapterPrompt(i)
    expect(p).toContain('never cite')
    expect(p).toContain('- auth')
    expect(citableIds(i)).toEqual(['rev'])
  })

  it('signal needs 3 citable ids beyond Aether', () => {
    const goals = [{ id: 'g1', title: 't', state: 'done', at: '2026-09-02' }, { id: 'g2', title: 't', state: 'done', at: '2026-09-02' }]
    expect(hasChapterSignal(inputs({ goals, aether: { start: { id: 'a1', text: 'x' }, end: { id: 'a2', text: 'y' } } }))).toBe(false)
    expect(hasChapterSignal(inputs({ goals: [...goals, { id: 'g3', title: 't', state: 'failed', at: '2026-09-03' }] }))).toBe(true)
  })

  it('system prompt forbids invented endings and keeps the plain tone', () => {
    expect(LIFE_CHAPTER_SYSTEM_PROMPT).toMatch(/No invented endings/)
    expect(LIFE_CHAPTER_SYSTEM_PROMPT).toMatch(/flat month is said to be flat/)
    expect(LIFE_CHAPTER_SYSTEM_PROMPT).toMatch(/No cosmic, mystical or theatrical imagery/)
  })
})

describe('renderers', () => {
  it('continuity is capped at 600 characters', () => {
    const long = renderChapterContinuity({ month: '2026-09', title: 'T', summary: 'x'.repeat(2000), unresolved: ['y'] })
    expect(long.length).toBeLessThanOrEqual(CHAPTER_CONTINUITY_MAX_CHARS)
  })

  it('markdown list handles no chapters', () => {
    expect(renderLifeChaptersMarkdown([])).toContain('No chapter written yet.')
  })
})
