import { describe, it, expect } from 'vitest'
import { INITIAL_PRIORITIES, DEFAULT_SHORTCUTS, DEFAULT_PREFERENCES } from './defaults'

describe('INITIAL_PRIORITIES', () => {
  it('has exactly 4 entries', () => {
    expect(INITIAL_PRIORITIES).toHaveLength(4)
  })

  it('contains low priority with correct id', () => {
    expect(INITIAL_PRIORITIES.find((p) => p.id === 'low')).toBeDefined()
  })

  it('contains medium priority with correct id', () => {
    expect(INITIAL_PRIORITIES.find((p) => p.id === 'medium')).toBeDefined()
  })

  it('contains high priority with correct id', () => {
    expect(INITIAL_PRIORITIES.find((p) => p.id === 'high')).toBeDefined()
  })

  it('contains urgent priority with correct id', () => {
    expect(INITIAL_PRIORITIES.find((p) => p.id === 'urgent')).toBeDefined()
  })

  it('every priority has a non-empty name', () => {
    INITIAL_PRIORITIES.forEach((p) => {
      expect(p.name.length).toBeGreaterThan(0)
    })
  })

  it('every priority has a color string', () => {
    INITIAL_PRIORITIES.forEach((p) => {
      expect(typeof p.color).toBe('string')
      expect(p.color.length).toBeGreaterThan(0)
    })
  })

  it('ids are ordered low medium high urgent', () => {
    const ids = INITIAL_PRIORITIES.map((p) => p.id)
    expect(ids).toEqual(['low', 'medium', 'high', 'urgent'])
  })
})

describe('DEFAULT_SHORTCUTS', () => {
  it('has openLabel shortcut', () => {
    expect(DEFAULT_SHORTCUTS.openLabel).toBeDefined()
  })

  it('has addCard shortcut', () => {
    expect(DEFAULT_SHORTCUTS.addCard).toBeDefined()
  })

  it('has editCard shortcut', () => {
    expect(DEFAULT_SHORTCUTS.editCard).toBeDefined()
  })

  it('has changeGlow shortcut', () => {
    expect(DEFAULT_SHORTCUTS.changeGlow).toBeDefined()
  })

  it('has changePriority shortcut', () => {
    expect(DEFAULT_SHORTCUTS.changePriority).toBeDefined()
  })

  it('has toggleDates shortcut', () => {
    expect(DEFAULT_SHORTCUTS.toggleDates).toBeDefined()
  })

  it('has toggleChecklist shortcut', () => {
    expect(DEFAULT_SHORTCUTS.toggleChecklist).toBeDefined()
  })

  it('all shortcut values are single characters', () => {
    Object.values(DEFAULT_SHORTCUTS).forEach((key) => {
      expect(key).toHaveLength(1)
    })
  })

  it('all shortcut values are lowercase letters', () => {
    Object.values(DEFAULT_SHORTCUTS).forEach((key) => {
      expect(key).toMatch(/^[a-z]$/)
    })
  })
})

describe('DEFAULT_PREFERENCES', () => {
  it('glowIntensity is between 0 and 100', () => {
    expect(DEFAULT_PREFERENCES.glowIntensity).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_PREFERENCES.glowIntensity).toBeLessThanOrEqual(100)
  })

  it('glassOpacity is between 0 and 100', () => {
    expect(DEFAULT_PREFERENCES.glassOpacity).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_PREFERENCES.glassOpacity).toBeLessThanOrEqual(100)
  })

  it('themeSaturation is between 0 and 200', () => {
    expect(DEFAULT_PREFERENCES.themeSaturation).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_PREFERENCES.themeSaturation).toBeLessThanOrEqual(200)
  })

  it('themeBrightness is between 0 and 200', () => {
    expect(DEFAULT_PREFERENCES.themeBrightness).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_PREFERENCES.themeBrightness).toBeLessThanOrEqual(200)
  })

  it('currentTheme is a non-empty string', () => {
    expect(typeof DEFAULT_PREFERENCES.currentTheme).toBe('string')
    expect(DEFAULT_PREFERENCES.currentTheme.length).toBeGreaterThan(0)
  })

  it('columnWidth is a positive number', () => {
    expect(DEFAULT_PREFERENCES.columnWidth).toBeGreaterThan(0)
  })

  it('columnHeight is a positive number', () => {
    expect(DEFAULT_PREFERENCES.columnHeight).toBeGreaterThan(0)
  })

  it('ambientBlobs defaults to false', () => {
    expect(DEFAULT_PREFERENCES.ambientBlobs).toBe(false)
  })

  it('dynamicColumnWidth defaults to false', () => {
    expect(DEFAULT_PREFERENCES.dynamicColumnWidth).toBe(false)
  })

  it('dynamicColumnHeight defaults to false', () => {
    expect(DEFAULT_PREFERENCES.dynamicColumnHeight).toBe(false)
  })

  it('spacePlanetGlow defaults to true', () => {
    expect(DEFAULT_PREFERENCES.spacePlanetGlow).toBe(true)
  })

  it('boardLayout has a valid value', () => {
    expect(['scroll', 'grid']).toContain(DEFAULT_PREFERENCES.boardLayout)
  })

  it('completionMode has a valid value', () => {
    expect(['done', 'vault']).toContain(DEFAULT_PREFERENCES.completionMode)
  })

  it('depViewMode has a valid value', () => {
    expect(['canvas', 'arrows']).toContain(DEFAULT_PREFERENCES.depViewMode)
  })

  it('shortcuts matches DEFAULT_SHORTCUTS keys', () => {
    expect(Object.keys(DEFAULT_PREFERENCES.shortcuts)).toEqual(Object.keys(DEFAULT_SHORTCUTS))
  })

  it('priorities array has 4 entries matching INITIAL_PRIORITIES', () => {
    expect(DEFAULT_PREFERENCES.priorities).toHaveLength(4)
    const ids = DEFAULT_PREFERENCES.priorities.map((p) => p.id)
    expect(ids).toEqual(['low', 'medium', 'high', 'urgent'])
  })

  it('priorities is a copy not the same reference as INITIAL_PRIORITIES', () => {
    expect(DEFAULT_PREFERENCES.priorities).not.toBe(INITIAL_PRIORITIES)
  })

  it('projectColors defaults to empty object', () => {
    expect(DEFAULT_PREFERENCES.projectColors).toEqual({})
  })
})
