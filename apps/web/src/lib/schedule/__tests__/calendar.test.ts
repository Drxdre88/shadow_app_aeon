/**
 * Lane C2 — proves the calendar index. Every boundary must be resolved in the
 * calendar's own IANA zone, and every duration must preserve WORKING length across
 * a DST transition. The current Gantt fails both: it computes boundaries in the
 * server's zone (Vercel is UTC), so bars land a day early west of UTC.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { buildCalendarIndex, DEFAULT_WORK_DAY_START_HOUR } from '../calendar'
import { DENVER_MON_FRI, LONDON_MON_FRI, LONDON_WITH_HOLIDAY } from '../fixtures'
import { WORKWEEK_MON_FRI, type CalendarIndex, type SolveWindow, type WorkCalendar } from '../types'

const WINDOW: SolveWindow = {
  start: new Date('2026-08-01T00:00:00.000Z'),
  end: new Date('2026-12-31T00:00:00.000Z'),
}

const MINUTES_PER_WORK_DAY = 8 * 60

/** A one-off working Saturday — the mirror image of the holiday case. */
const LONDON_WITH_SATURDAY: WorkCalendar = {
  ...LONDON_MON_FRI,
  id: 'cal-london-saturday',
  exceptions: [{ day: '2026-09-05', isWorking: true }],
}

const london = buildCalendarIndex(LONDON_MON_FRI, WINDOW)
const denver = buildCalendarIndex(DENVER_MON_FRI, WINDOW)
const holiday = buildCalendarIndex(LONDON_WITH_HOLIDAY, WINDOW)
const saturday = buildCalendarIndex(LONDON_WITH_SATURDAY, WINDOW)

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()

function localParts(timeZone: string, instant: Date): { day: string; time: string } {
  let formatter = partsFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatterCache.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(instant)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
  }
}

function localOf(index: CalendarIndex, instant: Date) {
  return localParts(index.timezone, instant)
}

const at = (iso: string) => new Date(iso)

describe('buildCalendarIndex — contract surface', () => {
  it('carries the calendar identity through to the index', () => {
    expect(london.calendarId).toBe(LONDON_MON_FRI.id)
    expect(london.timezone).toBe('Europe/London')
    expect(london.hoursPerDay).toBe(8)
    expect(denver.timezone).toBe('America/Denver')
  })

  it('opens the working day at the documented local hour, not at local midnight', () => {
    const expected = `${String(DEFAULT_WORK_DAY_START_HOUR).padStart(2, '0')}:00`
    for (const index of [london, denver]) {
      const dayOpen = index.snapToNextWorkingInstant(at('2026-09-06T12:00:00.000Z'))
      expect(localOf(index, dayOpen)).toEqual({ day: '2026-09-07', time: expected })
      expect(localOf(index, index.addDuration(dayOpen, MINUTES_PER_WORK_DAY))).toEqual({
        day: '2026-09-08',
        time: expected,
      })
    }
  })

  it('runs the day for hoursPerDay of real time from that local start, whatever the length', () => {
    const twelveHourDay = buildCalendarIndex({ ...LONDON_MON_FRI, id: 'cal-12h', hoursPerDay: 12 }, WINDOW)
    const start = twelveHourDay.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))
    expect(localOf(twelveHourDay, start).time).toBe('09:00')
    expect(twelveHourDay.isWorkingInstant(at('2026-09-07T19:59:00.000Z'))).toBe(true)
    expect(twelveHourDay.isWorkingInstant(at('2026-09-07T20:00:00.000Z'))).toBe(false)
    expect(
      twelveHourDay.workingMinutesBetween(at('2026-09-07T00:00:00.000Z'), at('2026-09-08T00:00:00.000Z')),
    ).toBe(12 * 60)
  })

  it('derives the working day as hoursPerDay of real time from that local start', () => {
    const start = at('2026-09-07T08:00:00.000Z')
    const end = london.addDuration(start, MINUTES_PER_WORK_DAY - 1)
    expect(localOf(london, start).time).toBe('09:00')
    expect(localOf(london, end).day).toBe('2026-09-07')
    expect(localOf(london, end).time).toBe('16:59')
    expect(london.isWorkingInstant(at('2026-09-07T15:59:00.000Z'))).toBe(true)
    expect(london.isWorkingInstant(at('2026-09-07T16:00:00.000Z'))).toBe(false)
  })
})

describe('timezone boundaries are resolved in the calendar zone, never the server zone', () => {
  it('disagrees between a zone east of UTC and one west of it for the same instant', () => {
    const nineUtc = at('2026-09-07T09:00:00.000Z')
    expect(london.isWorkingInstant(nineUtc)).toBe(true)
    expect(denver.isWorkingInstant(nineUtc)).toBe(false)

    const tenPmUtc = at('2026-09-07T22:00:00.000Z')
    expect(london.isWorkingInstant(tenPmUtc)).toBe(false)
    expect(denver.isWorkingInstant(tenPmUtc)).toBe(true)
  })

  it('places the same working day on the same civil day in both zones', () => {
    const mondayLondon = london.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))
    const mondayDenver = denver.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))

    expect(localOf(london, mondayLondon)).toEqual({ day: '2026-09-07', time: '09:00' })
    expect(localOf(denver, mondayDenver)).toEqual({ day: '2026-09-07', time: '09:00' })
    expect(mondayLondon.toISOString()).toBe('2026-09-07T08:00:00.000Z')
    expect(mondayDenver.toISOString()).toBe('2026-09-07T15:00:00.000Z')
  })

  it('never lets a westward viewer slip a working day back to the previous civil day', () => {
    for (const iso of [
      '2026-09-07T00:30:00.000Z',
      '2026-09-08T02:00:00.000Z',
      '2026-09-08T05:59:00.000Z',
    ]) {
      const snapped = denver.snapToNextWorkingInstant(at(iso))
      const civil = localOf(denver, snapped)
      expect(civil.time).toBe('09:00')
      expect(civil.day >= localParts('America/Denver', at(iso)).day).toBe(true)
    }
    expect(denver.snapToNextWorkingInstant(at('2026-09-08T02:00:00.000Z')).toISOString()).toBe(
      '2026-09-08T15:00:00.000Z',
    )
  })

  it('separates the two zones by their real offset gap, which itself moves with DST', () => {
    const septLondon = london.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))
    const septDenver = denver.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))
    expect(septDenver.getTime() - septLondon.getTime()).toBe(7 * 60 * 60_000)

    const octLondon = london.snapToNextWorkingInstant(at('2026-10-26T00:00:00.000Z'))
    const octDenver = denver.snapToNextWorkingInstant(at('2026-10-26T00:00:00.000Z'))
    expect(localOf(london, octLondon).day).toBe('2026-10-26')
    expect(localOf(denver, octDenver).day).toBe('2026-10-26')
    expect(octDenver.getTime() - octLondon.getTime()).toBe(6 * 60 * 60_000)
  })
})

describe('DST preserves working length, not wall-clock length', () => {
  it('Europe/London — three working days across the autumn fall-back', () => {
    const start = at('2026-10-23T08:00:00.000Z')
    expect(localOf(london, start)).toEqual({ day: '2026-10-23', time: '09:00' })

    const end = london.addDuration(start, 3 * MINUTES_PER_WORK_DAY)
    expect(localOf(london, end)).toEqual({ day: '2026-10-28', time: '09:00' })
    expect(end.toISOString()).toBe('2026-10-28T09:00:00.000Z')
    expect(london.workingMinutesBetween(start, end)).toBe(3 * MINUTES_PER_WORK_DAY)
    expect(end.getTime() - start.getTime()).toBe(5 * 24 * 60 * 60_000 + 60 * 60_000)
  })

  it('Europe/London — three working days across the spring forward', () => {
    const start = at('2026-03-27T09:00:00.000Z')
    expect(localOf(london, start)).toEqual({ day: '2026-03-27', time: '09:00' })

    const end = london.addDuration(start, 3 * MINUTES_PER_WORK_DAY)
    expect(localOf(london, end)).toEqual({ day: '2026-04-01', time: '09:00' })
    expect(end.toISOString()).toBe('2026-04-01T08:00:00.000Z')
    expect(london.workingMinutesBetween(start, end)).toBe(3 * MINUTES_PER_WORK_DAY)
    expect(end.getTime() - start.getTime()).toBe(5 * 24 * 60 * 60_000 - 60 * 60_000)
  })

  it('America/Denver — shifts on a different date from London and still holds', () => {
    const fallStart = at('2026-10-30T15:00:00.000Z')
    expect(localOf(denver, fallStart)).toEqual({ day: '2026-10-30', time: '09:00' })
    const fallEnd = denver.addDuration(fallStart, 3 * MINUTES_PER_WORK_DAY)
    expect(localOf(denver, fallEnd)).toEqual({ day: '2026-11-04', time: '09:00' })
    expect(fallEnd.toISOString()).toBe('2026-11-04T16:00:00.000Z')
    expect(denver.workingMinutesBetween(fallStart, fallEnd)).toBe(3 * MINUTES_PER_WORK_DAY)

    const springStart = at('2026-03-06T16:00:00.000Z')
    expect(localOf(denver, springStart)).toEqual({ day: '2026-03-06', time: '09:00' })
    const springEnd = denver.addDuration(springStart, 3 * MINUTES_PER_WORK_DAY)
    expect(localOf(denver, springEnd)).toEqual({ day: '2026-03-11', time: '09:00' })
    expect(springEnd.toISOString()).toBe('2026-03-11T15:00:00.000Z')
    expect(denver.workingMinutesBetween(springStart, springEnd)).toBe(3 * MINUTES_PER_WORK_DAY)
  })

  it('London has already shifted while Denver has not, in the week between transitions', () => {
    const londonWeek = london.snapToNextWorkingInstant(at('2026-10-26T00:00:00.000Z'))
    const denverWeek = denver.snapToNextWorkingInstant(at('2026-10-26T00:00:00.000Z'))
    expect(londonWeek.toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(denverWeek.toISOString()).toBe('2026-10-26T15:00:00.000Z')
  })

  it('counts a DST week as five working days, not four-and-a-bit', () => {
    const monday = london.snapToNextWorkingInstant(at('2026-10-26T00:00:00.000Z'))
    const nextMonday = london.snapToNextWorkingInstant(at('2026-11-02T00:00:00.000Z'))
    expect(london.workingMinutesBetween(monday, nextMonday)).toBe(5 * MINUTES_PER_WORK_DAY)
  })
})

describe('calendar exceptions', () => {
  it('skips a non-working holiday entirely', () => {
    for (const iso of [
      '2026-08-31T08:00:00.000Z',
      '2026-08-31T12:00:00.000Z',
      '2026-08-31T15:59:00.000Z',
    ]) {
      expect(holiday.isWorkingInstant(at(iso))).toBe(false)
      expect(london.isWorkingInstant(at(iso))).toBe(true)
    }
    const mondayStart = at('2026-08-31T00:00:00.000Z')
    const tuesdayStart = at('2026-09-01T00:00:00.000Z')
    expect(holiday.workingMinutesBetween(mondayStart, tuesdayStart)).toBe(0)
    expect(london.workingMinutesBetween(mondayStart, tuesdayStart)).toBe(MINUTES_PER_WORK_DAY)
  })

  it('contributes exactly four hours on the half-day', () => {
    const dayStart = at('2026-08-28T00:00:00.000Z')
    const dayEnd = at('2026-08-29T00:00:00.000Z')
    expect(holiday.workingMinutesBetween(dayStart, dayEnd)).toBe(4 * 60)
    expect(london.workingMinutesBetween(dayStart, dayEnd)).toBe(MINUTES_PER_WORK_DAY)

    expect(holiday.isWorkingInstant(at('2026-08-28T11:59:00.000Z'))).toBe(true)
    expect(holiday.isWorkingInstant(at('2026-08-28T12:00:00.000Z'))).toBe(false)
    expect(london.isWorkingInstant(at('2026-08-28T12:00:00.000Z'))).toBe(true)
  })

  it('rolls work past the half-day and the holiday to the next working morning', () => {
    const start = at('2026-08-28T08:00:00.000Z')
    expect(localOf(holiday, start)).toEqual({ day: '2026-08-28', time: '09:00' })

    const withinHalfDay = holiday.addDuration(start, 120)
    expect(localOf(holiday, withinHalfDay)).toEqual({ day: '2026-08-28', time: '11:00' })

    const afterHalfDay = holiday.addDuration(start, 4 * 60)
    expect(localOf(holiday, afterHalfDay)).toEqual({ day: '2026-09-01', time: '09:00' })

    const fullDayOfWork = holiday.addDuration(start, MINUTES_PER_WORK_DAY)
    expect(localOf(holiday, fullDayOfWork)).toEqual({ day: '2026-09-01', time: '13:00' })
  })

  it('counts a one-off working Saturday', () => {
    const saturdayNoon = at('2026-09-05T11:00:00.000Z')
    expect(saturday.isWorkingInstant(saturdayNoon)).toBe(true)
    expect(london.isWorkingInstant(saturdayNoon)).toBe(false)

    const fridayStart = at('2026-09-04T08:00:00.000Z')
    expect(localOf(saturday, saturday.addDuration(fridayStart, MINUTES_PER_WORK_DAY))).toEqual({
      day: '2026-09-05',
      time: '09:00',
    })
    expect(localOf(london, london.addDuration(fridayStart, MINUTES_PER_WORK_DAY))).toEqual({
      day: '2026-09-07',
      time: '09:00',
    })

    const dayStart = at('2026-09-04T23:00:00.000Z')
    const dayEnd = at('2026-09-05T23:00:00.000Z')
    expect(saturday.workingMinutesBetween(dayStart, dayEnd)).toBe(MINUTES_PER_WORK_DAY)
    expect(london.workingMinutesBetween(dayStart, dayEnd)).toBe(0)
  })

  it('treats an exception with no hours as a full working day', () => {
    const index = buildCalendarIndex(
      {
        ...LONDON_MON_FRI,
        id: 'cal-x',
        exceptions: [{ day: '2026-09-05', isWorking: true, hours: null }],
      },
      WINDOW,
    )
    expect(
      index.workingMinutesBetween(at('2026-09-04T23:00:00.000Z'), at('2026-09-05T23:00:00.000Z')),
    ).toBe(MINUTES_PER_WORK_DAY)
  })
})

describe('toWorkMinutes and fromWorkMinutes round-trip', () => {
  const indexes: Array<[string, CalendarIndex]> = [
    ['london', london],
    ['denver', denver],
    ['holiday', holiday],
    ['saturday', saturday],
  ]

  for (const [name, index] of indexes) {
    it(`${name} — fromWorkMinutes is a right inverse of toWorkMinutes`, () => {
      fc.assert(
        fc.property(fc.integer({ min: -20_000, max: 60_000 }), (workMinutes) => {
          expect(index.toWorkMinutes(index.fromWorkMinutes(workMinutes))).toBe(workMinutes)
        }),
        { numRuns: 400 },
      )
    })

    it(`${name} — toWorkMinutes is a right inverse of fromWorkMinutes on working instants`, () => {
      fc.assert(
        fc.property(
          fc
            .integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) })
            .map((ms) => ms - (ms % 60_000)),
          (ms) => {
            const instant = new Date(ms)
            fc.pre(index.isWorkingInstant(instant))
            expect(index.fromWorkMinutes(index.toWorkMinutes(instant)).getTime()).toBe(ms)
          },
        ),
        { numRuns: 400 },
      )
    })
  }

  it('round-trips a half-minute without losing precision', () => {
    const base = london.toWorkMinutes(at('2026-09-07T08:00:00.000Z'))
    expect(london.toWorkMinutes(london.fromWorkMinutes(base + 0.5))).toBe(base + 0.5)
  })
})

describe('totality — no method throws, every result is well formed', () => {
  const indexes = [london, denver, holiday, saturday]

  it('addDuration never lands on a non-working instant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 6, 1), max: Date.UTC(2027, 0, 31) }),
        fc.integer({ min: 0, max: 40 * MINUTES_PER_WORK_DAY }),
        (ms, minutes) => {
          for (const index of indexes) {
            const result = index.addDuration(new Date(ms), minutes)
            expect(Number.isFinite(result.getTime())).toBe(true)
            expect(index.isWorkingInstant(result)).toBe(true)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('addDuration is monotonic in duration and never moves backwards in working time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        (ms, a, b) => {
          const start = new Date(ms)
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          const first = london.addDuration(start, lo)
          const second = london.addDuration(start, hi)
          expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime())
          expect(london.workingMinutesBetween(start, second)).toBeGreaterThanOrEqual(hi - 1e-6)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('snapToNextWorkingInstant is idempotent and never moves a working instant', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2026, 6, 1), max: Date.UTC(2027, 0, 31) }), (ms) => {
        for (const index of indexes) {
          const once = index.snapToNextWorkingInstant(new Date(ms))
          const twice = index.snapToNextWorkingInstant(once)
          expect(twice.getTime()).toBe(once.getTime())
          expect(index.isWorkingInstant(once)).toBe(true)
          expect(once.getTime()).toBeGreaterThanOrEqual(ms)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('snapToNextWorkingInstant returns the instant unchanged when it is already working', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) }), (ms) => {
        fc.pre(london.isWorkingInstant(new Date(ms)))
        expect(london.snapToNextWorkingInstant(new Date(ms)).getTime()).toBe(ms)
      }),
      { numRuns: 300 },
    )
  })

  it('workingMinutesBetween is antisymmetric and additive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) }),
        fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) }),
        fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 11, 1) }),
        (a, b, c) => {
          const [da, db, dc] = [new Date(a), new Date(b), new Date(c)]
          expect(london.workingMinutesBetween(da, db)).toBeCloseTo(
            -london.workingMinutesBetween(db, da),
            6,
          )
          expect(
            london.workingMinutesBetween(da, db) + london.workingMinutesBetween(db, dc),
          ).toBeCloseTo(london.workingMinutesBetween(da, dc), 6)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('toWorkMinutes is non-decreasing in the instant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2028, 0, 1) }),
        fc.integer({ min: 0, max: 90 * 24 * 60 * 60_000 }),
        (ms, delta) => {
          expect(london.toWorkMinutes(new Date(ms + delta))).toBeGreaterThanOrEqual(
            london.toWorkMinutes(new Date(ms)),
          )
        },
      ),
      { numRuns: 300 },
    )
  })

  it('handles instants far outside the built window by clamping, as documented', () => {
    const farFuture = at('2400-01-01T00:00:00.000Z')
    const farPast = at('1900-01-01T00:00:00.000Z')
    for (const index of indexes) {
      expect(() => index.toWorkMinutes(farFuture)).not.toThrow()
      expect(() => index.toWorkMinutes(farPast)).not.toThrow()
      expect(Number.isFinite(index.toWorkMinutes(farFuture))).toBe(true)
      expect(Number.isFinite(index.toWorkMinutes(farPast))).toBe(true)
      expect(Number.isFinite(index.addDuration(farFuture, 480).getTime())).toBe(true)
      expect(Number.isFinite(index.addDuration(farPast, 480).getTime())).toBe(true)
      expect(Number.isFinite(index.fromWorkMinutes(50_000_000).getTime())).toBe(true)
      expect(Number.isFinite(index.fromWorkMinutes(-50_000_000).getTime())).toBe(true)
      expect(typeof index.isWorkingInstant(farFuture)).toBe('boolean')
      expect(() => index.snapToNextWorkingInstant(farPast)).not.toThrow()
      expect(() => index.workingMinutesBetween(farPast, farFuture)).not.toThrow()
    }
  })

  it('grows the index on demand just past the padded window', () => {
    const justPastPad = at('2027-06-01T08:00:00.000Z')
    const snapped = london.snapToNextWorkingInstant(justPastPad)
    expect(localOf(london, snapped).time).toBe('09:00')
    expect(london.isWorkingInstant(snapped)).toBe(true)
    expect(snapped.getTime()).toBeGreaterThanOrEqual(justPastPad.getTime())
  })

  it('absorbs invalid and degenerate inputs without throwing', () => {
    const invalid = new Date('not a date')
    expect(london.toWorkMinutes(invalid)).toBe(0)
    expect(Number.isFinite(london.fromWorkMinutes(Number.NaN).getTime())).toBe(true)
    expect(Number.isFinite(london.addDuration(invalid, 60).getTime())).toBe(true)
    expect(
      Number.isFinite(london.addDuration(at('2026-09-07T08:00:00.000Z'), Number.NaN).getTime()),
    ).toBe(true)
    expect(london.workingMinutesBetween(invalid, invalid)).toBe(0)
    expect(london.isWorkingInstant(invalid)).toBe(false)
    expect(Number.isFinite(london.snapToNextWorkingInstant(invalid).getTime())).toBe(true)
  })

  it('survives a degenerate calendar without throwing', () => {
    const degenerate = buildCalendarIndex(
      { id: '', timezone: 'Not/AZone', hoursPerDay: 0, workweek: 0, exceptions: [] },
      { start: new Date('2026-09-07T00:00:00.000Z'), end: new Date('2026-09-01T00:00:00.000Z') },
    )
    expect(degenerate.timezone).toBe('Not/AZone')
    expect(() => degenerate.toWorkMinutes(at('2026-09-07T08:00:00.000Z'))).not.toThrow()
    expect(degenerate.isWorkingInstant(at('2026-09-07T08:00:00.000Z'))).toBe(false)
    expect(() => degenerate.addDuration(at('2026-09-07T08:00:00.000Z'), 480)).not.toThrow()
  })

  it('handles a zone whose DST transition removes local midnight', () => {
    const santiago = buildCalendarIndex(
      {
        ...LONDON_MON_FRI,
        id: 'cal-scl',
        timezone: 'America/Santiago',
        workweek: WORKWEEK_MON_FRI,
      },
      { start: new Date('2026-09-01T00:00:00.000Z'), end: new Date('2026-09-30T00:00:00.000Z') },
    )
    const monday = santiago.snapToNextWorkingInstant(at('2026-09-07T00:00:00.000Z'))
    expect(localParts('America/Santiago', monday)).toEqual({ day: '2026-09-07', time: '09:00' })
    expect(santiago.isWorkingInstant(monday)).toBe(true)
    expect(
      santiago.workingMinutesBetween(monday, santiago.addDuration(monday, MINUTES_PER_WORK_DAY)),
    ).toBe(MINUTES_PER_WORK_DAY)
  })
})
