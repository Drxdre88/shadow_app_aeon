import { describe, expect, it } from 'vitest'
import { archetypeOutSchema } from '../archetypes-prompt'

const validRow = {
  title: 'Beta auth hardening',
  summary: 'Magic links and connector discovery both shipped this week.',
  body: 'a'.repeat(120),
}

describe('archetypeOutSchema clipping', () => {
  it('clips over-long title, summary, themes and shifts at a word boundary, still rejecting empties', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
    const parsed = archetypeOutSchema.parse({
      archetypes: [{ ...validRow, title: words(30), summary: words(80), themes: ['x'.repeat(60)] }],
      shifts: [words(60)],
    })
    const a = parsed.archetypes[0]
    for (const [s, max] of [[a.title, 80], [a.summary, 300], [a.themes[0], 40], [parsed.shifts[0], 200]] as const) {
      expect(s.length).toBeLessThanOrEqual(max)
      expect(s.endsWith('…')).toBe(true)
    }
    expect(a.title).toMatch(/^word0 word1 .* word\d+…$/)
    expect(() => archetypeOutSchema.parse({ archetypes: [{ ...validRow, title: '   ' }] })).toThrow()
    expect(() => archetypeOutSchema.parse({ archetypes: [validRow], shifts: [''] })).toThrow()
  })

  it('keeps the body length rule strict', () => {
    expect(() => archetypeOutSchema.parse({ archetypes: [{ ...validRow, body: 'b'.repeat(2001) }] })).toThrow()
  })
})
