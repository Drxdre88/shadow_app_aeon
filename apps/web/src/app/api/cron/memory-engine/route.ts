import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
import { BufferedChangeLog } from '@/lib/kairos/engine/change-log'
import { MemoryEngine } from '@/lib/kairos/engine/memory-engine'
import { buildNightSteps } from '@/lib/kairos/engine/registry'
import type { EngineRunResult } from '@/lib/kairos/engine/types'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'

// Memory engine nightly run (docs/kairos/32 §2), 01:30 UTC. Per user with an
// active Dominion: MemoryEngine.runNight over the registry's steps. No model
// calls: Sunday's Concepts step only plans + enqueues thinking jobs (the
// thinking-sweep cron owns their API fallback). The ChangeLog is flushed after
// every step, so a timeout never leaves applied writes without memory_ops.
// ?dryRun=1 computes and reports without writing standings, ops or traces.

export const maxDuration = 300

const CRON_NAME = 'memory-engine'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function buildEngine(): MemoryEngine {
  return new MemoryEngine({
    steps: buildNightSteps(),
    changes: (userId, runId) => new BufferedChangeLog(userId, runId),
  })
}

type UserOutcome = { userId: string; result?: EngineRunResult; error?: string }

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const userIds = await listMemoryEngineUserIds()
  const users: UserOutcome[] = []

  for (const userId of userIds) {
    const startedAt = Date.now()
    try {
      const result = await buildEngine().runNight(userId, { dryRun })
      users.push({ userId, result })
      if (dryRun) continue
      const durationMs = Date.now() - startedAt
      if (result.failedSteps.length > 0) {
        const error = result.failedSteps.map((f) => `${f.step}: ${f.error}`).join('; ')
        await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'step_failed', error, durationMs })
      } else {
        await writeCronSuccessTrace(userId, { cronName: CRON_NAME, durationMs })
      }
    } catch (err) {
      if (!dryRun) await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'uncaught_exception', error: err })
      users.push({ userId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const opsWritten = users.reduce((n, u) => n + (u.result?.opsWritten ?? 0), 0)
  const failed = users.filter((u) => u.error || (u.result?.failedSteps.length ?? 0) > 0).length
  return jsonResponse({ ran: userIds.length, dryRun, opsWritten, failed, users })
}
