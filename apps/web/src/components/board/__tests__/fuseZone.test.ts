import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  FUSE_DWELL_MS,
  FUSE_BAND_ARMED,
  FUSE_BAND_ENTER,
  IDLE_FUSE_INTENT,
  dropZoneFromY,
  msUntilArmed,
  nextFuseIntent,
  type DropZone,
  type FuseIntent,
} from '../fuseZone'

// A hovered card splits into thirds: before / fuse / after. The pure geometry
// and the dwell machine that turns "pointer in the middle" into "armed to
// fuse" are pinned here, independent of dnd-kit.

describe('dropZoneFromY — thirds', () => {
  const rect = { top: 100, height: 90 }

  it('top third places before, middle third fuses, bottom third places after', () => {
    expect(dropZoneFromY(100, rect)).toBe('before')
    expect(dropZoneFromY(129, rect)).toBe('before')
    expect(dropZoneFromY(130, rect)).toBe('fuse')
    expect(dropZoneFromY(159, rect)).toBe('fuse')
    expect(dropZoneFromY(160, rect)).toBe('after')
    expect(dropZoneFromY(189, rect)).toBe('after')
  })

  it('outside the card resolves to the nearest edge zone', () => {
    expect(dropZoneFromY(50, rect)).toBe('before')
    expect(dropZoneFromY(400, rect)).toBe('after')
  })

  it('a zero-height rect never fuses', () => {
    expect(dropZoneFromY(10, { top: 20, height: 0 })).toBe('before')
    expect(dropZoneFromY(30, { top: 20, height: 0 })).toBe('after')
  })

  it('the armed band is wider than the entry band (hysteresis)', () => {
    expect(FUSE_BAND_ARMED[0]).toBeLessThan(FUSE_BAND_ENTER[0])
    expect(FUSE_BAND_ARMED[1]).toBeGreaterThan(FUSE_BAND_ENTER[1])
    // 28% down the card: outside the entry band, inside the armed band.
    const y = rect.top + rect.height * 0.28
    expect(dropZoneFromY(y, rect, false)).toBe('before')
    expect(dropZoneFromY(y, rect, true)).toBe('fuse')
  })

  test.prop([
    fc.double({ min: -5000, max: 5000, noNaN: true }),
    fc.double({ min: 1, max: 2000, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
    fc.boolean(),
  ])('the three bands partition the card height in order', (top, height, fraction, armed) => {
    const y = top + height * fraction
    const zone = dropZoneFromY(y, { top, height }, armed)
    const [lo, hi] = armed ? FUSE_BAND_ARMED : FUSE_BAND_ENTER
    const expected: DropZone = fraction < lo ? 'before' : fraction < hi ? 'fuse' : 'after'
    // Floating-point: recompute the fraction the same way the function does.
    const t = (y - top) / height
    const expectedFromT: DropZone = t < lo ? 'before' : t < hi ? 'fuse' : 'after'
    expect(zone).toBe(expectedFromT)
    if (Math.abs(t - fraction) < 1e-9) expect(zone).toBe(expected)
  })

  test.prop([
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.double({ min: 1, max: 1000, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  ])('zones are monotonic down the card', (top, height, f1, f2) => {
    const order: Record<DropZone, number> = { before: 0, fuse: 1, after: 2 }
    const [lo, hi] = [Math.min(f1, f2), Math.max(f1, f2)]
    const a = dropZoneFromY(top + height * lo, { top, height })
    const b = dropZoneFromY(top + height * hi, { top, height })
    expect(order[a]).toBeLessThanOrEqual(order[b])
  })
})

describe('nextFuseIntent — dwell', () => {
  const on = (targetId: string, now: number, zone: DropZone = 'fuse') => ({ targetId, zone, now })

  it('entering a card\'s middle starts a dwell but does not arm', () => {
    const s = nextFuseIntent(IDLE_FUSE_INTENT, on('b', 1000))
    expect(s).toEqual({ targetId: 'b', since: 1000, armed: false })
    expect(msUntilArmed(s, 1000)).toBe(FUSE_DWELL_MS)
  })

  it('staying in the middle for the dwell arms; leaving it disarms', () => {
    let s = nextFuseIntent(IDLE_FUSE_INTENT, on('b', 1000))
    s = nextFuseIntent(s, on('b', 1000 + FUSE_DWELL_MS - 1))
    expect(s.armed).toBe(false)
    s = nextFuseIntent(s, on('b', 1000 + FUSE_DWELL_MS))
    expect(s.armed).toBe(true)
    expect(msUntilArmed(s, 5000)).toBeNull()
    s = nextFuseIntent(s, on('b', 2000, 'after'))
    expect(s).toEqual(IDLE_FUSE_INTENT)
  })

  it('passing through the middle on the way to the bottom never arms', () => {
    let s = nextFuseIntent(IDLE_FUSE_INTENT, on('b', 0, 'before'))
    s = nextFuseIntent(s, on('b', 50, 'fuse'))
    s = nextFuseIntent(s, on('b', 120, 'fuse'))
    s = nextFuseIntent(s, on('b', 200, 'after'))
    expect(s.armed).toBe(false)
    expect(s.targetId).toBeNull()
  })

  it('switching cards restarts the dwell', () => {
    let s = nextFuseIntent(IDLE_FUSE_INTENT, on('b', 0))
    s = nextFuseIntent(s, on('c', 300))
    expect(s).toEqual({ targetId: 'c', since: 300, armed: false })
    s = nextFuseIntent(s, on('c', 300 + FUSE_DWELL_MS - 1))
    expect(s.armed).toBe(false)
  })

  it('no target means idle', () => {
    const armed: FuseIntent = { targetId: 'b', since: 0, armed: true }
    expect(nextFuseIntent(armed, { targetId: null, zone: null, now: 10_000 })).toEqual(IDLE_FUSE_INTENT)
  })
})
