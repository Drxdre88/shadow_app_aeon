import { londonDate, londonInstant } from '@/lib/kairos/daily-message-prompt'
import { findForbiddenTopic, startsWithActionVerb } from '@/lib/kairos/goals/policy'
import {
  MAX_CLOSED_AGENDA,
  type AgendaSlot,
  type KairosAgendaItem,
  type KairosAgendaState,
} from '@/lib/data/validators/kairos-agenda'

// Pure Horae rules (no DB): slot times in London, the booking window, the
// "a check, never an act" text guard, and the state transitions the data
// layer's locked mutation applies.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const AGENDA_SLOT_HOUR: Readonly<Record<AgendaSlot, number>> = { morning: 9, afternoon: 14 }
export const AGENDA_MIN_LEAD_MS = HOUR_MS
export const AGENDA_MAX_LEAD_DAYS = 14
// An open item this far past due was never fired (flag off, queue down): it
// is cancelled by rule instead of firing stale.
export const AGENDA_EXPIRE_HOURS = 48
// A fired item whose job never settled (insert lost, sweep never abandoned):
// the agenda_due deadline (8h) plus an hour of grace, then it counts as missed.
export const AGENDA_DUE_DEADLINE_MINUTES = 8 * 60
export const AGENDA_FIRED_STALE_MS = AGENDA_DUE_DEADLINE_MINUTES * 60 * 1000 + HOUR_MS

export function agendaDueAt(date: string, slot: AgendaSlot): string {
  return londonInstant(date, AGENDA_SLOT_HOUR[slot]).toISOString()
}

export function isDueAtInWindow(dueAt: string, now: Date): boolean {
  const at = Date.parse(dueAt)
  if (!Number.isFinite(at)) return false
  const lead = at - now.getTime()
  return lead >= AGENDA_MIN_LEAD_MS && lead <= AGENDA_MAX_LEAD_DAYS * DAY_MS
}

export function normaliseWhat(what: string): string {
  return what.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const CHECK_OPENERS = new Set(['check', 'see', 'review', 'confirm'])
const QUESTION_OPENERS = new Set([
  'what', 'why', 'how', 'which', 'when', 'where', 'who', 'is', 'are', 'does', 'do', 'did', 'can',
  'could', 'should', 'would', 'will', 'has', 'have', 'was', 'were',
])

const firstWord = (s: string) => (s.trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? '')

export type AgendaWhatProblem = 'forbidden_topic' | 'action_verb' | 'not_a_check'

// An agenda item names a check ("Check whether …", "Did the fix hold?"),
// never an act and never Kairos's own machinery. null = acceptable.
export function checkAgendaWhat(what: string): AgendaWhatProblem | null {
  if (findForbiddenTopic(what)) return 'forbidden_topic'
  if (startsWithActionVerb(what)) return 'action_verb'
  const word = firstWord(what)
  if (CHECK_OPENERS.has(word)) return null
  if (QUESTION_OPENERS.has(word) && what.trim().endsWith('?')) return null
  return 'not_a_check'
}

export function createdOnLondonDay(state: KairosAgendaState, day: string): number {
  return [...state.open, ...state.closed].filter((i) => londonDate(new Date(i.createdAt)) === day).length
}

export type AgendaClosePatch = Pick<KairosAgendaItem, 'status'> & Partial<Pick<KairosAgendaItem, 'result' | 'cancelledBy' | 'firedJobId'>>

// Moves one open/fired item to closed (newest first, capped). null = not open.
export function closeAgendaInState(
  state: KairosAgendaState,
  itemId: string,
  patch: AgendaClosePatch,
  now: Date,
): { state: KairosAgendaState; item: KairosAgendaItem } | null {
  const target = state.open.find((i) => i.id === itemId)
  if (!target) return null
  const item: KairosAgendaItem = { ...target, ...patch, closedAt: now.toISOString() }
  return {
    item,
    state: {
      ...state,
      open: state.open.filter((i) => i.id !== itemId),
      closed: [item, ...state.closed].slice(0, MAX_CLOSED_AGENDA),
    },
  }
}

// "Thu 08/10" in London — the owner-facing when for an item.
export function formatAgendaWhen(dueAt: string): string {
  const d = new Date(dueAt)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(d)
  const date = londonDate(d)
  return `${day} ${date.slice(8, 10)}/${date.slice(5, 7)}`
}
