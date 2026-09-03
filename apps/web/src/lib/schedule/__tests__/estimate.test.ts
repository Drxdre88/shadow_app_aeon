/**
 * Lane C2 — proves the size-to-duration conversion (CHR-13). The live bug this fixes:
 * the old Gantt bridge ignored the board's sizing unit, so a points board scheduled
 * "5" as five days instead of five points' worth of hours.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { resolveEstimateMinutes } from '../estimate'
import { LONDON_MON_FRI } from '../fixtures'
import type { SizingModel } from '../types'

const DAYS_BOARD: SizingModel = { unit: 'days', hoursPerPoint: 6 }
const POINTS_BOARD: SizingModel = { unit: 'points', hoursPerPoint: 6 }
const CALENDAR = { hoursPerDay: LONDON_MON_FRI.hoursPerDay }

const sized = (size: number | null, estimateMinutes: number | null = null) => ({
  size,
  estimateMinutes,
})

describe('resolveEstimateMinutes — the board unit decides', () => {
  it('converts the same size differently on a points board and a days board', () => {
    const points = resolveEstimateMinutes(sized(5), POINTS_BOARD, CALENDAR)
    const days = resolveEstimateMinutes(sized(5), DAYS_BOARD, CALENDAR)

    expect(points).toBe(5 * 6 * 60)
    expect(days).toBe(5 * 8 * 60)
    expect(points).not.toBe(days)
  })

  it('reads hoursPerPoint on a points board and hoursPerDay on a days board', () => {
    expect(resolveEstimateMinutes(sized(3), { unit: 'points', hoursPerPoint: 4 }, CALENDAR)).toBe(
      3 * 4 * 60,
    )
    expect(
      resolveEstimateMinutes(sized(3), { unit: 'points', hoursPerPoint: 4 }, { hoursPerDay: 12 }),
    ).toBe(3 * 4 * 60)
    expect(resolveEstimateMinutes(sized(3), DAYS_BOARD, { hoursPerDay: 12 })).toBe(3 * 12 * 60)
  })

  it('never lets a points board fall back to the days conversion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0.5, max: 24, noNaN: true }),
        (size, hoursPerPoint) => {
          fc.pre(Math.abs(hoursPerPoint - CALENDAR.hoursPerDay) > 1e-9)
          const points = resolveEstimateMinutes(
            sized(size),
            { unit: 'points', hoursPerPoint },
            CALENDAR,
          )
          expect(points).toBe(Math.round(size * hoursPerPoint * 60))
          expect(points).not.toBe(resolveEstimateMinutes(sized(size), DAYS_BOARD, CALENDAR))
        },
      ),
      { numRuns: 200 },
    )
  })

  it('scales linearly with size', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (size) => {
        expect(resolveEstimateMinutes(sized(size), POINTS_BOARD, CALENDAR)).toBe(size * 6 * 60)
        expect(resolveEstimateMinutes(sized(size), DAYS_BOARD, CALENDAR)).toBe(size * 8 * 60)
      }),
      { numRuns: 200 },
    )
  })

  it('handles a fractional size by rounding to whole minutes', () => {
    expect(resolveEstimateMinutes(sized(0.5), DAYS_BOARD, CALENDAR)).toBe(4 * 60)
    expect(resolveEstimateMinutes(sized(1.5), POINTS_BOARD, CALENDAR)).toBe(9 * 60)
    const odd = resolveEstimateMinutes(sized(1 / 3), POINTS_BOARD, CALENDAR)
    expect(odd).toBe(120)
    expect(Number.isInteger(odd)).toBe(true)
  })
})

describe('resolveEstimateMinutes — explicit minutes always win', () => {
  it('ignores size and the board unit when estimateMinutes is set', () => {
    expect(resolveEstimateMinutes({ size: 5, estimateMinutes: 90 }, POINTS_BOARD, CALENDAR)).toBe(90)
    expect(resolveEstimateMinutes({ size: 5, estimateMinutes: 90 }, DAYS_BOARD, CALENDAR)).toBe(90)
    expect(resolveEstimateMinutes({ size: null, estimateMinutes: 90 }, DAYS_BOARD, CALENDAR)).toBe(
      90,
    )
  })

  it('wins for every size and every board', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
        fc.constantFrom(POINTS_BOARD, DAYS_BOARD),
        (estimateMinutes, size, sizing) => {
          expect(resolveEstimateMinutes({ size, estimateMinutes }, sizing, CALENDAR)).toBe(
            estimateMinutes,
          )
        },
      ),
      { numRuns: 200 },
    )
  })

  it('rounds a fractional explicit estimate rather than passing it through', () => {
    expect(resolveEstimateMinutes({ size: null, estimateMinutes: 90.4 }, DAYS_BOARD, CALENDAR)).toBe(
      90,
    )
    expect(resolveEstimateMinutes({ size: null, estimateMinutes: 90.6 }, DAYS_BOARD, CALENDAR)).toBe(
      91,
    )
  })
})

describe('resolveEstimateMinutes — unestimated returns null', () => {
  it('returns null when neither minutes nor size is present', () => {
    expect(resolveEstimateMinutes(sized(null), DAYS_BOARD, CALENDAR)).toBeNull()
    expect(resolveEstimateMinutes(sized(null), POINTS_BOARD, CALENDAR)).toBeNull()
  })

  it('treats a non-positive or non-finite value as unestimated', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveEstimateMinutes(sized(value), DAYS_BOARD, CALENDAR)).toBeNull()
      expect(resolveEstimateMinutes({ size: null, estimateMinutes: value }, DAYS_BOARD, CALENDAR)).toBeNull()
    }
  })

  it('falls back from a zeroed explicit estimate to the size conversion', () => {
    expect(resolveEstimateMinutes({ size: 2, estimateMinutes: 0 }, DAYS_BOARD, CALENDAR)).toBe(
      2 * 8 * 60,
    )
  })

  it('returns null rather than zero when the board has no usable rate', () => {
    expect(resolveEstimateMinutes(sized(5), { unit: 'points', hoursPerPoint: 0 }, CALENDAR)).toBeNull()
    expect(resolveEstimateMinutes(sized(5), DAYS_BOARD, { hoursPerDay: 0 })).toBeNull()
  })

  it('floors a positive estimate at one minute instead of rounding it away to zero', () => {
    expect(resolveEstimateMinutes(sized(0.001), POINTS_BOARD, CALENDAR)).toBe(1)
    expect(resolveEstimateMinutes(sized(0.001), DAYS_BOARD, CALENDAR)).toBe(1)
    expect(resolveEstimateMinutes({ size: null, estimateMinutes: 0.4 }, DAYS_BOARD, CALENDAR)).toBe(1)
  })

  it('never returns a non-positive number', () => {
    fc.assert(
      fc.property(
        fc.option(fc.double({ min: -100, max: 100, noNaN: true }), { nil: null }),
        fc.option(fc.double({ min: -100, max: 100_000, noNaN: true }), { nil: null }),
        fc.constantFrom(POINTS_BOARD, DAYS_BOARD),
        (size, estimateMinutes, sizing) => {
          const result = resolveEstimateMinutes({ size, estimateMinutes }, sizing, CALENDAR)
          expect(result === null || (Number.isFinite(result) && result > 0)).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })
})
