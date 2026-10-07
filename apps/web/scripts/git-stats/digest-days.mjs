import { shiftDay } from './repo.mjs'

export const DATE = /^\d{4}-\d{2}-\d{2}$/
export const DEFAULT_CATCH_UP = 7

const formatters = new Map()

function formatter(timeZone) {
  const key = timeZone || ''
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }))
  }
  return formatters.get(key)
}

/** Calendar day (YYYY-MM-DD) of an instant in the given IANA zone; machine-local when omitted. */
export function localDayOf(value, timeZone = null) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function dayRange(first, last) {
  const days = []
  for (let d = first; d <= last; d = shiftDay(d, 1)) days.push(d)
  return days
}

/**
 * Days to digest, oldest first. Never today or later. An explicit --day is taken
 * as-is; otherwise every not-yet-complete day in the catch-up window, floored at
 * the first day ever receipted unless the caller asked for --catch-up explicitly.
 * With no receipts at all only yesterday is taken.
 */
export function planDays({ today, receipts, day = null, catchUp = DEFAULT_CATCH_UP, explicitCatchUp = false }) {
  if (day) {
    if (!DATE.test(day)) throw new Error(`--day must be YYYY-MM-DD, got ${day}`)
    if (day >= today) throw new Error(`--day ${day} is not a completed local day (today is ${today})`)
    return [day]
  }
  const yesterday = shiftDay(today, -1)
  const span = Math.max(1, catchUp)
  const known = Object.keys(receipts?.days || {}).filter((d) => DATE.test(d)).sort()
  let first = shiftDay(yesterday, -(span - 1))
  if (!explicitCatchUp) {
    if (!known.length) first = yesterday
    else if (known[0] > first) first = known[0]
  }
  return dayRange(first, yesterday).filter((d) => !receipts?.days?.[d]?.complete)
}
