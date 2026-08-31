/**
 * Chronos calendar index (lane C). Flattens a `WorkCalendar` across the solve window
 * exactly once into a prefix table of working minutes; every query afterwards is a
 * binary search, never calendar arithmetic in a loop.
 *
 * Three rules this file exists to enforce:
 *   1. Every boundary — midnight, weekday, holiday match — is resolved in the
 *      calendar's own IANA zone via `Intl`, never the server's zone (Vercel is UTC)
 *      and never the browser's.
 *   2. Durations preserve working length, not wall-clock length, across a DST shift:
 *      a day is `workingMinutes` of real elapsed time from its local work-day start.
 *   3. When the working day opens is DATA (`WorkCalendar.dayStartMinute`, overridable
 *      per day by `CalendarException.startMinute`), never a constant in this module.
 *
 * Intervals are half-open, `[start, end)`. `addDuration` returns the instant a
 * successor may begin — after a full day that is the next morning's open. The right
 * edge a view should draw is `toDisplayEnd` of that instant.
 *
 * No clock is read here (CHR-3) — `Date` only ever appears with an explicit argument.
 */
import { DEFAULT_DAY_START_MINUTE, type CalendarIndex, type SolveWindow, type WorkCalendar } from './types'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const MINUTES_PER_DAY = 1_440
/** Bits 0–6 of a workweek mask; anything above them names no weekday. */
const WEEKDAY_MASK = 0b111_1111
/** Largest instant a `Date` can hold; past it `new Date` is Invalid. */
const MAX_TIME_MS = 8_640_000_000_000_000
/**
 * Padding either side of the window. Small on purpose: this is eager work paid on a
 * request path before a single task is placed, and a year either side made a one-week
 * solve materialise 733 days. A month absorbs the ordinary overrun — a slipped task,
 * a lag, a `snet` just outside the window — and anything further is built on demand by
 * `extendForward` / `extendBackward`, which cost the same per day and are already the
 * documented path for an instant outside the window.
 */
const PAD_DAYS_BEFORE = 30
const PAD_DAYS_AFTER = 30
/**
 * Growth is deliberately much coarser than the padding: an extension is amortised
 * across every later query, and this size keeps `MAX_INDEX_DAYS` reachable inside the
 * 64-iteration guards in `ensureCovers*`, which is what preserves the out-of-window
 * clamp horizon unchanged.
 */
const GROWTH_CHUNK_DAYS = 366
/** Hard ceiling on index size; past it queries clamp to the edge instead of growing. */
const MAX_INDEX_DAYS = 40 * 366
/**
 * Cap on the process-wide formatter cache. Keys are IANA zones — one per distinct
 * calendar zone in a solve, so a realistic team never approaches this — but the map
 * outlives every request, so it needs a bound. Eviction is insertion-order rather
 * than true LRU: reordering on read would put a `delete`/`set` in `zonedParts`, the
 * hottest path in this module, to protect against a case that should never fire.
 */
const MAX_CACHED_FORMATTERS = 32

interface CivilDate {
  year: number
  month: number
  day: number
}

interface ZonedParts extends CivilDate {
  hour: number
  minute: number
  second: number
}

interface DayEntry {
  /** ISO `YYYY-MM-DD` in the calendar's zone. */
  day: string
  weekday: number
  workingMinutes: number
  /** Epoch ms of local midnight — the binary-search key. */
  dayStartUtc: number
  workStartUtc: number
  workEndUtc: number
  /** Working minutes elapsed before this day. */
  cumulative: number
}

/** A day whose shape an exception overrides — both how long it is and when it opens. */
interface DayOverride {
  workingMinutes: number
  startMinute: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

/**
 * The zone every boundary in this index is resolved in: the calendar's own zone when
 * the runtime accepts it, else UTC.
 *
 * Resolved once per index, before anything is cached, for two reasons. `timezone` is
 * `text` with no IANA validation on any of the three write surfaces, so an unknown
 * zone reaches this module; caching a UTC formatter under that unknown key both grew
 * the cache by one entry per junk string and made the cache key a lie. And the index
 * publishes `timezone` to renderers, which pass it straight back to `Intl` — handing
 * out a zone that makes every consumer throw is not a totality guarantee.
 */
function resolveTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return 'UTC'
  if (formatterCache.has(timeZone)) return timeZone
  try {
    cacheFormatter(timeZone, makeFormatter(timeZone))
    return timeZone
  } catch {
    return 'UTC'
  }
}

function cacheFormatter(timeZone: string, formatter: Intl.DateTimeFormat): Intl.DateTimeFormat {
  if (formatterCache.size >= MAX_CACHED_FORMATTERS && !formatterCache.has(timeZone)) {
    const oldest = formatterCache.keys().next()
    if (!oldest.done) formatterCache.delete(oldest.value)
  }
  formatterCache.set(timeZone, formatter)
  return formatter
}

/** Only ever called with a zone `resolveTimeZone` has accepted; the catch is belt and braces. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  try {
    return cacheFormatter(timeZone, makeFormatter(timeZone))
  } catch {
    return cacheFormatter('UTC', makeFormatter('UTC'))
  }
}

function zonedParts(timeZone: string, instant: number): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant))
  const read = (type: string) => {
    const found = parts.find((part) => part.type === type)
    return found ? Number(found.value) : 0
  }
  const hour = read('hour')
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  }
}

function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = zonedParts(timeZone, instant)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

function parseDayKey(key: string): CivilDate {
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    day: Number(key.slice(8, 10)),
  }
}

/**
 * Local wall clock to epoch ms. A wall time that does not exist (spring-forward gap)
 * shifts forward past the gap; an ambiguous one (fall-back) takes the earlier offset.
 */
function zonedTimeToUtc(timeZone: string, date: CivilDate, hour: number, minute: number): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0)
  const first = asUtc - zoneOffsetMs(timeZone, asUtc)
  const second = asUtc - zoneOffsetMs(timeZone, first)
  if (first === second) return first
  const firstParts = zonedParts(timeZone, first)
  if (firstParts.day === date.day && firstParts.hour === hour && firstParts.minute === minute) {
    return first
  }
  const secondParts = zonedParts(timeZone, second)
  if (secondParts.day === date.day && secondParts.hour === hour && secondParts.minute === minute) {
    return second
  }
  return Math.max(first, second)
}

function civilFromInstant(timeZone: string, instant: number): CivilDate {
  const parts = zonedParts(timeZone, instant)
  return { year: parts.year, month: parts.month, day: parts.day }
}

function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function civilWeekday(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

function civilKey(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function toEpochMs(value: Date | null | undefined, fallback: number): number {
  const ms = value instanceof Date ? value.getTime() : Number(value)
  return Number.isFinite(ms) ? ms : fallback
}

function clampDayMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.min(minutes, MINUTES_PER_DAY)
}

/** A day-open offset must land inside its own local day; anything else is not a time. */
function clampStartMinute(minutes: unknown, fallback: number): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return fallback
  return Math.min(Math.max(Math.floor(minutes), 0), MINUTES_PER_DAY - 1)
}

function clampInstantMs(ms: number, fallback: number): number {
  if (!Number.isFinite(ms)) return fallback
  return Math.min(Math.max(ms, -MAX_TIME_MS), MAX_TIME_MS)
}

/**
 * The axis a calendar that can never produce a single working minute degrades to:
 * continuous real time, epoch-anchored, identical to the fallback the solver already
 * uses when a calendar is missing entirely.
 *
 * A prefix index of nothing but zeroes has no working-time axis to search — every
 * day's span is empty, so "the first day containing minute N" is unanswerable and the
 * search runs off the end of the index, which is how a calendar with hoursPerDay 0
 * placed a September 2026 project in 2065. Continuous time is the fallback that keeps
 * the plan readable: durations stay real, order and dependencies survive, and the
 * dates land next to `now` where a human can see that work is being scheduled through
 * nights and weekends and go fix the calendar. Clamping to a single instant instead
 * would collapse every bar to zero length at one point, destroy the ordering, and
 * make `addDuration` a constant — which the solver's forward progress depends on not
 * being. `hoursPerDay` reports 24 because that is the axis actually in use.
 */
function continuousCalendarIndex(
  calendarId: string,
  timezone: string,
  dayStartMinute: number,
  anchor: number,
): CalendarIndex {
  const instantAt = (ms: number) => new Date(clampInstantMs(ms, anchor))
  return {
    calendarId,
    timezone,
    hoursPerDay: 24,
    dayStartMinute,
    toWorkMinutes(instant: Date): number {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return 0
      return ms / MS_PER_MINUTE
    },
    fromWorkMinutes(workMinutes: number): Date {
      if (!Number.isFinite(workMinutes)) return new Date(anchor)
      return instantAt(workMinutes * MS_PER_MINUTE)
    },
    addDuration(start: Date, minutes: number): Date {
      const ms = toEpochMs(start, NaN)
      if (!Number.isFinite(ms)) return new Date(anchor)
      return instantAt(ms + (Number.isFinite(minutes) ? minutes : 0) * MS_PER_MINUTE)
    },
    workingMinutesBetween(a: Date, b: Date): number {
      const aMs = toEpochMs(a, NaN)
      const bMs = toEpochMs(b, NaN)
      if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return 0
      return (bMs - aMs) / MS_PER_MINUTE
    },
    snapToNextWorkingInstant(instant: Date): Date {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return new Date(anchor)
      return instantAt(ms)
    },
    isWorkingInstant(instant: Date): boolean {
      return Number.isFinite(toEpochMs(instant, NaN))
    },
    toDisplayEnd(instant: Date): Date {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return new Date(anchor)
      return instantAt(ms)
    },
  }
}

/**
 * Builds the working-time prefix index for one calendar over one solve window.
 * The window is padded a year either side; an instant beyond the padding grows the
 * index on demand in chunks up to `MAX_INDEX_DAYS`, past which every method clamps
 * to the nearest edge rather than throwing. No method throws for any input.
 *
 * A calendar with no working time at all degrades to `continuousCalendarIndex`
 * instead — there is no working-time axis to index.
 */
export function buildCalendarIndex(calendar: WorkCalendar, window: SolveWindow): CalendarIndex {
  const calendarId = typeof calendar?.id === 'string' ? calendar.id : ''
  const timezone = resolveTimeZone(calendar?.timezone)
  const hoursPerDay =
    Number.isFinite(calendar?.hoursPerDay) && calendar.hoursPerDay > 0 ? calendar.hoursPerDay : 0
  const defaultMinutes = clampDayMinutes(hoursPerDay * 60)
  const workweek = Number.isInteger(calendar?.workweek) ? calendar.workweek : 0
  const dayStartMinute = clampStartMinute(calendar?.dayStartMinute, DEFAULT_DAY_START_MINUTE)

  const exceptions = new Map<string, DayOverride>()
  for (const exception of calendar?.exceptions ?? []) {
    if (!exception || typeof exception.day !== 'string') continue
    if (!exception.isWorking) {
      exceptions.set(exception.day, { workingMinutes: 0, startMinute: dayStartMinute })
      continue
    }
    const hours = exception.hours
    exceptions.set(exception.day, {
      workingMinutes:
        hours === null || hours === undefined || !Number.isFinite(hours)
          ? defaultMinutes
          : clampDayMinutes(hours * 60),
      startMinute: clampStartMinute(exception.startMinute, dayStartMinute),
    })
  }

  const rawStart = toEpochMs(window?.start, 0)
  const rawEnd = toEpochMs(window?.end, rawStart)
  const windowStart = Math.min(rawStart, rawEnd)
  const windowEnd = Math.max(rawStart, rawEnd)

  /**
   * Genuinely empty, not merely sparse: this asks the calendar DEFINITION whether any
   * day anywhere can carry working time, so a calendar that only works one week of the
   * window, or only on days its exceptions open, still takes the indexed path.
   */
  const weeklyWorkingDays = defaultMinutes > 0 ? workweek & WEEKDAY_MASK : 0
  let hasWorkingException = false
  for (const override of exceptions.values()) {
    if (override.workingMinutes > 0) {
      hasWorkingException = true
      break
    }
  }
  if (weeklyWorkingDays === 0 && !hasWorkingException) {
    return continuousCalendarIndex(calendarId, timezone, dayStartMinute, windowStart)
  }

  const firstCivil = addCivilDays(civilFromInstant(timezone, windowStart), -PAD_DAYS_BEFORE)
  const lastCivil = addCivilDays(civilFromInstant(timezone, windowEnd), PAD_DAYS_AFTER)
  const spanDays =
    Math.round(
      (Date.UTC(lastCivil.year, lastCivil.month - 1, lastCivil.day) -
        Date.UTC(firstCivil.year, firstCivil.month - 1, firstCivil.day)) /
        MS_PER_DAY,
    ) + 1

  function makeEntry(date: CivilDate, cumulative: number): DayEntry {
    const key = civilKey(date)
    const weekday = civilWeekday(date)
    const override = exceptions.get(key)
    const workingMinutes =
      override !== undefined
        ? override.workingMinutes
        : ((workweek >> weekday) & 1) === 1
          ? defaultMinutes
          : 0
    const startMinute = override !== undefined ? override.startMinute : dayStartMinute
    const workStartUtc = zonedTimeToUtc(
      timezone,
      date,
      Math.floor(startMinute / 60),
      startMinute % 60,
    )
    return {
      day: key,
      weekday,
      workingMinutes,
      dayStartUtc: zonedTimeToUtc(timezone, date, 0, 0),
      workStartUtc,
      workEndUtc: workStartUtc + workingMinutes * MS_PER_MINUTE,
      cumulative,
    }
  }

  const days: DayEntry[] = []
  let cursor = firstCivil
  let running = 0
  const initialDays = Math.max(1, Math.min(spanDays, MAX_INDEX_DAYS))
  for (let i = 0; i < initialDays; i += 1) {
    const entry = makeEntry(cursor, running)
    days.push(entry)
    running += entry.workingMinutes
    cursor = addCivilDays(cursor, 1)
  }

  function extendForward(): boolean {
    if (days.length >= MAX_INDEX_DAYS) return false
    const chunk = Math.min(GROWTH_CHUNK_DAYS, MAX_INDEX_DAYS - days.length)
    const last = days[days.length - 1]
    let date = addCivilDays(parseDayKey(last.day), 1)
    let total = last.cumulative + last.workingMinutes
    for (let i = 0; i < chunk; i += 1) {
      const entry = makeEntry(date, total)
      days.push(entry)
      total += entry.workingMinutes
      date = addCivilDays(date, 1)
    }
    return true
  }

  function extendBackward(): boolean {
    if (days.length >= MAX_INDEX_DAYS) return false
    const chunk = Math.min(GROWTH_CHUNK_DAYS, MAX_INDEX_DAYS - days.length)
    const prepended: DayEntry[] = []
    let date = addCivilDays(parseDayKey(days[0].day), -1)
    let cumulativeAfter = days[0].cumulative
    for (let i = 0; i < chunk; i += 1) {
      const entry = makeEntry(date, 0)
      entry.cumulative = cumulativeAfter - entry.workingMinutes
      entry.workEndUtc = entry.workStartUtc + entry.workingMinutes * MS_PER_MINUTE
      cumulativeAfter = entry.cumulative
      prepended.unshift(entry)
      date = addCivilDays(date, -1)
    }
    days.unshift(...prepended)
    return true
  }

  function ensureCoversInstant(ms: number): void {
    let guard = 0
    while (ms >= days[days.length - 1].dayStartUtc + MS_PER_DAY && guard < 64) {
      if (!extendForward()) break
      guard += 1
    }
    guard = 0
    while (ms < days[0].dayStartUtc && guard < 64) {
      if (!extendBackward()) break
      guard += 1
    }
  }

  function ensureCoversWorkMinutes(workMinutes: number): void {
    let guard = 0
    while (guard < 64) {
      const last = days[days.length - 1]
      if (workMinutes < last.cumulative + last.workingMinutes) break
      if (!extendForward()) break
      guard += 1
    }
    guard = 0
    while (workMinutes < days[0].cumulative && guard < 64) {
      if (!extendBackward()) break
      guard += 1
    }
  }

  /** Index of the last day whose local midnight is at or before `ms`. */
  function dayIndexForInstant(ms: number): number {
    if (ms < days[0].dayStartUtc) return 0
    let lo = 0
    let hi = days.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (days[mid].dayStartUtc <= ms) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Index of the first day whose working span contains `workMinutes`. */
  function dayIndexForWorkMinutes(workMinutes: number): number {
    let lo = 0
    let hi = days.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const entry = days[mid]
      if (entry.cumulative + entry.workingMinutes > workMinutes) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  /** The day owning `ms`, accounting for a work window that spills past local midnight. */
  function entryForInstant(ms: number): DayEntry {
    ensureCoversInstant(ms)
    let index = dayIndexForInstant(ms)
    if (index > 0 && ms < days[index - 1].workEndUtc) index -= 1
    return days[index]
  }

  function positionOf(ms: number): number {
    const entry = entryForInstant(ms)
    if (ms <= entry.workStartUtc) return entry.cumulative
    if (ms >= entry.workEndUtc) return entry.cumulative + entry.workingMinutes
    return entry.cumulative + (ms - entry.workStartUtc) / MS_PER_MINUTE
  }

  function instantOf(workMinutes: number): number {
    ensureCoversWorkMinutes(workMinutes)
    const entry = days[dayIndexForWorkMinutes(workMinutes)]
    const offset = Math.min(Math.max(workMinutes - entry.cumulative, 0), entry.workingMinutes)
    return entry.workStartUtc + offset * MS_PER_MINUTE
  }

  function isWorking(ms: number): boolean {
    const entry = entryForInstant(ms)
    return entry.workingMinutes > 0 && ms >= entry.workStartUtc && ms < entry.workEndUtc
  }

  /**
   * The last working instant at or before `ms`. Mid-span this is `ms` itself; on a
   * day's open it is the previous day's close, which is what turns `addDuration`'s
   * chaining end back into a right edge a bar can be drawn to.
   */
  function displayEndOf(ms: number): number {
    ensureCoversInstant(ms)
    let index = dayIndexForInstant(ms)
    if (index > 0 && ms < days[index - 1].workEndUtc) index -= 1
    const entry = days[index]
    if (entry.workingMinutes > 0 && ms > entry.workStartUtc && ms <= entry.workEndUtc) return ms
    for (let i = index; i >= 0; i -= 1) {
      const day = days[i]
      if (day.workingMinutes > 0 && day.workEndUtc <= ms) return day.workEndUtc
    }
    return ms
  }

  const fallbackInstant = () => days[0].workStartUtc

  return {
    calendarId,
    timezone,
    hoursPerDay,
    dayStartMinute,
    toWorkMinutes(instant: Date): number {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return 0
      return positionOf(ms)
    },
    fromWorkMinutes(workMinutes: number): Date {
      if (!Number.isFinite(workMinutes)) return new Date(fallbackInstant())
      return new Date(instantOf(workMinutes))
    },
    addDuration(start: Date, minutes: number): Date {
      const ms = toEpochMs(start, NaN)
      if (!Number.isFinite(ms)) return new Date(fallbackInstant())
      return new Date(instantOf(positionOf(ms) + (Number.isFinite(minutes) ? minutes : 0)))
    },
    workingMinutesBetween(a: Date, b: Date): number {
      const aMs = toEpochMs(a, NaN)
      const bMs = toEpochMs(b, NaN)
      if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return 0
      return positionOf(bMs) - positionOf(aMs)
    },
    snapToNextWorkingInstant(instant: Date): Date {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return new Date(fallbackInstant())
      if (isWorking(ms)) return new Date(ms)
      return new Date(instantOf(positionOf(ms)))
    },
    isWorkingInstant(instant: Date): boolean {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return false
      return isWorking(ms)
    },
    toDisplayEnd(instant: Date): Date {
      const ms = toEpochMs(instant, NaN)
      if (!Number.isFinite(ms)) return new Date(fallbackInstant())
      return new Date(displayEndOf(ms))
    },
  }
}
