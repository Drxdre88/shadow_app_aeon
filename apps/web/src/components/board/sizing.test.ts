import { describe, it, expect } from 'vitest'
import {
  parseSizing,
  sizingLabelFor,
  sizingTooltip,
  clampSizingValue,
  DEFAULT_SIZING,
  MAX_SIZING_LABELS,
} from './sizing'

describe('parseSizing', () => {
  it('falls back to the default ladder when settings are empty', () => {
    expect(parseSizing({})).toEqual(DEFAULT_SIZING)
    expect(parseSizing(null)).toEqual(DEFAULT_SIZING)
    expect(parseSizing({ sizing: 'nonsense' })).toEqual(DEFAULT_SIZING)
  })

  it('ships enabled so every board gets S/M/L/XL out of the box', () => {
    expect(DEFAULT_SIZING.enabled).toBe(true)
    expect(DEFAULT_SIZING.labels.map((l) => l.key)).toEqual(['S', 'M', 'L', 'XL'])
    expect(parseSizing({ sizing: { labels: [{ key: 'S', value: 1 }] } }).enabled).toBe(true)
  })

  it('stays off when a board explicitly disabled it', () => {
    expect(parseSizing({ sizing: { enabled: false } }).enabled).toBe(false)
  })

  it('reads a stored config', () => {
    const parsed = parseSizing({
      sizing: { enabled: true, unit: 'points', labels: [{ key: 'S', value: 1 }, { key: 'L', value: 8 }] },
    })
    expect(parsed).toEqual({
      enabled: true,
      unit: 'points',
      labels: [{ key: 'S', value: 1 }, { key: 'L', value: 8 }],
    })
  })

  it('drops malformed rows and clamps values into the persistable range', () => {
    const parsed = parseSizing({
      sizing: { enabled: true, labels: [{ key: '', value: 2 }, { key: 'XS', value: 0.1 }, { key: 'XXL', value: 99 }, null] },
    })
    expect(parsed.labels).toEqual([{ key: 'XS', value: 0.5 }, { key: 'XXL', value: 20 }])
    expect(parsed.unit).toBe('days')
  })

  it('caps the ladder length', () => {
    const labels = Array.from({ length: 10 }, (_, i) => ({ key: `K${i}`, value: 1 }))
    expect(parseSizing({ sizing: { enabled: true, labels } }).labels).toHaveLength(MAX_SIZING_LABELS)
  })
})

describe('clampSizingValue', () => {
  it('snaps to half steps inside 0.5-20', () => {
    expect(clampSizingValue(2.3)).toBe(2.5)
    expect(clampSizingValue(0)).toBe(0.5)
    expect(clampSizingValue(1000)).toBe(20)
  })
})

describe('sizingLabelFor', () => {
  const sizing = parseSizing({ sizing: { enabled: true, labels: [{ key: 'S', value: 1 }, { key: 'M', value: 2 }] } })

  it('maps an exact value to its label', () => {
    expect(sizingLabelFor(sizing, 2)).toBe('M')
  })

  it('returns null for untracked or unmapped sizes', () => {
    expect(sizingLabelFor(sizing, null)).toBeNull()
    expect(sizingLabelFor(sizing, 3)).toBeNull()
  })
})

describe('sizingTooltip', () => {
  it('spells out the mapped value with its unit', () => {
    const days = parseSizing({ sizing: { enabled: true, unit: 'days', labels: [{ key: 'M', value: 2 }] } })
    expect(sizingTooltip(days, days.labels[0])).toBe('M = 2 days')

    const points = parseSizing({ sizing: { enabled: true, unit: 'points', labels: [{ key: 'S', value: 1 }] } })
    expect(sizingTooltip(points, points.labels[0])).toBe('S = 1 point')
  })
})
