import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '@aeon/shared'
import { useThemeStore } from '@/stores/themeStore'

const initial = useThemeStore.getState()

beforeEach(() => {
  useThemeStore.setState(initial, true)
})

describe('businessMode persistence', () => {
  it('defaults to off so existing accounts keep their look', () => {
    expect(useThemeStore.getState().businessMode).toBe(false)
  })

  it('hydrates businessMode from stored preferences', () => {
    useThemeStore.getState()._hydrateFromDB({ businessMode: true, glowIntensity: 20 })
    expect(useThemeStore.getState().businessMode).toBe(true)
    expect(useThemeStore.getState().glowIntensity).toBe(20)
  })

  it('seeds a restore snapshot so toggling business mode off after a reload works', () => {
    useThemeStore.getState()._hydrateFromDB({ businessMode: true, glowIntensity: 20 })
    useThemeStore.getState().setBusinessMode(false)
    const state = useThemeStore.getState()
    expect(state.businessMode).toBe(false)
    expect(state.glowIntensity).toBe(DEFAULT_PREFERENCES.glowIntensity)
    expect(state.dragEffect).toBe(DEFAULT_PREFERENCES.dragEffect)
  })

  it('leaves the snapshot empty when business mode is off', () => {
    useThemeStore.getState()._hydrateFromDB({ glowIntensity: 55 })
    expect(useThemeStore.getState()._businessSnapshot).toBeNull()
    expect(useThemeStore.getState().businessMode).toBe(false)
  })

  it('ships a sober celebration default', () => {
    expect(useThemeStore.getState().celebrationStyle).toBe('checkmark-pulse')
    expect(DEFAULT_PREFERENCES.celebrationStyle).toBe('checkmark-pulse')
  })
})
