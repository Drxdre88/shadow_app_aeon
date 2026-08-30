/**
 * Chronos calendar index (lane C). Flattens a `WorkCalendar` across the solve window
 * exactly once into a prefix table of working minutes; every query afterwards is a
 * binary search, never calendar arithmetic in a loop.
 *
 * Two rules this file exists to enforce:
 *   1. Every boundary — midnight, weekday, holiday match — is resolved in the
 *      calendar's own IANA zone via `Intl`, never the server's zone (Vercel is UTC)
 *      and never the browser's.
 *   2. Durations preserve working length, not wall-clock length, across a DST shift:
 *      a day is `workingMinutes` of real elapsed time from its local work-day start.
 *
 * No clock is read here (CHR-3) — `Date` only ever appears with an explicit argument.
 */
import type { CalendarIndex, SolveWindow, WorkCalendar } from './types'

/** The calendar model carries no start-of-day field; a working day opens here, local. */
export const DEFAULT_WORK_DAY_START_HOUR = 9

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const MINUTES_PER_DAY = 1_440
const PAD_DAYS_BEFORE = 366
const PAD_DAYS_AFTER = 366
const GROWTH_CHUNK_DAYS = 366
/** Hard ceiling on index size; past it queries clamp to the edge instead of growing. */
const MAX_INDEX_DAYS = 40 * 366

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

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = makeFormatter(timeZone)
  } catch {
    formatter = makeFormatter('UTC')
  }
  formatterCache.set(timeZone, formatter)
  return formatter
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

/**
 * Builds the working-time prefix index for one calendar over one solve window.
 * The window is padded a year either side; an instant beyond the padding grows the
 * index on demand in chunks up to `MAX_INDEX_DAYS`, past which every method clamps
 * to the nearest edge rather than throwing. No method throws for any input.
 */
export function buildCalendarIndex(calendar: WorkCalendar, window: SolveWindow): CalendarIndex {
  const timezone =
    typeof calendar?.timezone === 'string' && calendar.timezone.length > 0 ? calendar.timezone : 'UTC'
  const hoursPerDay =
    Number.isFinite(calendar?.hoursPerDay) && calendar.hoursPerDay > 0 ? calendar.hoursPerDay : 0
  const defaultMinutes = clampDayMinutes(hoursPerDay * 60)
  const workweek = Number.isInteger(calendar?.workweek) ? calendar.workweek : 0

  const exceptions = new Map<string, number>()
  for (const exception of calendar?.exceptions ?? []) {
    if (!exception || typeof exception.day !== 'string') continue
    if (!exception.isWorking) {
      exceptions.set(exception.day, 0)
      continue
    }
    const hours = exception.hours
    exceptions.set(
      exception.day,
      hours === null || hours === undefined || !Number.isFinite(hours)
        ? defaultMinutes
        : clampDayMinutes(hours * 60),
    )
  }

  const rawStart = toEpochMs(window?.start, 0)
  const rawEnd = toEpochMs(window?.end, rawStart)
  const windowStart = Math.min(rawStart, rawEnd)
  const windowEnd = Math.max(rawStart, rawEnd)

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
      override !== undefined ? override : ((workweek >> weekday) & 1) === 1 ? defaultMinutes : 0
    const workStartUtc = zonedTimeToUtc(timezone, date, DEFAULT_WORK_DAY_START_HOUR, 0)
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

  const fallbackInstant = () => days[0].workStartUtc

  return {
    calendarId: typeof calendar?.id === 'string' ? calendar.id : '',
    timezone,
    hoursPerDay,
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
  }
}
