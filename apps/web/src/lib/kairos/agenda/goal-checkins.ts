import type { GoalRecord } from '@/lib/data/goals'
import { addDays } from '@/lib/kairos/promises/rules'
import { londonDate } from '@/lib/kairos/daily-message-prompt'
import type { AgendaProposal } from '@/lib/data/validators/kairos-agenda'
import { createAgendaItems, type CreateAgendaResult } from './create'
import { agendaEnabled } from './flag'

// Goal approval books at most two Horae check-ins: the midpoint when the goal
// runs 4+ days, and the day before it is due (both 09:00 London). They never
// close the goal or its promise — they only prompt Kairos to look.

const DAY_MS = 24 * 60 * 60 * 1000
export const GOAL_CHECKIN_MIDPOINT_MIN_DAYS = 4

const clipTitle = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s)

// Pure: the check-ins for an approved goal at `now`. [] when it has no dueAt.
export function planGoalCheckins(goal: Pick<GoalRecord, 'id' | 'title' | 'dominionId' | 'meta'>, now: Date): AgendaProposal[] {
  if (!goal.meta.dueAt) return []
  const dueAt = new Date(goal.meta.dueAt)
  if (!Number.isFinite(dueAt.getTime())) return []
  const title = clipTitle(goal.title.trim())
  const base = { basisIds: [], dominionId: goal.dominionId ?? null, goalId: goal.id }
  const out: AgendaProposal[] = []
  const spanDays = (dueAt.getTime() - now.getTime()) / DAY_MS
  if (spanDays >= GOAL_CHECKIN_MIDPOINT_MIN_DAYS) {
    out.push({ ...base, what: `Check progress halfway on: ${title}`, date: londonDate(new Date(now.getTime() + (spanDays / 2) * DAY_MS)), slot: 'morning' })
  }
  out.push({ ...base, what: `Review where this stands before it is due: ${title}`, date: addDays(londonDate(dueAt), -1), slot: 'morning' })
  return out
}

// Books the check-ins (flag-gated). Throws only on a storage failure; the
// caller keeps that away from the approval itself.
export async function bookGoalCheckins(
  userId: string,
  goal: Pick<GoalRecord, 'id' | 'title' | 'dominionId' | 'meta'>,
  now: Date = new Date(),
): Promise<CreateAgendaResult | null> {
  if (!agendaEnabled()) return null
  const proposals = planGoalCheckins(goal, now)
  if (proposals.length === 0) return null
  return createAgendaItems(userId, proposals, { kind: 'goal_checkin', goalId: goal.id }, { now })
}
