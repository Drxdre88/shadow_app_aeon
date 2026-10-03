import { noveltyEvery, noveltyMode, type SteppingMode } from './flag'

// One UTC night in every N, fixed by the date alone (epoch day mod N), so plan and judge agree.

const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function utcDayIndex(date: Date | string): number | null {
  if (typeof date === 'string') {
    const m = DAY_RE.exec(date)
    if (!m) return null
    return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS)
  }
  const t = date.getTime()
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null
}

export function isNoveltyNight(date: Date | string, every: number = noveltyEvery()): boolean {
  const day = utcDayIndex(date)
  return day !== null && every >= 1 && day % every === 0
}

// First novelty night on or after `date` (YYYY-MM-DD); null for a bad date.
export function nextNoveltyNight(date: Date | string, every: number = noveltyEvery()): string | null {
  const day = utcDayIndex(date)
  if (day === null || every < 1) return null
  const next = day + ((every - (day % every)) % every)
  return new Date(next * DAY_MS).toISOString().slice(0, 10)
}

// The flag's mode on a novelty night, else 'off'.
export function noveltyTonight(date: Date | string): SteppingMode {
  const mode = noveltyMode()
  return mode !== 'off' && isNoveltyNight(date) ? mode : 'off'
}
