import { jsonResponse } from '@/lib/api/response'
import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runAskMineForUser, type AskMineRunResult } from '@/lib/kairos/ask-mine'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import type { NextRequest } from 'next/server'

export const maxDuration = 300

const DEADLINE_MS = 240_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const userIds = await listChatDistillEligibleUserIds()
  const users: Array<{ userId: string; result?: AskMineRunResult; error?: string }> = []
  const skippedUserIds: string[] = []

  for (const userId of userIds) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      skippedUserIds.push(userId)
      continue
    }
    try {
      users.push({ userId, result: await runAskMineForUser(userId, { dryRun }) })
    } catch (error) {
      try {
        await writeCronFailureTrace(userId, {
          cronName: 'ask-mine',
          reason: 'uncaught_exception',
          error,
        })
      } catch (traceError) {
        console.error('[ask-mine] failed to write failure trace', traceError)
      }
      users.push({ userId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (skippedUserIds.length) {
    console.warn('[ask-mine] deadline reached — users skipped this run', { skippedUserIds })
  }

  return jsonResponse({
    ran: users.length,
    skipped: skippedUserIds.length,
    ...(skippedUserIds.length ? { skippedUserIds } : {}),
    asksCreated: users.filter((user) => user.result?.status === 'created').length,
    dryRun,
    users,
  })
}
