// London-time helpers for the daily message (re-exported by daily-message-prompt). Pure.

const LONDON_TZ = 'Europe/London'
const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})

interface LondonParts { date: string; hour: number; minute: number; weekday: string }

function londonParts(now: Date): LondonParts {
  const parts: Record<string, string> = {}
  for (const p of londonFormat.formatToParts(now)) parts[p.type] = p.value
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday,
  }
}

export function londonDate(now: Date): string {
  return londonParts(now).date
}

export function isLondonHour(now: Date, hour: number): boolean {
  return londonParts(now).hour === hour
}

export function isLondonMonday(now: Date): boolean {
  return londonParts(now).weekday === 'Mon'
}

export function isLondonSunday(now: Date): boolean {
  return londonParts(now).weekday === 'Sun'
}

export const DAILY_MESSAGE_HOUR = 6

// The instant London reads `hour`:00 on `date` (London is UTC+0 or UTC+1, and
// clocks change at 01:00Z, so one of the two candidates always matches).
export function londonInstant(date: string, hour: number = DAILY_MESSAGE_HOUR): Date {
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(`${date}T00:00:00.000Z`)
    candidate.setUTCHours(hour - offsetHours, 0, 0, 0)
    const p = londonParts(candidate)
    if (p.date === date && p.hour === hour && p.minute === 0) return candidate
  }
  throw new Error(`londonInstant: no ${hour}:00 London on ${date}`)
}

// The previous calendar date (board-day pages are dated by the 23:00Z
// project-snapshot run, i.e. the day before the morning they are read).
export function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
