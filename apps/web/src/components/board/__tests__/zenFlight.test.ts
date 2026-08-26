import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { zenTargetRect, flightTransform, ZEN_MAX_WIDTH, ZEN_GUTTER, type ZenRect } from '../zenFlight'

const rectArb = fc.record({
  left: fc.double({ min: -2000, max: 4000, noNaN: true, noDefaultInfinity: true }),
  top: fc.double({ min: -2000, max: 4000, noNaN: true, noDefaultInfinity: true }),
  width: fc.double({ min: 1, max: 4000, noNaN: true, noDefaultInfinity: true }),
  height: fc.double({ min: 1, max: 4000, noNaN: true, noDefaultInfinity: true }),
})

function applyTransform(target: ZenRect, pose: { x: number; y: number; scaleX: number; scaleY: number }): ZenRect {
  // transform-origin 0 0: translate then scale about the rect's own top-left.
  return {
    left: target.left + pose.x,
    top: target.top + pose.y,
    width: target.width * pose.scaleX,
    height: target.height * pose.scaleY,
  }
}

describe('zenTargetRect', () => {
  test.prop([fc.integer({ min: 320, max: 4000 }), fc.integer({ min: 400, max: 3000 })])(
    'stays inside the viewport with the gutter respected',
    (vw, vh) => {
      const rect = zenTargetRect(vw, vh)
      expect(rect.left).toBeGreaterThanOrEqual(ZEN_GUTTER - 1e-9)
      expect(rect.top).toBe(ZEN_GUTTER)
      expect(rect.left + rect.width).toBeLessThanOrEqual(vw - ZEN_GUTTER + 1e-9)
      expect(rect.top + rect.height).toBeLessThanOrEqual(vh - ZEN_GUTTER + 1e-9)
      expect(rect.width).toBeLessThanOrEqual(ZEN_MAX_WIDTH)
    }
  )

  test.prop([fc.integer({ min: 320, max: 4000 }), fc.integer({ min: 400, max: 3000 })])(
    'is horizontally centered',
    (vw, vh) => {
      const rect = zenTargetRect(vw, vh)
      const centerX = rect.left + rect.width / 2
      expect(centerX).toBeCloseTo(vw / 2, 6)
    }
  )

  it('narrow phone viewport gets the full width minus gutters', () => {
    const rect = zenTargetRect(390, 844)
    expect(rect.width).toBe(390 - ZEN_GUTTER * 2)
    expect(rect.height).toBe(844 - ZEN_GUTTER * 2)
  })
})

describe('flightTransform', () => {
  test.prop([rectArb, rectArb])('applying the pose to the target reproduces the source rect', (source, target) => {
    const pose = flightTransform(source, target)
    const applied = applyTransform(target, pose)
    expect(applied.left).toBeCloseTo(source.left, 6)
    expect(applied.top).toBeCloseTo(source.top, 6)
    expect(applied.width).toBeCloseTo(source.width, 6)
    expect(applied.height).toBeCloseTo(source.height, 6)
  })

  test.prop([rectArb, rectArb])('scales are finite and positive', (source, target) => {
    const pose = flightTransform(source, target)
    expect(Number.isFinite(pose.scaleX)).toBe(true)
    expect(Number.isFinite(pose.scaleY)).toBe(true)
    expect(pose.scaleX).toBeGreaterThan(0)
    expect(pose.scaleY).toBeGreaterThan(0)
  })

  it('identical rects give the identity pose', () => {
    const rect = { left: 100, top: 50, width: 320, height: 600 }
    expect(flightTransform(rect, rect)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
  })

  it('degenerate target dimensions fall back to scale 1', () => {
    const source = { left: 0, top: 0, width: 300, height: 500 }
    const target = { left: 10, top: 10, width: 0, height: 0 }
    const pose = flightTransform(source, target)
    expect(pose.scaleX).toBe(1)
    expect(pose.scaleY).toBe(1)
  })
})
