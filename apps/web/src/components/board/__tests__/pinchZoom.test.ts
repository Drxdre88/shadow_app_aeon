import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  MIN_BOARD_SCALE,
  MAX_BOARD_SCALE,
  clampScale,
  touchDistance,
  touchMidpoint,
  nextScale,
  scrollForFocalPoint,
  layoutCompensation,
  canStartPinch,
  PINCH_PAIR_WINDOW_MS,
} from '../pinchZoom'

describe('clampScale', () => {
  it('passes through values inside the range', () => {
    expect(clampScale(0.5)).toBe(0.5)
    expect(clampScale(1)).toBe(1)
    expect(clampScale(MIN_BOARD_SCALE)).toBe(MIN_BOARD_SCALE)
  })

  it('clamps below the bird\'s-eye floor and above normal scale', () => {
    expect(clampScale(0.1)).toBe(MIN_BOARD_SCALE)
    expect(clampScale(0)).toBe(MIN_BOARD_SCALE)
    expect(clampScale(2)).toBe(MAX_BOARD_SCALE)
  })

  it('falls back to normal scale on non-finite input', () => {
    expect(clampScale(NaN)).toBe(MAX_BOARD_SCALE)
    expect(clampScale(Infinity)).toBe(MAX_BOARD_SCALE)
    expect(clampScale(-Infinity)).toBe(MAX_BOARD_SCALE)
  })
})

describe('touchDistance / touchMidpoint', () => {
  it('computes euclidean distance (3-4-5 triangle)', () => {
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5)
  })

  it('is zero for coincident touches', () => {
    expect(touchDistance({ clientX: 7, clientY: 9 }, { clientX: 7, clientY: 9 })).toBe(0)
  })

  it('midpoint is halfway between the touches', () => {
    expect(touchMidpoint({ clientX: 0, clientY: 10 }, { clientX: 20, clientY: 30 })).toEqual({ x: 10, y: 20 })
  })
})

describe('nextScale', () => {
  it('scales proportionally to finger spread', () => {
    // Fingers closing to half the start distance halves the scale.
    expect(nextScale(1, 200, 100)).toBe(0.5)
    // Fingers spreading back out from a zoomed-out state zooms back in.
    expect(nextScale(0.5, 100, 200)).toBe(1)
  })

  it('clamps to the allowed range', () => {
    expect(nextScale(1, 400, 10)).toBe(MIN_BOARD_SCALE)
    expect(nextScale(1, 100, 500)).toBe(MAX_BOARD_SCALE)
  })

  it('survives a degenerate zero start distance', () => {
    expect(nextScale(0.7, 0, 150)).toBe(0.7)
    expect(nextScale(1, -5, 150)).toBe(1)
  })

  test.prop([
    fc.double({ min: MIN_BOARD_SCALE, max: MAX_BOARD_SCALE, noNaN: true }),
    fc.double({ min: 1, max: 2000, noNaN: true }),
    fc.double({ min: 0, max: 4000, noNaN: true }),
  ])('always returns a value inside the clamp range', (startScale, startDist, currDist) => {
    const s = nextScale(startScale, startDist, currDist)
    expect(s).toBeGreaterThanOrEqual(MIN_BOARD_SCALE)
    expect(s).toBeLessThanOrEqual(MAX_BOARD_SCALE)
  })
})

describe('scrollForFocalPoint', () => {
  it('keeps the content point under the pinch midpoint stationary', () => {
    // scroll 300, focal 100px into the container at scale 1 -> content x = 400.
    // After scaling to 0.5 the same content x paints at 200, so the scroll
    // that keeps it under the focal offset is 200 - 100 = 100.
    expect(scrollForFocalPoint(300, 100, 1, 0.5)).toBe(100)
  })

  it('is identity when the scale does not change', () => {
    expect(scrollForFocalPoint(240, 80, 0.7, 0.7)).toBeCloseTo(240, 10)
  })

  it('never returns a negative scroll position', () => {
    expect(scrollForFocalPoint(0, 200, 1, 0.35)).toBe(0)
  })

  it('is safe against a non-positive previous scale', () => {
    expect(scrollForFocalPoint(120, 50, 0, 0.5)).toBe(120)
  })

  test.prop([
    fc.double({ min: 0, max: 5000, noNaN: true }),
    fc.double({ min: 0, max: 1200, noNaN: true }),
    fc.double({ min: MIN_BOARD_SCALE, max: MAX_BOARD_SCALE, noNaN: true }),
    fc.double({ min: MIN_BOARD_SCALE, max: MAX_BOARD_SCALE, noNaN: true }),
  ])('focal invariance: the unscaled content coordinate under the focal point is preserved', (scroll, focal, s0, s1) => {
    const newScroll = scrollForFocalPoint(scroll, focal, s0, s1)
    // Skip cases the browser would clamp at 0 (content edge reached).
    fc.pre(newScroll > 0)
    const before = (scroll + focal) / s0
    const after = (newScroll + focal) / s1
    expect(after).toBeCloseTo(before, 6)
  })
})

describe('layoutCompensation', () => {
  it('is a no-op at normal scale', () => {
    expect(layoutCompensation(1, 3000, 800)).toEqual({ marginRight: 0, marginBottom: 0 })
  })

  it('shrinks the layout footprint by the hidden fraction', () => {
    expect(layoutCompensation(0.5, 3000, 800)).toEqual({ marginRight: -1500, marginBottom: -400 })
  })

  test.prop([
    fc.double({ min: 0, max: 3, noNaN: true }),
    fc.double({ min: 0, max: 10000, noNaN: true }),
    fc.double({ min: 0, max: 10000, noNaN: true }),
  ])('margins are never positive and never exceed the base size', (scale, w, h) => {
    const { marginRight, marginBottom } = layoutCompensation(scale, w, h)
    expect(marginRight).toBeLessThanOrEqual(0)
    expect(marginBottom).toBeLessThanOrEqual(0)
    expect(marginRight).toBeGreaterThanOrEqual(-w)
    expect(marginBottom).toBeGreaterThanOrEqual(-h)
  })

  it('layout size + compensation equals the visual (scaled) size', () => {
    const base = 2400
    const s = 0.35
    const { marginRight } = layoutCompensation(s, base, 0)
    expect(base + marginRight).toBeCloseTo(base * s, 8)
  })
})

describe('canStartPinch', () => {
  const NOW = 10_000
  const bare = (age: number) => ({ onCard: false, startedAt: NOW - age })
  const onCard = (age: number) => ({ onCard: true, startedAt: NOW - age })

  it('lets two near-simultaneous fingers pinch, even with one on a card', () => {
    expect(canStartPinch(false, [onCard(0), bare(0)], NOW)).toBe(true)
    expect(canStartPinch(false, [onCard(50), onCard(0)], NOW)).toBe(true)
    expect(canStartPinch(false, [onCard(PINCH_PAIR_WINDOW_MS), bare(0)], NOW)).toBe(true)
  })

  it('refuses once a finger has been holding a card past the pairing window', () => {
    expect(canStartPinch(false, [onCard(PINCH_PAIR_WINDOW_MS + 1), bare(0)], NOW)).toBe(false)
    expect(canStartPinch(false, [onCard(300), bare(0)], NOW)).toBe(false)
  })

  it('ignores the age of fingers that are not on a card — an idle finger on bare board is fine', () => {
    expect(canStartPinch(false, [bare(5000), bare(0)], NOW)).toBe(true)
  })

  it('refuses outright while a card is lifted, however the fingers landed', () => {
    expect(canStartPinch(true, [], NOW)).toBe(false)
    expect(canStartPinch(true, [bare(0), bare(0)], NOW)).toBe(false)
  })

  it('allows a pinch when nothing is being tracked', () => {
    expect(canStartPinch(false, [], NOW)).toBe(true)
  })
})
