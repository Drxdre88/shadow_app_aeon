import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { thumbGeometry, scrollTopForThumbTop, pageScrollTarget, MIN_THUMB_HEIGHT } from '../zenScroller'

const metricsArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    overflow: fc.integer({ min: 1, max: 20000 }),
    trackHeight: fc.integer({ min: 40, max: 2000 }),
  })
  .map(({ clientHeight, overflow, trackHeight }) => ({
    clientHeight,
    scrollHeight: clientHeight + overflow,
    trackHeight,
  }))

describe('thumbGeometry', () => {
  test.prop([metricsArb, fc.double({ min: 0, max: 1, noNaN: true })])(
    'thumb always stays inside the track',
    ({ clientHeight, scrollHeight, trackHeight }, scrollFrac) => {
      const scrollTop = scrollFrac * (scrollHeight - clientHeight)
      const geom = thumbGeometry(scrollTop, scrollHeight, clientHeight, trackHeight)
      expect(geom.visible).toBe(true)
      expect(geom.thumbHeight).toBeGreaterThanOrEqual(Math.min(MIN_THUMB_HEIGHT, trackHeight) - 1e-9)
      expect(geom.thumbHeight).toBeLessThanOrEqual(trackHeight + 1e-9)
      expect(geom.thumbTop).toBeGreaterThanOrEqual(0)
      expect(geom.thumbTop + geom.thumbHeight).toBeLessThanOrEqual(trackHeight + 1e-9)
    }
  )

  test.prop([metricsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })])(
    'thumb position is monotonic in scrollTop',
    ({ clientHeight, scrollHeight, trackHeight }, fracA, fracB) => {
      const maxScroll = scrollHeight - clientHeight
      const [lo, hi] = fracA <= fracB ? [fracA, fracB] : [fracB, fracA]
      const geomLo = thumbGeometry(lo * maxScroll, scrollHeight, clientHeight, trackHeight)
      const geomHi = thumbGeometry(hi * maxScroll, scrollHeight, clientHeight, trackHeight)
      expect(geomHi.thumbTop).toBeGreaterThanOrEqual(geomLo.thumbTop - 1e-9)
    }
  )

  it('hides when the content fits', () => {
    expect(thumbGeometry(0, 500, 500, 400).visible).toBe(false)
    expect(thumbGeometry(0, 300, 500, 400).visible).toBe(false)
  })

  it('clamps out-of-range scrollTop', () => {
    const geom = thumbGeometry(99999, 1000, 500, 400)
    expect(geom.thumbTop + geom.thumbHeight).toBeLessThanOrEqual(400 + 1e-9)
    expect(thumbGeometry(-50, 1000, 500, 400).thumbTop).toBe(0)
  })
})

describe('scrollTopForThumbTop', () => {
  test.prop([metricsArb, fc.double({ min: 0, max: 1, noNaN: true })])(
    'round-trips through thumbGeometry',
    ({ clientHeight, scrollHeight, trackHeight }, scrollFrac) => {
      const scrollTop = scrollFrac * (scrollHeight - clientHeight)
      const geom = thumbGeometry(scrollTop, scrollHeight, clientHeight, trackHeight)
      const roundTripped = scrollTopForThumbTop(geom.thumbTop, scrollHeight, clientHeight, trackHeight, geom.thumbHeight)
      // When the thumb has no travel range (tiny track) the mapping collapses
      // to 0 — otherwise the drag mapping must invert the geometry exactly.
      if (trackHeight - geom.thumbHeight > 1e-9) {
        expect(roundTripped).toBeCloseTo(scrollTop, 4)
      } else {
        expect(roundTripped).toBe(0)
      }
    }
  )

  test.prop([metricsArb, fc.double({ min: -500, max: 2500, noNaN: true })])(
    'always returns a scrollTop inside the scrollable range',
    ({ clientHeight, scrollHeight, trackHeight }, thumbTop) => {
      const geom = thumbGeometry(0, scrollHeight, clientHeight, trackHeight)
      const result = scrollTopForThumbTop(thumbTop, scrollHeight, clientHeight, trackHeight, geom.thumbHeight)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(scrollHeight - clientHeight + 1e-9)
    }
  )
})

describe('pageScrollTarget', () => {
  test.prop([metricsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom<1 | -1>(1, -1)])(
    'pages stay inside the scrollable range and move toward the tap',
    ({ clientHeight, scrollHeight }, scrollFrac, direction) => {
      const maxScroll = scrollHeight - clientHeight
      const scrollTop = scrollFrac * maxScroll
      const result = pageScrollTarget(scrollTop, clientHeight, scrollHeight, direction)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(maxScroll + 1e-9)
      if (direction === 1) expect(result).toBeGreaterThanOrEqual(scrollTop - 1e-9)
      else expect(result).toBeLessThanOrEqual(scrollTop + 1e-9)
    }
  )

  it('pages by almost a full viewport', () => {
    expect(pageScrollTarget(0, 500, 5000, 1)).toBe(450)
    expect(pageScrollTarget(450, 500, 5000, -1)).toBe(0)
  })
})
