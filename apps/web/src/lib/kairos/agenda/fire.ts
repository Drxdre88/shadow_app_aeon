import { findGoal } from '@/lib/data/goals'
import { mutateKairosAgenda, readKairosAgenda } from '@/lib/data/kairos-agenda'
import type { AgendaResult, KairosAgendaItem, KairosAgendaState } from '@/lib/data/validators/kairos-agenda'
import { isTerminalGoalState } from '@/lib/kairos/goals/state'
import { agendaEnabled } from './flag'
import { AGENDA_EXPIRE_HOURS, AGENDA_FIRED_STALE_MS, closeAgendaInState } from './rules'

// Horae firing: the claim-once side of the agenda_due thinking job. A pass
// first settles housekeeping (goal finished → cancelled, never fired in 48h
// → cancelled, fired but never settled → missed), then marks at most two due
// items 'fired' under the row lock BEFORE a job is planned, so an item fires
// exactly once whatever the queue does. The job's apply settles the item;
// abandon marks it missed. Nothing here touches boards, goals or memories.

export const AGENDA_DUE_KIND = 'agenda_due'
export const MAX_AGENDA_FIRES_PER_PASS = 2
export const agendaDueJobKey = (itemId: string) => `${AGENDA_DUE_KIND}:${itemId}`

const HOUR_MS = 60 * 60 * 1000

export interface AgendaPass {
  state: KairosAgendaState | null
  fire: KairosAgendaItem[]
  cancelled: string[]
  missed: string[]
}

// Pure: what one planning pass does to the agenda at `now`.
export function planAgendaPass(state: KairosAgendaState, now: Date, closedGoalIds: ReadonlySet<string>): AgendaPass {
  let next = state
  const cancelled: string[] = []
  const missed: string[] = []
  const t = now.getTime()

  for (const item of state.open) {
    if (item.status === 'open' && item.goalId && closedGoalIds.has(item.goalId)) {
      next = closeAgendaInState(next, item.id, { status: 'cancelled', cancelledBy: { kind: 'rule', reason: 'goal_closed' } }, now)!.state
      cancelled.push(item.id)
    } else if (item.status === 'open' && Date.parse(item.dueAt) < t - AGENDA_EXPIRE_HOURS * HOUR_MS) {
      next = closeAgendaInState(next, item.id, { status: 'cancelled', cancelledBy: { kind: 'rule', reason: 'expired' } }, now)!.state
      cancelled.push(item.id)
    } else if (item.status === 'fired' && (!item.firedAt || Date.parse(item.firedAt) < t - AGENDA_FIRED_STALE_MS)) {
      next = closeAgendaInState(next, item.id, { status: 'missed' }, now)!.state
      missed.push(item.id)
    }
  }

  const due = next.open
    .filter((i) => i.status === 'open' && Date.parse(i.dueAt) <= t)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.seq - b.seq)
    .slice(0, MAX_AGENDA_FIRES_PER_PASS)
  const firedAt = now.toISOString()
  const fireIds = new Set(due.map((i) => i.id))
  const fire = due.map((i): KairosAgendaItem => ({ ...i, status: 'fired', firedAt }))
  if (fire.length > 0) {
    next = { ...next, open: next.open.map((i) => (fireIds.has(i.id) ? fire.find((f) => f.id === i.id)! : i)) }
  }

  const changed = fire.length > 0 || cancelled.length > 0 || missed.length > 0
  return { state: changed ? next : null, fire, cancelled, missed }
}

async function closedGoalIdsFor(userId: string, state: KairosAgendaState): Promise<Set<string>> {
  const goalIds = [...new Set(state.open.filter((i) => i.status === 'open' && i.goalId).map((i) => i.goalId!))]
  const closed = new Set<string>()
  for (const goalId of goalIds) {
    const goal = await findGoal(userId, goalId)
    if (!goal || goal.archivedAt || isTerminalGoalState(goal.meta.state)) closed.add(goalId)
  }
  return closed
}

// Planning pass for the agenda_due handler: the items it claimed to fire now.
export async function planAgendaDue(userId: string, now: Date): Promise<KairosAgendaItem[]> {
  if (!agendaEnabled()) return []
  const snapshot = await readKairosAgenda(userId)
  if (snapshot.open.length === 0) return []
  const closedGoals = await closedGoalIdsFor(userId, snapshot)
  const pass = await mutateKairosAgenda(userId, (state) => {
    const p = planAgendaPass(state, now, closedGoals)
    return { state: p.state, result: p }
  })
  if (pass.cancelled.length > 0 || pass.missed.length > 0) {
    console.info('[kairos:agenda] housekeeping', { cancelled: pass.cancelled.length, missed: pass.missed.length })
  }
  return pass.fire
}

// The item a job may still act on: open-list and 'fired'. null = cancelled,
// settled or gone — the job writes nothing.
export async function readFiredAgendaItem(userId: string, itemId: string): Promise<KairosAgendaItem | null> {
  const state = await readKairosAgenda(userId)
  return state.open.find((i) => i.id === itemId && i.status === 'fired') ?? null
}

// fired → done with what the job produced. false = no longer fired.
export async function settleAgendaItem(userId: string, itemId: string, jobId: string, result: AgendaResult, now: Date = new Date()): Promise<boolean> {
  return mutateKairosAgenda(userId, (state) => {
    const item = state.open.find((i) => i.id === itemId)
    if (!item || item.status !== 'fired') return { state: null, result: false }
    const next = closeAgendaInState(state, itemId, { status: 'done', result, firedJobId: jobId }, now)!
    return { state: next.state, result: true }
  })
}

// fired → missed (the sweep gave up on the job, or the flag went off).
export async function markAgendaMissed(userId: string, itemId: string, jobId: string, now: Date = new Date()): Promise<boolean> {
  return mutateKairosAgenda(userId, (state) => {
    const item = state.open.find((i) => i.id === itemId)
    if (!item || item.status !== 'fired') return { state: null, result: false }
    const next = closeAgendaInState(state, itemId, { status: 'missed', firedJobId: jobId }, now)!
    return { state: next.state, result: true }
  })
}
