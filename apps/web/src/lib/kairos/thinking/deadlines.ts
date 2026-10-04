// Night schedule for the thinking queue (UTC). A routine job must expire
// shortly BEFORE the cron that is its fallback, so the cron's alreadyRanToday
// guard either sees the routine's row (skip) or runs on the paid key as before.
//   02:30 archetype-synthesis cron (prerequisite for cortex)
//   02:58 cortex job deadline   → 03:00 cortex-regen cron
//   03:13 aether job deadline   → 03:15 aether-regen cron
export const CORTEX_DEADLINE_UTC = { hour: 2, minute: 58 }
export const AETHER_DEADLINE_UTC = { hour: 3, minute: 13 }

// All-on-Max kinds (docs/kairos/33 §Kinds). Each window opens at `notBefore`
// and closes two minutes before the cron that falls back for it:
//   01:00–01:58 chat_distill   → 02:00 chat-distill cron
//   01:36–02:28 archetype      → 02:30 archetype-synthesis (after the 01:30
//                                memory engine and tonight's chat distill)
//   03:15–04:28 ask_mine       → 04:30 ask-mine (once aether is settled)
//   03:15–04:28 goal_propose   → no fallback (a missed night proposes no goal)
//   04:00–05:56 constitution_seed, Mondays only → 05:58 Monday constitution-seed
//                                cron (the brain routine runs at 04:40 and 05:40)
// The daily message opens at 04:00 UTC (handlers/daily-message.ts) and closes at
// 05:55 London, before the 06:00 London daily-message cron.
export interface UtcWindow {
  notBefore: { hour: number; minute: number }
  deadline: { hour: number; minute: number }
}

export const CHAT_DISTILL_WINDOW_UTC: UtcWindow = { notBefore: { hour: 1, minute: 0 }, deadline: { hour: 1, minute: 58 } }
export const ARCHETYPE_WINDOW_UTC: UtcWindow = { notBefore: { hour: 1, minute: 36 }, deadline: { hour: 2, minute: 28 } }
export const ASK_MINE_WINDOW_UTC: UtcWindow = { notBefore: { hour: 3, minute: 15 }, deadline: { hour: 4, minute: 28 } }
// Phase 2 goal_propose: same window as ask_mine; it has no fallback cron.
export const GOAL_PROPOSE_WINDOW_UTC: UtcWindow = { notBefore: { hour: 3, minute: 15 }, deadline: { hour: 4, minute: 28 } }
export const DREAM_WINDOW_UTC: UtcWindow = { notBefore: { hour: 1, minute: 38 }, deadline: { hour: 3, minute: 28 } }
export const DREAM_READ_WINDOW_UTC: UtcWindow = { notBefore: { hour: 1, minute: 38 }, deadline: { hour: 4, minute: 28 } }
export const CONSTITUTION_SEED_WINDOW_UTC: UtcWindow = { notBefore: { hour: 4, minute: 0 }, deadline: { hour: 5, minute: 56 } }

// The constitution seed runs on Monday (UTC).
export function isConstitutionSeedDay(now: Date): boolean {
  return now.getUTCDay() === 1
}

// Minutes left in today's window at `now`; <= 0 → closed or not yet open.
export function minutesLeftInWindow(now: Date, w: UtcWindow): number {
  if (now.getTime() < deadlineOn(now, w.notBefore).getTime()) return 0
  return minutesUntil(now, deadlineOn(now, w.deadline))
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function utcDayStart(now: Date): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`)
}

export function deadlineOn(now: Date, at: { hour: number; minute: number }): Date {
  const d = utcDayStart(now)
  d.setUTCHours(at.hour, at.minute, 0, 0)
  return d
}

// Minutes from `now` to `deadline` (fractional, so upsertJob lands on the
// exact instant); <= 0 means the window has closed and nothing is planned.
export function minutesUntil(now: Date, deadline: Date): number {
  return (deadline.getTime() - now.getTime()) / 60_000
}

// Concept tier runs weekly, on Sunday (UTC).
export function isConceptDay(now: Date): boolean {
  return now.getUTCDay() === 0
}

// ── Life chapters (wave 4, KAIROS_LIFE_CHAPTERS) ─────────────────────────
// One chapter per previous calendar month (UTC), planned on UTC days 1–3 from
// 12:00Z (after a Monday-the-1st weekly review), key life_chapter:<YYYY-MM>,
// 36-hour deadline. No fallback: a missed month is skipped.
export const LIFE_CHAPTER_NOT_BEFORE_UTC = { hour: 12, minute: 0 }
export const LIFE_CHAPTER_DEADLINE_MINUTES = 36 * 60
export const LIFE_CHAPTER_DUE_DAYS = 3

export function isLifeChapterDue(now: Date): boolean {
  return now.getUTCDate() <= LIFE_CHAPTER_DUE_DAYS && now.getTime() >= deadlineOn(now, LIFE_CHAPTER_NOT_BEFORE_UTC).getTime()
}

// UTC month key, e.g. 2026-10.
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// The previous UTC calendar month: [start, end) with its key.
export function previousMonthWindow(now: Date): { month: string; start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { month: monthKey(start), start, end }
}

// ISO-8601 week key, e.g. 2026-W40 (Thursday rule: the week belongs to the
// year its Thursday falls in).
export function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// LIKE pattern matching every concept job key of one ISO week, any Dominion
// (keys are `concept:<dominionId>:<weekKey>:<memberSetHash>`).
export function conceptWeekKeyPattern(weekKey: string): string {
  return `concept:%:${weekKey}:%`
}

// ── Daytime cadence (KAIROS_DAYTIME_THINKING=1) ──────────────────────────
// Daytime windows are London hours (inclusive), so a clock change moves the
// UTC run times, not Kairos's day. One slot per London hour per kind:
//   pulse   07:00–22:59 London, key pulse:<date>:<HH>,   45-minute deadline
//   reflect 08:00–21:59 London, key reflect:<date>:<HH>, 50-minute deadline
export interface LondonHours { fromHour: number; toHour: number }

export const DAYTIME_LONDON: LondonHours = { fromHour: 7, toHour: 22 }
export const PULSE_WINDOW_LONDON: LondonHours = DAYTIME_LONDON
export const REFLECT_WINDOW_LONDON: LondonHours = { fromHour: 8, toHour: 21 }
export const PULSE_DEADLINE_MINUTES = 45
export const REFLECT_DEADLINE_MINUTES = 50

const londonClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function londonDateHour(now: Date): { date: string; hour: number; minute: number } {
  const p: Record<string, string> = {}
  for (const part of londonClock.formatToParts(now)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) }
}

// "HH:MM" London wall-clock time.
export function londonClockLabel(now: Date): string {
  const { hour, minute } = londonDateHour(now)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function inLondonHours(now: Date, w: LondonHours): boolean {
  const { hour } = londonDateHour(now)
  return hour >= w.fromHour && hour <= w.toHour
}

// `<kind>:<London date>:<HH>` — one job per kind per London hour.
export function daytimeSlotKey(kind: string, now: Date): string {
  const { date, hour } = londonDateHour(now)
  return `${kind}:${date}:${String(hour).padStart(2, '0')}`
}

// Prefix shared by every slot of one London day (count a day's jobs).
export function daytimeDayPrefix(kind: string, now: Date): string {
  return `${kind}:${londonDateHour(now).date}:`
}

// The instant the current London day began (00:00 London).
export function londonDayStart(now: Date): Date {
  const { date } = londonDateHour(now)
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(`${date}T00:00:00.000Z`)
    candidate.setUTCHours(-offsetHours)
    const p = londonDateHour(candidate)
    if (p.date === date && p.hour === 0) return candidate
  }
  return new Date(`${date}T00:00:00.000Z`)
}
