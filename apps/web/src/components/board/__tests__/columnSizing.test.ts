import { describe, expect, it } from 'vitest'
import {
  clampManualColumnHeight,
  columnHeightScale,
  heightPrefToPercent,
  percentToHeightPref,
} from '../columnSizing'

describe('columnHeightScale', () => {
  it('reads the stored preference as thousandths of the viewport', () => {
    expect(columnHeightScale(500)).toBe(0.5)
    expect(columnHeightScale(800)).toBe(0.8)
  })

  it('clamps everything at/above 1000 to full height — the legacy default 1100 included', () => {
    expect(columnHeightScale(1000)).toBe(1)
    expect(columnHeightScale(1100)).toBe(1)
    expect(columnHeightScale(1600)).toBe(1)
  })

  it('floors tiny values so columns stay usable', () => {
    expect(columnHeightScale(0)).toBe(0.2)
    expect(columnHeightScale(-50)).toBe(0.2)
  })

  it('falls back to full height on non-finite garbage instead of emitting NaN into CSS', () => {
    expect(columnHeightScale(NaN)).toBe(1)
    expect(columnHeightScale(Infinity)).toBe(1)
    expect(columnHeightScale(undefined)).toBe(1)
    expect(columnHeightScale(null)).toBe(1)
    expect(columnHeightScale('1100')).toBe(1)
  })
})

describe('clampManualColumnHeight', () => {
  it('clamps drag-resize pixels to the 200-1600 band', () => {
    expect(clampManualColumnHeight(100)).toBe(200)
    expect(clampManualColumnHeight(800)).toBe(800)
    expect(clampManualColumnHeight(5000)).toBe(1600)
  })
})

describe('settings slider mapping', () => {
  it('presents stored values as a screen percentage, dead-band-free', () => {
    expect(heightPrefToPercent(200)).toBe(20)
    expect(heightPrefToPercent(550)).toBe(55)
    expect(heightPrefToPercent(1000)).toBe(100)
    // legacy values above 1000 read as full height, so the slider shows 100
    expect(heightPrefToPercent(1100)).toBe(100)
    expect(heightPrefToPercent(1600)).toBe(100)
  })

  it('writes percentages back into the legacy 200-1000 storage range', () => {
    expect(percentToHeightPref(20)).toBe(200)
    expect(percentToHeightPref(55)).toBe(550)
    expect(percentToHeightPref(100)).toBe(1000)
    expect(percentToHeightPref(5)).toBe(200)
    expect(percentToHeightPref(150)).toBe(1000)
  })

  it('round-trips within slider resolution', () => {
    for (const pct of [20, 33, 50, 75, 100]) {
      expect(heightPrefToPercent(percentToHeightPref(pct))).toBe(pct)
    }
  })
})
