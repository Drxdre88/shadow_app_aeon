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
