import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from '../themeStore'

describe('smoothUiRenders preference', () => {
  beforeEach(() => useThemeStore.setState({ smoothUiRenders: true }))

  it('defaults to true (polished animations on)', () => {
    expect(useThemeStore.getState().smoothUiRenders).toBe(true)
  })

  it('setSmoothUiRenders toggles it off', () => {
    useThemeStore.getState().setSmoothUiRenders(false)
    expect(useThemeStore.getState().smoothUiRenders).toBe(false)
  })

  it('round-trips through DB hydration (must be in the persist allowlist)', () => {
    useThemeStore.getState()._hydrateFromDB({ smoothUiRenders: false })
    expect(useThemeStore.getState().smoothUiRenders).toBe(false)
  })
})
