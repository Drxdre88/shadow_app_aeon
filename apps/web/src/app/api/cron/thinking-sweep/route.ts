import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listUsersNeedingSweep } from '@/lib/data/thinking-jobs'
import {
  SWEEP_FALLBACK_KINDS,
  ThinkingQueue,
  createSweepBudget,
  type SweepResult,
} from '@/lib/kairos/thinking/queue'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos thinking queue sweep (docs/kairos/32 §3). Hourly (e.g. '50 * * * *').
//
// Per user with open jobs or pending concept fallbacks: queued/claimed jobs
// past their deadline → expired. aether/cortex decline (their 03:00/03:15
// crons are the fallback); concept runs its paid heavy-tier fallback — at
// most KAIROS_SWEEP_MAX_FALLBACKS (default 2) per invocation, none started
// after KAIROS_SWEEP_BUDGET_MS (default 200s) — the rest wait for the next
// hour. Idempotent: an expired job is never re-expired and an attempted
// fallback is never re-run, so re-runs converge.
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
  const userIds = await listUsersNeedingSweep(SWEEP_FALLBACK_KINDS)
  const queue = new ThinkingQueue()
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

  return jsonResponse({
    ran: userIds.length,
    expired: users.reduce((n, u) => n + (u.result?.expired ?? 0), 0),
    fallbacksOk: users.reduce((n, u) => n + (u.result?.fallbacks.filter((f) => f.ok).length ?? 0), 0),
    deferred: users.reduce((n, u) => n + (u.result?.deferred ?? 0), 0),
    users,
  })
}
