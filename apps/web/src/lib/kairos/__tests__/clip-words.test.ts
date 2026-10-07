import { describe, expect, it } from 'vitest'
import { clipAtWord } from '../clip-words'

describe('clipAtWord', () => {
  it('leaves text within the limit untouched', () => {
    expect(clipAtWord('short title', 80)).toBe('short title')
    expect(clipAtWord('x'.repeat(80), 80)).toBe('x'.repeat(80))
  })

  it('clips a 400-char question to a varchar(255) title at a word boundary', () => {
    const question = `${'Should the beta auth hardening ship before the mobile work resumes, '.repeat(6)}or wait?`.slice(0, 400)
    const title = clipAtWord(question, 255)
    expect(question.length).toBe(400)
    expect(title.length).toBeLessThanOrEqual(255)
    expect(title.endsWith('…')).toBe(true)
    expect(question.startsWith(title.slice(0, -1))).toBe(true)
    expect(question[title.length - 1]).toMatch(/[\s,]/)
  })

  it('hard-cuts a single unbroken token and drops trailing punctuation', () => {
    expect(clipAtWord('x'.repeat(60), 40)).toBe(`${'x'.repeat(39)}…`)
    expect(clipAtWord(`${'word '.repeat(10)}tail`, 16)).toBe('word word word…')
  })
})
