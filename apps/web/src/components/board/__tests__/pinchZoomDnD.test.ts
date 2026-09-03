import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  MIN_BOARD_SCALE,
  MAX_BOARD_SCALE,
  parseOwnTranslate,
  rectWithoutOwnTranslate,
  scaleDisplacement,
} from '../pinchZoom'

// dnd-kit under a scaled ancestor: it inverts a node's own translate in
// unscaled px and hands back displacements in scaled px. These pin the two
// pure corrections boardZoom.ts wires in.

describe('parseOwnTranslate', () => {
  it('reads the translate out of matrix() and matrix3d() as browsers serialize them', () => {
    expect(parseOwnTranslate('matrix(1, 0, 0, 1, 12, -34)')).toEqual({ x: 12, y: -34 })
    expect(parseOwnTranslate('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 0, 1)')).toEqual({ x: 5, y: 7 })
  })

  it('is null for none / empty / garbage', () => {
    expect(parseOwnTranslate('none')).toBeNull()
    expect(parseOwnTranslate('')).toBeNull()
    expect(parseOwnTranslate(undefined)).toBeNull()
    expect(parseOwnTranslate('matrix(1, 0)')).toBeNull()
  })
})

describe('rectWithoutOwnTranslate', () => {
  const rect = { top: 200, left: 100, width: 80, height: 40 }

  it('subtracts the translate in VIEWPORT px (layout px times the ancestor scale)', () => {
    // A sortable displaced by 100 layout px inside a 0.5-scaled wrapper has
    // moved 50 viewport px, so that is what comes back out.
    const r = rectWithoutOwnTranslate(rect, { x: 0, y: 100 }, 0.5)
    expect(r).toEqual({ top: 150, left: 100, width: 80, height: 40, right: 180, bottom: 190 })
  })

  it('reduces to dnd-kit own maths at scale 1', () => {
    const r = rectWithoutOwnTranslate(rect, { x: 10, y: 20 }, 1)
    expect(r.left).toBe(90)
    expect(r.top).toBe(180)
  })

  it('leaves an untranslated node alone and survives a bad scale', () => {
    expect(rectWithoutOwnTranslate(rect, null, 0.4)).toMatchObject(rect)
    expect(rectWithoutOwnTranslate(rect, { x: 10, y: 10 }, 0)).toMatchObject({ left: 90, top: 190 })
    expect(rectWithoutOwnTranslate(rect, { x: 10, y: 10 }, NaN)).toMatchObject({ left: 90, top: 190 })
  })

  test.prop([
    fc.double({ min: -2000, max: 2000, noNaN: true }),
    fc.double({ min: -2000, max: 2000, noNaN: true }),
    fc.double({ min: MIN_BOARD_SCALE, max: MAX_BOARD_SCALE, noNaN: true }),
  ])('a translation never changes the box size', (x, y, s) => {
    const r = rectWithoutOwnTranslate(rect, { x, y }, s)
    expect(r.width).toBe(rect.width)
    expect(r.height).toBe(rect.height)
    expect(r.right - r.left).toBeCloseTo(rect.width, 6)
    expect(r.bottom - r.top).toBeCloseTo(rect.height, 6)
  })
})

describe('scaleDisplacement', () => {
  it('grows a viewport displacement into the layout px that reproduces it on screen', () => {
    const t = scaleDisplacement({ x: 0, y: 60, scaleX: 1, scaleY: 1 }, 0.5)
    expect(t).toEqual({ x: 0, y: 120, scaleX: 1, scaleY: 1 })
  })

  it('is the identity at scale 1 (same object, no allocation on the hot path)', () => {
    const t = { x: 3, y: 4 }
    expect(scaleDisplacement(t, 1)).toBe(t)
  })

  it('treats a non-positive or non-finite scale as 1', () => {
    expect(scaleDisplacement({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 })
    expect(scaleDisplacement({ x: 3, y: 4 }, Infinity)).toEqual({ x: 3, y: 4 })
  })

  test.prop([
    fc.double({ min: -500, max: 500, noNaN: true }),
    fc.double({ min: MIN_BOARD_SCALE, max: MAX_BOARD_SCALE, noNaN: true }),
  ])('scaled back by the wrapper it lands where the strategy asked', (y, s) => {
    const layout = scaleDisplacement({ x: 0, y }, s)
    expect(layout.y * s).toBeCloseTo(y, 6)
  })
})
