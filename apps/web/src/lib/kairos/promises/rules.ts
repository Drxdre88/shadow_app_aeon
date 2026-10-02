import { londonDate } from '@/lib/kairos/daily-message-prompt'
import {
  MAX_CLOSED_PROMISES,
  type KairosPromise,
  type KairosPromisesState,
  type PromiseClosedBy,
} from '@/lib/data/validators/kairos-promises'

// Pure promise rules (no DB): London-date arithmetic, the vague-outcome
// guard, and the state transitions the data layer's locked mutation applies.

const DAY_MS = 24 * 60 * 60 * 1000
export const PROMISE_MIN_DUE_DAYS = 1
export const PROMISE_MAX_DUE_DAYS = 28
export const PROMISE_LAPSE_DAYS = 14

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / DAY_MS)
}

export function daysLate(p: Pick<KairosPromise, 'dueDate'>, now: Date): number {
  return daysBetween(p.dueDate, londonDate(now))
}

export function dueWindow(now: Date): { earliest: string; latest: string } {
  const today = londonDate(now)
  return { earliest: addDays(today, PROMISE_MIN_DUE_DAYS), latest: addDays(today, PROMISE_MAX_DUE_DAYS) }
}

export function isDueInWindow(dueDate: string, now: Date): boolean {
  const { earliest, latest } = dueWindow(now)
  return dueDate >= earliest && dueDate <= latest
}

// "look into / explore / think about" name an activity, not an outcome.
const VAGUE_OUTCOME_RE = /\b(look(ing|s)?\s+into|explor(e|es|ing)|think(ing|s)?\s+about)\b/i

export function isVagueOutcome(outcome: string): boolean {
  return VAGUE_OUTCOME_RE.test(outcome)
}

export function normaliseOutcome(outcome: string): string {
  return outcome.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function isLapsed(p: Pick<KairosPromise, 'dueDate'>, now: Date): boolean {
  return daysLate(p, now) >= PROMISE_LAPSE_DAYS
}

export function formatDayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

// Moves one open promise to closed (newest first, capped). null = not open.
export function closeInState(
  state: KairosPromisesState,
  promiseId: string,
  status: 'kept' | 'dropped' | 'lapsed',
  closedBy: PromiseClosedBy,
  now: Date,
): { state: KairosPromisesState; promise: KairosPromise } | null {
  const target = state.open.find((p) => p.id === promiseId)
  if (!target) return null
  const promise: KairosPromise = { ...target, status, closedAt: now.toISOString(), closedBy }
  return {
    promise,
    state: {
      ...state,
      open: state.open.filter((p) => p.id !== promiseId),
      closed: [promise, ...state.closed].slice(0, MAX_CLOSED_PROMISES),
    },
  }
}

export function replaceOpen(state: KairosPromisesState, promise: KairosPromise): KairosPromisesState {
  return { ...state, open: state.open.map((p) => (p.id === promise.id ? promise : p)) }
}
