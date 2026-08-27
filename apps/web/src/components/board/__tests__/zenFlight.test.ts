import { describe, it, expect, afterEach, vi } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { zenTargetRect, flightTransform, measureColumnRect, ZEN_WIDTH_FACTOR, ZEN_GUTTER, type ZenRect } from '../zenFlight'

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
  test.prop([
    fc.integer({ min: 320, max: 4000 }),
    fc.integer({ min: 400, max: 3000 }),
    fc.integer({ min: 250, max: 1200 }),
  ])(
    'stays inside the viewport with the gutter respected',
    (vw, vh, cw) => {
      const rect = zenTargetRect(vw, vh, cw)
      expect(rect.left).toBeGreaterThanOrEqual(ZEN_GUTTER - 1e-9)
      expect(rect.top).toBe(ZEN_GUTTER)
      expect(rect.left + rect.width).toBeLessThanOrEqual(vw - ZEN_GUTTER + 1e-9)
      expect(rect.top + rect.height).toBeLessThanOrEqual(vh - ZEN_GUTTER + 1e-9)
    }
  )

  test.prop([
    fc.integer({ min: 320, max: 4000 }),
    fc.integer({ min: 400, max: 3000 }),
    fc.integer({ min: 250, max: 1200 }),
  ])(
    'is horizontally centered',
    (vw, vh, cw) => {
      const rect = zenTargetRect(vw, vh, cw)
      const centerX = rect.left + rect.width / 2
      expect(centerX).toBeCloseTo(vw / 2, 6)
    }
  )

  it('surface is 1.5x the configured column width when the viewport allows', () => {
    const rect = zenTargetRect(2000, 1000, 400)
    expect(rect.width).toBe(400 * ZEN_WIDTH_FACTOR)
  })

  it('narrow phone viewport gets the full width minus gutters', () => {
    const rect = zenTargetRect(390, 844, 400)
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

// measureColumnRect is what both the entry (openZenMode) and the exit flight
// read: a wrong answer here is either a flight from nowhere or — worse — a
// selector that throws and blocks Zen entirely.
describe('measureColumnRect', () => {
  function mountColumn(id: string, rect?: Partial<DOMRect>): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-column-id', id)
    if (rect) {
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect
    }
    document.body.appendChild(el)
    return el
  }

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('returns the element\'s visual rect', () => {
    mountColumn('col-1', { left: 40, top: 90, width: 320, height: 620 })
    expect(measureColumnRect('col-1')).toEqual({ left: 40, top: 90, width: 320, height: 620 })
  })

  it('returns null when no column with that id is mounted', () => {
    mountColumn('col-1', { left: 0, top: 0, width: 10, height: 10 })
    expect(measureColumnRect('col-2')).toBeNull()
  })

  // A detached / display:none column measures 0x0. Flying to a zero rect would
  // scale the surface to nothing, so the caller must get null and fall back.
  it('returns null for a zero-size (unrendered) column', () => {
    mountColumn('col-hidden') // jsdom's default rect is all zeros
    expect(measureColumnRect('col-hidden')).toBeNull()
  })

  it('a zero-WIDTH but visible column still measures (only fully-empty rects bail)', () => {
    mountColumn('col-thin', { left: 5, top: 6, width: 0, height: 400 })
    expect(measureColumnRect('col-thin')).toEqual({ left: 5, top: 6, width: 0, height: 400 })
  })

  it('escapes ids that would otherwise break the attribute selector', () => {
    // Real column ids are uuids, but nothing in the type system stops a quote
    // or backslash from reaching here — an unescaped one throws SyntaxError
    // out of querySelector and takes the whole board down.
    mountColumn('col"1\\odd', { left: 1, top: 2, width: 3, height: 4 })
    expect(measureColumnRect('col"1\\odd')).toEqual({ left: 1, top: 2, width: 3, height: 4 })
  })

  it('falls back to manual escaping where CSS.escape is unavailable', () => {
    // Older WebViews (the Capacitor shell's floor) have no CSS.escape.
    vi.stubGlobal('CSS', undefined)
    mountColumn('col"1', { left: 7, top: 8, width: 9, height: 10 })
    expect(measureColumnRect('col"1')).toEqual({ left: 7, top: 8, width: 9, height: 10 })
    expect(() => measureColumnRect('col\\weird')).not.toThrow()
  })
})
