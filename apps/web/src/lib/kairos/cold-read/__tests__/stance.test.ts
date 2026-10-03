import { describe, expect, it } from 'vitest'
import { extractStance, parseStanceBody } from '../stance'

describe('extractStance', () => {
  it('strips an unclosed tag with a trailing newline or a gist on the next line', () => {
    for (const reply of ['Go for it.\n<stance>endorse — solid plan\n', 'Go for it.\n<stance>endorse\n— solid plan']) {
      const out = extractStance(reply)
      expect(out.text).toBe('Go for it.')
      expect(out.text).not.toMatch(/stance/i)
      expect(out.stance?.value).toBe('endorse')
    }
  })

  it('extracts the stance from the final line and strips it', () => {
    const out = extractStance('Do it — the numbers hold.\n\n<stance>lean_endorse — ship the pricing change this week</stance>')
    expect(out.text).toBe('Do it — the numbers hold.')
    expect(out.stance).toEqual({ value: 'lean_endorse', gist: 'ship the pricing change this week' })
  })

  it('strips tags anywhere, with odd case and spacing, including inside fences', () => {
    const text = 'Plan A.\n```\n< STANCE >Against : nope</ stance >\n```\nMore.\n<Stance> mixed | both sides </Stance>'
    const out = extractStance(text)
    expect(out.text).not.toMatch(/stance/i)
    expect(out.text).toContain('Plan A.')
    expect(out.text).toContain('More.')
    expect(out.stance).toEqual({ value: 'mixed', gist: 'both sides' })
  })

  it('leaves text without a tag byte-identical', () => {
    const text = 'Plain reply.\n\n\n\nWith gaps.  '
    expect(extractStance(text)).toEqual({ text, stance: null })
  })

  it('strips an invalid value and returns no stance', () => {
    const out = extractStance('Reply.\n<stance>love_it — whatever</stance>')
    expect(out).toEqual({ text: 'Reply.', stance: null })
  })

  it('strips a cut-off tag on the last line', () => {
    const out = extractStance('Reply.\n<stance>against — runs out of')
    expect(out).toEqual({ text: 'Reply.', stance: { value: 'against', gist: 'runs out of' } })
  })

  it('uses the last valid tag when several are present', () => {
    const out = extractStance('<stance>endorse — a</stance> body <stance>against — b</stance>')
    expect(out.stance?.value).toBe('against')
    expect(out.text).toBe('body')
  })
})

describe('parseStanceBody', () => {
  it('accepts spaced or hyphenated values and no gist', () => {
    expect(parseStanceBody('Lean against')).toEqual({ value: 'lean_against', gist: '' })
    expect(parseStanceBody('lean-endorse - fine')).toEqual({ value: 'lean_endorse', gist: 'fine' })
  })

  it('rejects empty bodies', () => {
    expect(parseStanceBody('   ')).toBeNull()
  })
})
