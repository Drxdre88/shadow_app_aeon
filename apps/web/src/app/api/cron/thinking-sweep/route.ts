import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
import { listUsersNeedingSweep } from '@/lib/data/thinking-jobs'
import {
  SWEEP_FALLBACK_KINDS,
  SWEEP_PLAN_SKIP_KINDS,
  ThinkingQueue,
  createSweepBudget,
  type SweepResult,
} from '@/lib/kairos/thinking/queue'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { PROMISE_NUDGE_CRON, runPromiseNudges, type PromiseNudgeResult } from '@/lib/kairos/promises/nudge'

// ─────────────────────────────────────────────────────────────────────────
// Kairos thinking queue sweep (docs/kairos/32 §3, 33). Hourly ('50 * * * *').
//
// 1. Plan: per user with an active Dominion, run the queue's planDue (all
//    kinds but SWEEP_PLAN_SKIP_KINDS). Only claims plan otherwise, and the
//    nightly routine is done by ~03:20Z — so without this, kinds whose window
//    opens later (weekly_review Mon ≥05:00Z, mind_compare Mon ≥04:00Z,
//    daily_message from 05:30Z, drift_probe on nights the
//    routine stopped before aether) would never exist. Idempotent per
//    external key; no model calls.
// 2. Sweep: per user with open jobs or pending fallbacks: queued/claimed jobs
//    past their deadline → expired. Cron-fallback kinds decline (their cron
//    covers them); SWEEP_FALLBACK_KINDS run their paid heavy-tier fallback —
//    at most KAIROS_SWEEP_MAX_FALLBACKS (default 2) per invocation, none
//    started after KAIROS_SWEEP_BUDGET_MS (default 200s) — the rest wait for
//    the next hour. Idempotent: an expired job is never re-expired and an
//    attempted fallback is never re-run, so re-runs converge.
// 3. Promise nudge (operator only, KAIROS_INITIATIVE=1, 12:00 London): one
//    Telegram line for promises >2 days late, at most once per promise.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  // One budget for the whole invocation, started before any DB work.
  const budget = createSweepBudget()
  const queue = new ThinkingQueue()

  // Plan before sweeping. planDue isolates handler failures itself; a throw
  // here (e.g. listing users) must not stop the sweep below.
  const plans: Array<{ userId: string; planned: number; errors?: string[] }> = []
  try {
    for (const userId of await listMemoryEngineUserIds()) {
      try {
        const res = await queue.planDue(userId, now, { skipKinds: SWEEP_PLAN_SKIP_KINDS })
        plans.push({
          userId,
          planned: res.planned.length,
          ...(res.errors.length ? { errors: res.errors.map((e) => `${e.kind}: ${e.error}`) } : {}),
        })
      } catch (err) {
        plans.push({ userId, planned: 0, errors: [err instanceof Error ? err.message : String(err)] })
      }
    }
  } catch (err) {
    console.error('[cron:thinking-sweep] planning users failed:', err)
  }

  const userIds = await listUsersNeedingSweep(SWEEP_FALLBACK_KINDS)
  const users: Array<{ userId: string; result?: SweepResult; error?: string }> = []

  for (const userId of userIds) {
    try {
      const result = await queue.sweep(userId, now, budget)
      users.push({ userId, result })
      // Idempotent per user per UTC day (externalId), so hourly runs add one row.
      await writeCronSuccessTrace(userId, { cronName: 'thinking-sweep', now })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'thinking-sweep', reason: 'uncaught_exception', error: err })
      users.push({ userId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  let promiseNudge: PromiseNudgeResult | { status: 'error'; error: string } | null = null
  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID?.trim()
  if (operatorUserId) {
    try {
      promiseNudge = await runPromiseNudges(operatorUserId, now)
    } catch (err) {
      await writeCronFailureTrace(operatorUserId, { cronName: PROMISE_NUDGE_CRON, reason: 'uncaught_exception', error: err })
      promiseNudge = { status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  }

  return jsonResponse({
    planned: plans.reduce((n, p) => n + p.planned, 0),
    plans,
    ran: userIds.length,
    expired: users.reduce((n, u) => n + (u.result?.expired ?? 0), 0),
    fallbacksOk: users.reduce((n, u) => n + (u.result?.fallbacks.filter((f) => f.ok).length ?? 0), 0),
    deferred: users.reduce((n, u) => n + (u.result?.deferred ?? 0), 0),
    users,
    promiseNudge,
  })
}
