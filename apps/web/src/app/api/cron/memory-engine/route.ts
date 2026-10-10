import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
import { BufferedChangeLog } from '@/lib/kairos/engine/change-log'
import { MemoryEngine } from '@/lib/kairos/engine/memory-engine'
import { buildNightSteps } from '@/lib/kairos/engine/registry'
import type { EngineRunResult } from '@/lib/kairos/engine/types'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { canUseVorath } from '@/lib/vorath-access'

// Memory engine nightly run (docs/kairos/32 §2), 01:30 UTC. Per user with an
// active Dominion: MemoryEngine.runNight over the registry's steps (incl. the
// own-mind mirror of BackUp's promotions). No model
// calls: Sunday's Concepts step only plans + enqueues thinking jobs (the
// thinking-sweep cron owns their API fallback). Every live change writes its
// memory_ops row in the same transaction as the change itself, and the run
// stops on its own time budget well before maxDuration so it ALWAYS leaves a
// trace — 2026-10-01: the platform killed the run mid-BackUp at maxDuration,
// so 349 changes lost their buffered ops and no trace was ever written.
// ?dryRun=1 computes and reports without writing standings, ops or traces.

export const maxDuration = 300

const CRON_NAME = 'memory-engine'
// Engine work budget. The rest of maxDuration is headroom for the in-flight
// mutation (bounded by the 15s DB query timeout) and the trace writes.
const ENGINE_BUDGET_MS = 230_000

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function stepsCutShort(result: EngineRunResult): string {
  return result.steps
    .filter((s) => s.outOfTime)
    .map((s) => `${s.step}: ${s.skipped ?? s.notes?.find((n) => n.startsWith('out of time')) ?? 'out of time'}`)
    .join('; ')
}

type UserOutcome = { userId: string; result?: EngineRunResult; error?: string }

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const deadline = Date.now() + ENGINE_BUDGET_MS
  let userIds: string[]
  try {
    userIds = (await listMemoryEngineUserIds()).filter((userId) => canUseVorath(userId))
  } catch (err) {
    // No user to attach a trace to — the log is the only record.
    console.error(`[cron:${CRON_NAME}] listing users failed:`, err)
    return jsonResponse({ error: errorMessage(err) }, { status: 500 })
  }
  const users: UserOutcome[] = []

  for (const userId of userIds) {
    const startedAt = Date.now()
    if (startedAt >= deadline) {
      const error = 'time budget spent before this user ran'
      users.push({ userId, error })
      console.error(`[cron:${CRON_NAME}] ${userId}: ${error}`)
      if (!dryRun) await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'time_budget', error })
      continue
    }
    try {
      const result = await buildEngine().runNight(userId, { dryRun, deadline })
      users.push({ userId, result })
      if (dryRun) continue
      const durationMs = Date.now() - startedAt
      if (result.failedSteps.length > 0) {
        const cut = result.outOfTime ? ` | out of time: ${stepsCutShort(result)}` : ''
        const error = result.failedSteps.map((f) => `${f.step}: ${f.error}`).join('; ') + cut
        console.error(`[cron:${CRON_NAME}] ${userId} run ${result.runId} failed: ${error}`)
        await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'step_failed', error, durationMs })
      } else if (result.outOfTime) {
        // Partial, not broken: every applied change has its op; the rest
        // (oldest first) carries over to the next night.
        const error = `run ${result.runId} stopped at the time budget (${result.opsWritten} ops written): ${stepsCutShort(result)}`
        console.error(`[cron:${CRON_NAME}] ${userId}: ${error}`)
        await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'time_budget', error, durationMs })
      } else {
        await writeCronSuccessTrace(userId, { cronName: CRON_NAME, durationMs })
      }
    } catch (err) {
      console.error(`[cron:${CRON_NAME}] ${userId} uncaught:`, err)
      if (!dryRun) {
        await writeCronFailureTrace(userId, {
          cronName: CRON_NAME,
          reason: 'uncaught_exception',
          error: err,
          durationMs: Date.now() - startedAt,
        })
      }
      users.push({ userId, error: errorMessage(err) })
    }
  }

  const opsWritten = users.reduce((n, u) => n + (u.result?.opsWritten ?? 0), 0)
  const failed = users.filter((u) => u.error || (u.result?.failedSteps.length ?? 0) > 0 || u.result?.outOfTime).length
  return jsonResponse({ ran: userIds.length, dryRun, opsWritten, failed, users })
}
