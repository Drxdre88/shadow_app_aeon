import { describe, it, expect } from 'vitest'
import { themes, themeNames } from './index'
import type { ThemeColors } from './types'

const REQUIRED_KEYS: (keyof ThemeColors)[] = [
  'background',
  'surface',
  'surfaceHover',
  'border',
  'borderHover',
  'text',
  'textMuted',
  'textDim',
  'primary',
  'primaryHover',
  'primaryMuted',
  'accent',
  'success',
  'warning',
  'error',
  'glow',
  'glowColor',
  'chartColors',
  'isDark',
]

const HEX_COLOR_KEYS: (keyof ThemeColors)[] = [
  'background',
  'text',
  'primary',
  'accent',
]

const colorRegex = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(.+\))$/

describe('themes registry', () => {
  it('has at least one theme', () => {
    expect(Object.keys(themes).length).toBeGreaterThan(0)
  })

  it('contains deepSpace theme', () => {
    expect(themes['deepSpace']).toBeDefined()
  })
})

describe('themeNames', () => {
  it('matches Object.keys(themes)', () => {
    expect(themeNames).toEqual(Object.keys(themes))
  })

  it('contains no duplicates', () => {
    expect(new Set(themeNames).size).toBe(themeNames.length)
  })

  it('has at least one entry', () => {
    expect(themeNames.length).toBeGreaterThan(0)
  })
})

describe('every theme has all required ThemeColors keys', () => {
  themeNames.forEach((name) => {
    it(`${name} has all required keys`, () => {
      const theme = themes[name]
      REQUIRED_KEYS.forEach((key) => {
        expect(theme).toHaveProperty(key)
      })
    })
  })
})

describe('every theme chartColors is a non-empty array', () => {
  themeNames.forEach((name) => {
    it(`${name}.chartColors is a non-empty string array`, () => {
      const { chartColors } = themes[name]
      expect(Array.isArray(chartColors)).toBe(true)
      expect(chartColors.length).toBeGreaterThan(0)
      chartColors.forEach((c) => expect(typeof c).toBe('string'))
    })
  })
})

describe('every theme isDark is a boolean', () => {
  themeNames.forEach((name) => {
    it(`${name}.isDark is boolean`, () => {
      expect(typeof themes[name].isDark).toBe('boolean')
    })
  })
})

describe('key color fields are valid hex values', () => {
  themeNames.forEach((name) => {
    HEX_COLOR_KEYS.forEach((key) => {
      it(`${name}.${key} is a valid hex color`, () => {
        const value = themes[name][key] as string
        expect(value).toMatch(colorRegex)
      })
    })
  })
})

describe('optional theme fields', () => {
  it('effect field is either undefined or one of the known effect values', () => {
    const validEffects = new Set([
      'matrix',
      'matrix-unleashed',
      'vulcan',
      'dracula',
      'snowfall',
      'storm',
      'inferno',
      'aurora-borealis',
      'sakura',
      'starfield',
      'firefly',
      'deep-sea',
      'mercury',
    ])
    themeNames.forEach((name) => {
      const { effect } = themes[name]
      if (effect !== undefined) {
        expect(validEffects.has(effect)).toBe(true)
      }
    })
  })

  it('category field is either undefined or a string', () => {
    themeNames.forEach((name) => {
      const { category } = themes[name]
      if (category !== undefined) {
        expect(typeof category).toBe('string')
      }
    })
  })
})
