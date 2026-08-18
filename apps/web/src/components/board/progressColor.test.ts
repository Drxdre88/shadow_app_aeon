import { describe, it, expect } from 'vitest'
import { progressHue, progressBarStyle } from './progressColor'

describe('progressHue', () => {
  it('runs yellow at 0% to green at 100%', () => {
    expect(progressHue(0)).toBe(48)
    expect(progressHue(100)).toBe(140)
    expect(progressHue(50)).toBe(94)
  })

  it('clamps out-of-range values', () => {
    expect(progressHue(-20)).toBe(48)
    expect(progressHue(180)).toBe(140)
  })
})

describe('progressBarStyle', () => {
  it('builds a two-layer cloudy fill from the interpolated hue', () => {
    const style = progressBarStyle(50)
    expect(style.fill).toContain('hsla(94, 88%, 56%')
    expect(style.cloud.split('radial-gradient').length - 1).toBe(2)
  })

  it('adds the extra glow ring only at 100%', () => {
    expect(progressBarStyle(99).glow.split(',').length).toBeLessThan(
      progressBarStyle(100).glow.split(',').length
    )
  })

  it('is independent of any card accent colour', () => {
    expect(progressBarStyle(30).fill).toBe(progressBarStyle(30).fill)
    expect(progressBarStyle(30).fill).not.toContain('var(')
  })
})
