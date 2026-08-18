import { describe, it, expect } from 'vitest'
import { DEFAULT_SHORTCUTS } from '@aeon/shared'

describe('DEFAULT_SHORTCUTS', () => {
  it('binds every board action to a distinct key', () => {
    const keys = Object.values(DEFAULT_SHORTCUTS)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses single lowercase characters', () => {
    for (const key of Object.values(DEFAULT_SHORTCUTS)) {
      expect(key).toMatch(/^[a-z0-9]$/)
    }
  })

  it('keeps the card hover bindings stable', () => {
    expect(DEFAULT_SHORTCUTS.setSize).toBe('t')
    expect(DEFAULT_SHORTCUTS.setProgress).toBe('p')
    expect(DEFAULT_SHORTCUTS.toggleDates).toBe('d')
  })
})
