import { findPromiseTask, listPromiseDoneEvents, type PromiseDoneEvent, type PromiseTaskRow } from '@/lib/data/kairos-promises'
import { mutateKairosPredictions, readKairosPredictions } from '@/lib/data/kairos-predictions'
import type { KairosPrediction, PredictionSettledBy } from '@/lib/data/validators/kairos-predictions'
import { DONE_COLUMN_NAMES } from '@/lib/kairos/auto-capture'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { predictionsEnabled } from './flag'
import { isVerdictExpired, predictionCutoff, replaceOpen, settleInState, type SettledStatus } from './rules'
import { feedBackSettlement } from './verdict'

// Hourly settlement from the thinking sweep (operator only). Pure SQL, no
// model — Kairos never settles his own claims. Evidence is a user activity
// event before the London end of the due date, or card state after it:
//   expect done:     user done event before cut-off → right. Past cut-off with
//                    no user event: card done/archived/in a done column, or an
//                    agent event → needs_verdict (agents and REST leave no
//                    user event); otherwise → wrong.
//   expect not_done: the mirror — user done event before cut-off → wrong;
//                    past cut-off, card done or agent evidence → needs_verdict;
//                    otherwise → right.
//   card deleted → void. owner_verdict / needs_verdict wait for the owner;
//   7 days past due → unresolved (never scored).

export const PREDICTION_CHECK_CRON = 'prediction-check'

export type PlannedSettlement = { predictionId: string; status: SettledStatus; settledBy: PredictionSettledBy }

export interface PredictionCheckPlan {
  settle: PlannedSettlement[]
  needsVerdict: Array<{ predictionId: string; agentEvidenceSeenAt?: string }>
}

export function isCardDone(task: PromiseTaskRow): boolean {
  return task.status === 'done' || task.completedAt !== null || task.archivedAt !== null ||
    (task.columnName !== null && DONE_COLUMN_NAMES.has(task.columnName.trim().toLowerCase()))
}

function planCardCheck(
  p: KairosPrediction,
  check: Extract<KairosPrediction['check'], { kind: 'card_by' }>,
  events: readonly PromiseDoneEvent[],
  task: PromiseTaskRow | null,
  now: Date,
): PlannedSettlement | { needsVerdict: { agentEvidenceSeenAt?: string } } | null {
  const since = Date.parse(p.createdAt)
  const cutoff = predictionCutoff(p.dueDate).getTime()
  const inWindow = events.filter((e) =>
    e.entityId === check.taskId && e.projectId === check.projectId &&
    e.createdAt.getTime() >= since && e.createdAt.getTime() < cutoff)
  const byUser = inWindow.find((e) => e.actorType === 'user')
  if (byUser) {
    return {
      predictionId: p.id,
      status: check.expect === 'done' ? 'right' : 'wrong',
      settledBy: { kind: 'check', activityEventId: byUser.id, rule: 'user_done_before_due' },
    }
  }
  if (!task) return { predictionId: p.id, status: 'void', settledBy: { kind: 'rule', reason: 'card_gone' } }
  if (now.getTime() < cutoff) return null
  const byAgent = inWindow.find((e) => e.actorType !== 'user')
  if (byAgent || isCardDone(task)) {
    return { needsVerdict: byAgent ? { agentEvidenceSeenAt: byAgent.createdAt.toISOString() } : {} }
  }
  return {
    predictionId: p.id,
    status: check.expect === 'done' ? 'wrong' : 'right',
    settledBy: { kind: 'check', activityEventId: null, rule: 'not_done_by_due' },
  }
}

export function planPredictionChecks(
  open: readonly KairosPrediction[],
  events: readonly PromiseDoneEvent[],
  tasks: ReadonlyMap<string, PromiseTaskRow | null>,
  now: Date,
): PredictionCheckPlan {
  const plan: PredictionCheckPlan = { settle: [], needsVerdict: [] }
  for (const p of open) {
    if (p.status === 'open' && p.check.kind === 'card_by') {
      const res = planCardCheck(p, p.check, events, tasks.get(p.check.taskId) ?? null, now)
      if (res && !('needsVerdict' in res)) { plan.settle.push(res); continue }
      // Flagged for the owner — unless the verdict window has already run out.
      if (res && !isVerdictExpired(p, now)) { plan.needsVerdict.push({ predictionId: p.id, ...res.needsVerdict }); continue }
    }
    if (isVerdictExpired(p, now)) {
      plan.settle.push({ predictionId: p.id, status: 'unresolved', settledBy: { kind: 'rule', reason: 'no_verdict_7d' } })
    }
  }
  return plan
}

export type PredictionCheckResult =
  | { status: 'skipped'; reason: 'flag_off' }
  | { status: 'ok'; open: number; settled: Array<{ id: string; status: SettledStatus }>; needsVerdict: string[]; feedback: number }

export async function runPredictionSettlement(userId: string, now: Date): Promise<PredictionCheckResult> {
  if (!predictionsEnabled()) return { status: 'skipped', reason: 'flag_off' }
  const state = await readKairosPredictions(userId)
  if (state.open.length === 0) return { status: 'ok', open: 0, settled: [], needsVerdict: [], feedback: 0 }

  const cards = state.open.filter((p) => p.status === 'open' && p.check.kind === 'card_by')
  const taskIds = [...new Set(cards.map((p) => (p.check.kind === 'card_by' ? p.check.taskId : '')))]
  const earliest = cards.reduce((min, p) => Math.min(min, Date.parse(p.createdAt)), Number.POSITIVE_INFINITY)
  const events = taskIds.length ? await listPromiseDoneEvents(taskIds, new Date(earliest), [...DONE_COLUMN_NAMES]) : []
  const tasks = new Map<string, PromiseTaskRow | null>()
  for (const id of taskIds) tasks.set(id, await findPromiseTask(id))
  const plan = planPredictionChecks(state.open, events, tasks, now)
  if (plan.settle.length === 0 && plan.needsVerdict.length === 0) {
    return { status: 'ok', open: state.open.length, settled: [], needsVerdict: [], feedback: 0 }
  }

  // Re-checked under the lock: only a still-open prediction in the planned
  // starting status moves, so a concurrent owner verdict always wins.
  const applied = await mutateKairosPredictions(userId, (current) => {
    let next = current
    const settled: KairosPrediction[] = []
    const flagged: string[] = []
    for (const s of plan.settle) {
      const res = settleInState(next, s.predictionId, s.status, s.settledBy, now)
      if (!res) continue
      next = res.state
      settled.push(res.prediction)
    }
    for (const n of plan.needsVerdict) {
      const p = next.open.find((o) => o.id === n.predictionId)
      if (!p || p.status !== 'open') continue
      next = replaceOpen(next, { ...p, status: 'needs_verdict', ...(n.agentEvidenceSeenAt ? { agentEvidenceSeenAt: n.agentEvidenceSeenAt } : {}) })
      flagged.push(p.id)
    }
    return { state: settled.length || flagged.length ? next : null, result: { settled, flagged } }
  })

  let feedback = 0
  for (const p of applied.settled) feedback += await feedBackSettlement(userId, p)
  if (applied.settled.length || applied.flagged.length) {
    await writeCronSuccessTrace(userId, {
      cronName: PREDICTION_CHECK_CRON,
      now,
      details: { open: state.open.length, settled: applied.settled.length, needsVerdict: applied.flagged.length },
    })
  }
  return {
    status: 'ok',
    open: state.open.length,
    settled: applied.settled.map((p) => ({ id: p.id, status: p.status as SettledStatus })),
    needsVerdict: applied.flagged,
    feedback,
  }
}
