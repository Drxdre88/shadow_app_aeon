import { describe, it, expect } from 'vitest'
import { labelHex, readableTextColor } from './labelTile'

describe('labelHex', () => {
  it('resolves preset colour names', () => {
    expect(labelHex('purple')).toBe('#a855f7')
  })

  it('passes hex values through and repairs a missing hash', () => {
    expect(labelHex('#123456')).toBe('#123456')
    expect(labelHex('123456')).toBe('#123456')
  })
})

describe('readableTextColor', () => {
  it('uses dark text on bright fills', () => {
    expect(readableTextColor('#ffffff')).toBe('#0b0b0f')
    expect(readableTextColor('#fde047')).toBe('#0b0b0f')
  })

  it('uses light text on dark fills', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#a855f7')).toBe('#ffffff')
  })

  it('falls back to light text for unparseable values', () => {
    expect(readableTextColor('#abc')).toBe('#ffffff')
  })
})
