import {
  listPromiseDoneEvents,
  mutateKairosPromises,
  readKairosPromises,
  type PromiseDoneEvent,
} from '@/lib/data/kairos-promises'
import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import { DONE_COLUMN_NAMES } from '@/lib/kairos/auto-capture'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { closeKairosPromise } from './close'
import { isLapsed, replaceOpen } from './rules'

// Daily promise check, run just before the 06:00 message. Pure SQL, no
// model: a card_done promise is kept when the operator (activity actor_type
// 'user') completed / vaulted the card, or moved it into a done/vault column,
// after the promise was made. An agent doing the same only stamps
// agentDoneSeenAt — an agent can't close a promise. owner_confirm promises
// never auto-close. Anything 14+ London days past due lapses.

export const PROMISE_CHECK_CRON = 'promise-check'

export interface PromiseCheckPlan {
  kept: Array<{ promiseId: string; event: PromiseDoneEvent }>
  lapsed: string[]
  agentSeen: Array<{ promiseId: string; at: string }>
}

export function planPromiseChecks(open: readonly KairosPromise[], events: readonly PromiseDoneEvent[], now: Date): PromiseCheckPlan {
  const plan: PromiseCheckPlan = { kept: [], lapsed: [], agentSeen: [] }
  for (const p of open) {
    if (p.check.kind === 'card_done') {
      const { taskId, projectId } = p.check
      const since = Date.parse(p.createdAt)
      const matching = events.filter((e) => e.entityId === taskId && e.projectId === projectId && e.createdAt.getTime() >= since)
      const byUser = matching.find((e) => e.actorType === 'user')
      if (byUser) { plan.kept.push({ promiseId: p.id, event: byUser }); continue }
      const byAgent = matching.find((e) => e.actorType === 'agent')
      if (byAgent && !p.agentDoneSeenAt) plan.agentSeen.push({ promiseId: p.id, at: byAgent.createdAt.toISOString() })
    }
    if (isLapsed(p, now)) plan.lapsed.push(p.id)
  }
  return plan
}

export interface PromiseCheckResult {
  open: number
  kept: string[]
  lapsed: string[]
  agentSeen: string[]
  persisted: boolean
}

export async function verifyOpenPromises(userId: string, now: Date, opts: { persist: boolean }): Promise<PromiseCheckResult> {
  const state = await readKairosPromises(userId)
  const empty: PromiseCheckResult = { open: state.open.length, kept: [], lapsed: [], agentSeen: [], persisted: false }
  if (state.open.length === 0) return empty

  const cardPromises = state.open.filter((p) => p.check.kind === 'card_done')
  const taskIds = [...new Set(cardPromises.map((p) => (p.check.kind === 'card_done' ? p.check.taskId : '')))]
  const earliest = cardPromises.reduce((min, p) => Math.min(min, Date.parse(p.createdAt)), Number.POSITIVE_INFINITY)
  const events = taskIds.length
    ? await listPromiseDoneEvents(taskIds, new Date(earliest), [...DONE_COLUMN_NAMES])
    : []
  const plan = planPromiseChecks(state.open, events, now)
  const planned: PromiseCheckResult = {
    open: state.open.length,
    kept: plan.kept.map((k) => k.promiseId),
    lapsed: plan.lapsed,
    agentSeen: plan.agentSeen.map((a) => a.promiseId),
    persisted: false,
  }
  if (!opts.persist) return planned

  const kept: string[] = []
  const lapsed: string[] = []
  for (const { promiseId, event } of plan.kept) {
    const res = await closeKairosPromise(userId, promiseId, {
      kind: 'check',
      activityEventId: event.id,
      actorId: event.actorId,
      at: event.createdAt.toISOString(),
    }, now)
    if (res.ok) kept.push(promiseId)
  }
  for (const promiseId of plan.lapsed) {
    const res = await closeKairosPromise(userId, promiseId, { kind: 'rule', reason: 'lapsed_14d' }, now)
    if (res.ok) lapsed.push(promiseId)
  }
  const agentSeen = plan.agentSeen.length === 0 ? [] : await mutateKairosPromises(userId, (current) => {
    let next = current
    const marked: string[] = []
    for (const { promiseId, at } of plan.agentSeen) {
      const p = next.open.find((o) => o.id === promiseId)
      if (!p || p.agentDoneSeenAt) continue
      next = replaceOpen(next, { ...p, agentDoneSeenAt: at })
      marked.push(promiseId)
    }
    return { state: marked.length ? next : null, result: marked }
  })

  await writeCronSuccessTrace(userId, {
    cronName: PROMISE_CHECK_CRON,
    now,
    details: { open: state.open.length, kept: kept.length, lapsed: lapsed.length, agentSeen: agentSeen.length },
  })
  return { open: state.open.length, kept, lapsed, agentSeen, persisted: true }
}
