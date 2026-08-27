import { describe, it, expect } from 'vitest'
import { resolveAccentHex, hexToRgba, colorConfig } from '../colors'

describe('resolveAccentHex', () => {
  it('maps a preset accent name to its hex', () => {
    expect(resolveAccentHex('purple')).toBe(colorConfig.purple.hex)
    expect(resolveAccentHex('green')).toBe(colorConfig.green.hex)
    expect(resolveAccentHex('none')).toBe(colorConfig.none.hex)
  })

  it('passes an already-literal hex straight through', () => {
    expect(resolveAccentHex('#123abc')).toBe('#123abc')
  })

  it('falls back to purple for unknown / missing values', () => {
    expect(resolveAccentHex('chartreuse')).toBe(colorConfig.purple.hex)
    expect(resolveAccentHex('')).toBe(colorConfig.purple.hex)
    expect(resolveAccentHex(null)).toBe(colorConfig.purple.hex)
    expect(resolveAccentHex(undefined)).toBe(colorConfig.purple.hex)
  })

  it('honours a caller-supplied fallback', () => {
    expect(resolveAccentHex(null, '#f59e0b')).toBe('#f59e0b')
    expect(resolveAccentHex('chartreuse', '#f59e0b')).toBe('#f59e0b')
    // ...but a real accent still wins over the fallback.
    expect(resolveAccentHex('red', '#f59e0b')).toBe(colorConfig.red.hex)
  })
})

describe('hexToRgba', () => {
  it('expands a 6-digit hex with or without the hash', () => {
    expect(hexToRgba('#f59e0b', 0.5)).toBe('rgba(245, 158, 11, 0.5)')
    expect(hexToRgba('f59e0b', 1)).toBe('rgba(245, 158, 11, 1)')
  })

  // The guard the trophy vault's old hand-rolled copy was missing: a malformed
  // color used to emit rgba(NaN,...), which the browser drops outright.
  it('degrades a malformed hex to slate instead of NaN', () => {
    expect(hexToRgba('#abc', 0.3)).toBe('rgba(148, 163, 184, 0.3)')
    expect(hexToRgba('#zzzzzz', 0.3)).toBe('rgba(148, 163, 184, 0.3)')
  })
})
