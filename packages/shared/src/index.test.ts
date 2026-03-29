import { describe, it, expect } from 'vitest'
import {
  themes,
  themeNames,
  DEFAULT_PREFERENCES,
  DEFAULT_SHORTCUTS,
  INITIAL_PRIORITIES,
  DEFAULT_FILTERS,
  CELEBRATION_CATEGORIES,
  createDefaultFilters,
  hasActiveFilters,
  activeFilterCount,
  applyBoardFilters,
} from './index'

describe('barrel exports resolve at runtime', () => {
  it('themes is a non-empty object', () => {
    expect(themes).toBeDefined()
    expect(typeof themes).toBe('object')
    expect(Object.keys(themes).length).toBeGreaterThan(0)
  })

  it('themeNames is a non-empty array', () => {
    expect(Array.isArray(themeNames)).toBe(true)
    expect(themeNames.length).toBeGreaterThan(0)
  })

  it('DEFAULT_PREFERENCES is defined with expected shape', () => {
    expect(DEFAULT_PREFERENCES).toBeDefined()
    expect(typeof DEFAULT_PREFERENCES).toBe('object')
    expect(DEFAULT_PREFERENCES).toHaveProperty('currentTheme')
    expect(DEFAULT_PREFERENCES).toHaveProperty('priorities')
    expect(DEFAULT_PREFERENCES).toHaveProperty('shortcuts')
  })

  it('DEFAULT_SHORTCUTS is defined with expected keys', () => {
    expect(DEFAULT_SHORTCUTS).toBeDefined()
    expect(typeof DEFAULT_SHORTCUTS).toBe('object')
    expect(DEFAULT_SHORTCUTS).toHaveProperty('addCard')
    expect(DEFAULT_SHORTCUTS).toHaveProperty('editCard')
  })

  it('INITIAL_PRIORITIES is a non-empty array with id/name/color entries', () => {
    expect(Array.isArray(INITIAL_PRIORITIES)).toBe(true)
    expect(INITIAL_PRIORITIES.length).toBeGreaterThan(0)
    expect(INITIAL_PRIORITIES[0]).toHaveProperty('id')
    expect(INITIAL_PRIORITIES[0]).toHaveProperty('name')
    expect(INITIAL_PRIORITIES[0]).toHaveProperty('color')
  })

  it('DEFAULT_FILTERS is defined with BoardFilters shape', () => {
    expect(DEFAULT_FILTERS).toBeDefined()
    expect(DEFAULT_FILTERS).toHaveProperty('search')
    expect(DEFAULT_FILTERS).toHaveProperty('priorities')
    expect(DEFAULT_FILTERS).toHaveProperty('labels')
    expect(DEFAULT_FILTERS).toHaveProperty('dateFilter')
  })

  it('CELEBRATION_CATEGORIES is a non-empty array with id/label/icon entries', () => {
    expect(Array.isArray(CELEBRATION_CATEGORIES)).toBe(true)
    expect(CELEBRATION_CATEGORIES.length).toBeGreaterThan(0)
    expect(CELEBRATION_CATEGORIES[0]).toHaveProperty('id')
    expect(CELEBRATION_CATEGORIES[0]).toHaveProperty('label')
    expect(CELEBRATION_CATEGORIES[0]).toHaveProperty('icon')
  })

  it('createDefaultFilters is callable and returns a BoardFilters object', () => {
    expect(typeof createDefaultFilters).toBe('function')
    const result = createDefaultFilters()
    expect(result).toHaveProperty('search', '')
    expect(result.priorities).toBeInstanceOf(Set)
    expect(result.labels).toBeInstanceOf(Set)
    expect(result).toHaveProperty('dateFilter', 'all')
  })

  it('hasActiveFilters is callable and returns boolean', () => {
    expect(typeof hasActiveFilters).toBe('function')
    expect(hasActiveFilters(createDefaultFilters())).toBe(false)
  })

  it('activeFilterCount is callable and returns number', () => {
    expect(typeof activeFilterCount).toBe('function')
    expect(typeof activeFilterCount(createDefaultFilters())).toBe('number')
  })

  it('applyBoardFilters is callable and returns an array', () => {
    expect(typeof applyBoardFilters).toBe('function')
    const result = applyBoardFilters([], createDefaultFilters())
    expect(Array.isArray(result)).toBe(true)
  })
})
