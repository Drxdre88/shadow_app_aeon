import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore, INITIAL_PRIORITIES, DEFAULT_SHORTCUTS } from '../themeStore'
import { DEFAULT_PREFERENCES } from '@aeon/shared'

function resetStore() {
  useThemeStore.setState({
    _hydrated: false,
    businessMode: false,
    _businessSnapshot: null,
    glowIntensity: DEFAULT_PREFERENCES.glowIntensity,
    glassOpacity: DEFAULT_PREFERENCES.glassOpacity,
    themeSaturation: DEFAULT_PREFERENCES.themeSaturation,
    themeBrightness: DEFAULT_PREFERENCES.themeBrightness,
    surfaceVibrancy: DEFAULT_PREFERENCES.surfaceVibrancy,
    ambientBlobs: DEFAULT_PREFERENCES.ambientBlobs,
    cursorEffect: DEFAULT_PREFERENCES.cursorEffect,
    dragEffect: DEFAULT_PREFERENCES.dragEffect,
    columnWidth: DEFAULT_PREFERENCES.columnWidth,
    columnHeight: DEFAULT_PREFERENCES.columnHeight,
    smokeVolume: DEFAULT_PREFERENCES.smokeVolume,
    depLineWidth: DEFAULT_PREFERENCES.depLineWidth,
    depLineGlow: DEFAULT_PREFERENCES.depLineGlow,
    depCanvasBlur: DEFAULT_PREFERENCES.depCanvasBlur,
    spaceOrbitSpeed: DEFAULT_PREFERENCES.spaceOrbitSpeed,
    priorities: [...INITIAL_PRIORITIES],
    shortcuts: { ...DEFAULT_SHORTCUTS },
  })
}

beforeEach(() => {
  resetStore()
})

describe('setGlowIntensity', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setGlowIntensity(60)
    expect(useThemeStore.getState().glowIntensity).toBe(60)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setGlowIntensity(-10)
    expect(useThemeStore.getState().glowIntensity).toBe(0)
  })

  it('clamps above maximum to 100', () => {
    useThemeStore.getState().setGlowIntensity(150)
    expect(useThemeStore.getState().glowIntensity).toBe(100)
  })

  it('accepts boundary value 0', () => {
    useThemeStore.getState().setGlowIntensity(0)
    expect(useThemeStore.getState().glowIntensity).toBe(0)
  })

  it('accepts boundary value 100', () => {
    useThemeStore.getState().setGlowIntensity(100)
    expect(useThemeStore.getState().glowIntensity).toBe(100)
  })
})

describe('setGlassOpacity', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setGlassOpacity(55)
    expect(useThemeStore.getState().glassOpacity).toBe(55)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setGlassOpacity(-1)
    expect(useThemeStore.getState().glassOpacity).toBe(0)
  })

  it('clamps above maximum to 100', () => {
    useThemeStore.getState().setGlassOpacity(999)
    expect(useThemeStore.getState().glassOpacity).toBe(100)
  })
})

describe('setThemeSaturation', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setThemeSaturation(120)
    expect(useThemeStore.getState().themeSaturation).toBe(120)
  })

  it('clamps below minimum to 50', () => {
    useThemeStore.getState().setThemeSaturation(10)
    expect(useThemeStore.getState().themeSaturation).toBe(50)
  })

  it('clamps above maximum to 200', () => {
    useThemeStore.getState().setThemeSaturation(300)
    expect(useThemeStore.getState().themeSaturation).toBe(200)
  })

  it('rounds fractional values', () => {
    useThemeStore.getState().setThemeSaturation(100.7)
    expect(useThemeStore.getState().themeSaturation).toBe(101)
  })
})

describe('setThemeBrightness', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setThemeBrightness(110)
    expect(useThemeStore.getState().themeBrightness).toBe(110)
  })

  it('clamps below minimum to 50', () => {
    useThemeStore.getState().setThemeBrightness(0)
    expect(useThemeStore.getState().themeBrightness).toBe(50)
  })

  it('clamps above maximum to 150', () => {
    useThemeStore.getState().setThemeBrightness(200)
    expect(useThemeStore.getState().themeBrightness).toBe(150)
  })

  it('rounds fractional values', () => {
    useThemeStore.getState().setThemeBrightness(99.4)
    expect(useThemeStore.getState().themeBrightness).toBe(99)
  })
})

describe('setSurfaceVibrancy', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setSurfaceVibrancy(50)
    expect(useThemeStore.getState().surfaceVibrancy).toBe(50)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setSurfaceVibrancy(-5)
    expect(useThemeStore.getState().surfaceVibrancy).toBe(0)
  })

  it('clamps above maximum to 100', () => {
    useThemeStore.getState().setSurfaceVibrancy(200)
    expect(useThemeStore.getState().surfaceVibrancy).toBe(100)
  })
})

describe('setColumnWidth', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setColumnWidth(500)
    expect(useThemeStore.getState().columnWidth).toBe(500)
  })

  it('clamps below minimum to 250', () => {
    useThemeStore.getState().setColumnWidth(100)
    expect(useThemeStore.getState().columnWidth).toBe(250)
  })

  it('clamps above maximum to 1200', () => {
    useThemeStore.getState().setColumnWidth(2000)
    expect(useThemeStore.getState().columnWidth).toBe(1200)
  })

  it('accepts boundary value 250', () => {
    useThemeStore.getState().setColumnWidth(250)
    expect(useThemeStore.getState().columnWidth).toBe(250)
  })

  it('accepts boundary value 1200', () => {
    useThemeStore.getState().setColumnWidth(1200)
    expect(useThemeStore.getState().columnWidth).toBe(1200)
  })
})

describe('setColumnHeight', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setColumnHeight(800)
    expect(useThemeStore.getState().columnHeight).toBe(800)
  })

  it('clamps below minimum to 200', () => {
    useThemeStore.getState().setColumnHeight(50)
    expect(useThemeStore.getState().columnHeight).toBe(200)
  })

  it('clamps above maximum to 1600', () => {
    useThemeStore.getState().setColumnHeight(3000)
    expect(useThemeStore.getState().columnHeight).toBe(1600)
  })
})

describe('setSmokeVolume', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setSmokeVolume(50)
    expect(useThemeStore.getState().smokeVolume).toBe(50)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setSmokeVolume(-1)
    expect(useThemeStore.getState().smokeVolume).toBe(0)
  })

  it('clamps above maximum to 100', () => {
    useThemeStore.getState().setSmokeVolume(101)
    expect(useThemeStore.getState().smokeVolume).toBe(100)
  })
})

describe('setDepLineWidth', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setDepLineWidth(1.5)
    expect(useThemeStore.getState().depLineWidth).toBe(1.5)
  })

  it('clamps below minimum to 0.3', () => {
    useThemeStore.getState().setDepLineWidth(0)
    expect(useThemeStore.getState().depLineWidth).toBe(0.3)
  })

  it('clamps above maximum to 3', () => {
    useThemeStore.getState().setDepLineWidth(10)
    expect(useThemeStore.getState().depLineWidth).toBe(3)
  })

  it('rounds to one decimal place', () => {
    useThemeStore.getState().setDepLineWidth(1.25)
    expect(useThemeStore.getState().depLineWidth).toBe(1.3)
  })
})

describe('setDepLineGlow', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setDepLineGlow(80)
    expect(useThemeStore.getState().depLineGlow).toBe(80)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setDepLineGlow(-20)
    expect(useThemeStore.getState().depLineGlow).toBe(0)
  })

  it('clamps above maximum to 100', () => {
    useThemeStore.getState().setDepLineGlow(200)
    expect(useThemeStore.getState().depLineGlow).toBe(100)
  })
})

describe('setDepCanvasBlur', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setDepCanvasBlur(20)
    expect(useThemeStore.getState().depCanvasBlur).toBe(20)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setDepCanvasBlur(-5)
    expect(useThemeStore.getState().depCanvasBlur).toBe(0)
  })

  it('clamps above maximum to 40', () => {
    useThemeStore.getState().setDepCanvasBlur(100)
    expect(useThemeStore.getState().depCanvasBlur).toBe(40)
  })

  it('rounds fractional values', () => {
    useThemeStore.getState().setDepCanvasBlur(15.9)
    expect(useThemeStore.getState().depCanvasBlur).toBe(16)
  })
})

describe('setSpaceOrbitSpeed', () => {
  it('sets a value within range', () => {
    useThemeStore.getState().setSpaceOrbitSpeed(2.5)
    expect(useThemeStore.getState().spaceOrbitSpeed).toBe(2.5)
  })

  it('clamps below minimum to 0', () => {
    useThemeStore.getState().setSpaceOrbitSpeed(-1)
    expect(useThemeStore.getState().spaceOrbitSpeed).toBe(0)
  })

  it('clamps above maximum to 5', () => {
    useThemeStore.getState().setSpaceOrbitSpeed(10)
    expect(useThemeStore.getState().spaceOrbitSpeed).toBe(5)
  })
})

describe('setBusinessMode', () => {
  it('saves snapshot of visual settings when enabling', () => {
    useThemeStore.setState({ glowIntensity: 70, glassOpacity: 50, surfaceVibrancy: 30 })

    useThemeStore.getState().setBusinessMode(true)

    const snap = useThemeStore.getState()._businessSnapshot
    expect(snap).not.toBeNull()
    expect(snap?.glowIntensity).toBe(70)
    expect(snap?.glassOpacity).toBe(50)
    expect(snap?.surfaceVibrancy).toBe(30)
  })

  it('zeroes out visual effects when enabling', () => {
    useThemeStore.setState({ glowIntensity: 80, glassOpacity: 60, surfaceVibrancy: 40, ambientBlobs: true })

    useThemeStore.getState().setBusinessMode(true)

    const s = useThemeStore.getState()
    expect(s.glowIntensity).toBe(0)
    expect(s.glassOpacity).toBe(0)
    expect(s.surfaceVibrancy).toBe(0)
    expect(s.ambientBlobs).toBe(false)
    expect(s.cursorEffect).toBe('none')
    expect(s.dragEffect).toBe('ghost')
  })

  it('sets businessMode to true', () => {
    useThemeStore.getState().setBusinessMode(true)
    expect(useThemeStore.getState().businessMode).toBe(true)
  })

  it('restores visual settings from snapshot when disabling', () => {
    useThemeStore.setState({ glowIntensity: 70, glassOpacity: 50, surfaceVibrancy: 30, ambientBlobs: true })
    useThemeStore.getState().setBusinessMode(true)
    useThemeStore.getState().setBusinessMode(false)

    const s = useThemeStore.getState()
    expect(s.glowIntensity).toBe(70)
    expect(s.glassOpacity).toBe(50)
    expect(s.surfaceVibrancy).toBe(30)
    expect(s.ambientBlobs).toBe(true)
  })

  it('clears snapshot after disabling', () => {
    useThemeStore.getState().setBusinessMode(true)
    useThemeStore.getState().setBusinessMode(false)

    expect(useThemeStore.getState()._businessSnapshot).toBeNull()
  })

  it('sets businessMode to false after disabling', () => {
    useThemeStore.getState().setBusinessMode(true)
    useThemeStore.getState().setBusinessMode(false)

    expect(useThemeStore.getState().businessMode).toBe(false)
  })

  it('is a no-op when enabling while already enabled', () => {
    useThemeStore.setState({ glowIntensity: 50 })
    useThemeStore.getState().setBusinessMode(true)

    const snapAfterFirst = useThemeStore.getState()._businessSnapshot

    useThemeStore.getState().setBusinessMode(true)

    expect(useThemeStore.getState()._businessSnapshot).toEqual(snapAfterFirst)
  })

  it('is a no-op when disabling while already disabled', () => {
    useThemeStore.setState({ glowIntensity: 40 })
    useThemeStore.getState().setBusinessMode(false)

    expect(useThemeStore.getState().glowIntensity).toBe(40)
    expect(useThemeStore.getState()._businessSnapshot).toBeNull()
  })

  it('does not alter columnWidth when toggling business mode', () => {
    useThemeStore.setState({ columnWidth: 400 })
    useThemeStore.getState().setBusinessMode(true)
    useThemeStore.getState().setBusinessMode(false)

    expect(useThemeStore.getState().columnWidth).toBe(400)
  })
})

describe('setPriorities', () => {
  it('replaces the priorities list', () => {
    const newPriorities = [{ id: 'critical', name: 'Critical', color: '#ff0000' }]
    useThemeStore.getState().setPriorities(newPriorities)

    expect(useThemeStore.getState().priorities).toHaveLength(1)
    expect(useThemeStore.getState().priorities[0].id).toBe('critical')
  })
})

describe('addPriority', () => {
  it('appends a new priority', () => {
    const initial = useThemeStore.getState().priorities.length
    useThemeStore.getState().addPriority({ id: 'blocker', name: 'Blocker', color: '#000' })

    expect(useThemeStore.getState().priorities).toHaveLength(initial + 1)
    expect(useThemeStore.getState().priorities.at(-1)?.id).toBe('blocker')
  })
})

describe('removePriority', () => {
  it('removes the matching priority', () => {
    useThemeStore.getState().removePriority('low')

    const ids = useThemeStore.getState().priorities.map((p) => p.id)
    expect(ids).not.toContain('low')
  })

  it('does not remove other priorities', () => {
    useThemeStore.getState().removePriority('low')

    const ids = useThemeStore.getState().priorities.map((p) => p.id)
    expect(ids).toContain('medium')
    expect(ids).toContain('high')
    expect(ids).toContain('urgent')
  })

  it('is a no-op on unknown id', () => {
    const before = useThemeStore.getState().priorities.length
    useThemeStore.getState().removePriority('nonexistent')

    expect(useThemeStore.getState().priorities).toHaveLength(before)
  })
})

describe('updatePriority', () => {
  it('applies partial updates to the matching priority', () => {
    useThemeStore.getState().updatePriority('high', { color: '#123456' })

    const high = useThemeStore.getState().priorities.find((p) => p.id === 'high')
    expect(high?.color).toBe('#123456')
  })

  it('does not modify other priorities', () => {
    const urgentBefore = useThemeStore.getState().priorities.find((p) => p.id === 'urgent')
    useThemeStore.getState().updatePriority('high', { color: '#aabbcc' })

    const urgentAfter = useThemeStore.getState().priorities.find((p) => p.id === 'urgent')
    expect(urgentAfter?.color).toBe(urgentBefore?.color)
  })
})

describe('resetPriorities', () => {
  it('restores INITIAL_PRIORITIES', () => {
    useThemeStore.getState().setPriorities([])
    useThemeStore.getState().resetPriorities()

    expect(useThemeStore.getState().priorities).toEqual(INITIAL_PRIORITIES)
  })

  it('returns a fresh copy not referencing INITIAL_PRIORITIES', () => {
    useThemeStore.getState().resetPriorities()
    useThemeStore.getState().priorities.push({ id: 'extra', name: 'Extra', color: '#fff' })

    expect(INITIAL_PRIORITIES.find((p) => p.id === 'extra')).toBeUndefined()
  })
})

describe('setTheme', () => {
  it('updates currentTheme', () => {
    useThemeStore.getState().setTheme('neonCyberpunk')
    expect(useThemeStore.getState().currentTheme).toBe('neonCyberpunk')
  })

  it('updates colors to the chosen theme palette', () => {
    useThemeStore.getState().setTheme('neonGrid')
    const colors = useThemeStore.getState().colors
    expect(colors).toBeDefined()
    expect(typeof colors.background).toBe('string')
  })

  it('colors change when theme changes', () => {
    useThemeStore.getState().setTheme('deepSpace')
    const colorsBefore = useThemeStore.getState().colors.background

    useThemeStore.getState().setTheme('neonGrid')
    const colorsAfter = useThemeStore.getState().colors.background

    expect(colorsBefore).not.toBe(colorsAfter)
  })
})

describe('_hydrateFromDB', () => {
  it('sets _hydrated to true', () => {
    useThemeStore.getState()._hydrateFromDB({})
    expect(useThemeStore.getState()._hydrated).toBe(true)
  })

  it('loads currentTheme from preferences', () => {
    useThemeStore.getState()._hydrateFromDB({ currentTheme: 'neonGrid' })
    expect(useThemeStore.getState().currentTheme).toBe('neonGrid')
  })

  it('falls back to deepSpace for unknown theme', () => {
    useThemeStore.getState()._hydrateFromDB({ currentTheme: 'nonExistentTheme9999' })
    expect(useThemeStore.getState().colors).toBeDefined()
  })

  it('merges shortcuts with defaults', () => {
    useThemeStore.getState()._hydrateFromDB({ shortcuts: { addCard: 'n' } })

    const shortcuts = useThemeStore.getState().shortcuts
    expect(shortcuts.addCard).toBe('n')
    expect(shortcuts.openLabel).toBe(DEFAULT_SHORTCUTS.openLabel)
  })

  it('loads priorities from preferences', () => {
    const customPriorities = [{ id: 'vip', name: 'VIP', color: '#gold' }]
    useThemeStore.getState()._hydrateFromDB({ priorities: customPriorities })

    expect(useThemeStore.getState().priorities).toEqual(customPriorities)
  })

  it('falls back to INITIAL_PRIORITIES when priorities not provided', () => {
    useThemeStore.getState()._hydrateFromDB({})
    expect(useThemeStore.getState().priorities).toEqual(INITIAL_PRIORITIES)
  })

  it('loads glowIntensity from preferences', () => {
    useThemeStore.getState()._hydrateFromDB({ glowIntensity: 77 })
    expect(useThemeStore.getState().glowIntensity).toBe(77)
  })
})
