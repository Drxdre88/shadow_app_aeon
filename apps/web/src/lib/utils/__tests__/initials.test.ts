import { describe, it, expect } from 'vitest'
import { getInitials } from '../initials'

describe('getInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getInitials('Jane Doe')).toBe('JD')
    expect(getInitials('ada lovelace jr')).toBe('AL')
  })

  it('falls back to a single letter for one-word names', () => {
    expect(getInitials('Cher')).toBe('C')
  })

  it('collapses irregular whitespace', () => {
    expect(getInitials('  Jane   Doe  ')).toBe('JD')
  })

  it('returns the fallback for empty / missing names', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
    expect(getInitials(null)).toBe('?')
    expect(getInitials(undefined)).toBe('?')
    expect(getInitials(null, '·')).toBe('·')
  })

  // The bug this helper exists to kill: splitting on UTF-16 code units cut an
  // astral-plane lead character in half and rendered a replacement box.
  it('keeps astral-plane lead characters whole', () => {
    expect(getInitials('🚀 Rocket')).toBe('🚀R')
    expect(getInitials('🚀')).toBe('🚀')
    expect(getInitials('𠜎 Wong')).toBe('𠜎W')
  })

  it('never emits a lone surrogate', () => {
    for (const name of ['🚀 Rocket', '🚀', '𠜎 Wong', '👩‍🚀 Crew']) {
      const out = getInitials(name)
      for (const unit of out) {
        const code = unit.charCodeAt(0)
        if (code >= 0xd800 && code <= 0xdbff) expect(unit.length).toBe(2)
      }
      expect(out).not.toContain('�')
    }
  })

  it('leaves non-latin scripts alone rather than mangling them', () => {
    expect(getInitials('Мария Иванова')).toBe('МИ')
  })
})
