import { jsonResponse } from '@/lib/api/response'
import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runAskMineForUser, sweepExpiredKairosAsks, type AskMineRunResult } from '@/lib/kairos/ask-mine'
import { skipCronIfPaidBackupOff } from '@/lib/kairos/paid-backup-cron'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
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
  const users: Array<{ userId: string; result?: AskMineRunResult; expiredAsks?: number; error?: string }> = []
  const skippedUserIds: string[] = []
  const paidBackupOff: string[] = []
  let asksExpired = 0

  for (const userId of userIds) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      skippedUserIds.push(userId)
      continue
    }
    // Expiry sweep first (live runs only): a stale pending ask is closed as
    // 'expired' + outcome negative. Its failure never blocks today's ask.
    let expiredAsks: number | undefined
    if (!dryRun) {
      try {
        expiredAsks = (await sweepExpiredKairosAsks(userId)).expired
        asksExpired += expiredAsks
      } catch (error) {
        console.error('[ask-mine] expired-ask sweep failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // Paid backup switched off: skip the paid ask (the expiry sweep above is
    // free; a dry run builds the prompt without calling the model).
    if (!dryRun && await skipCronIfPaidBackupOff(userId, 'ask-mine')) {
      paidBackupOff.push(userId)
      continue
    }
    try {
      const result = await runAskMineForUser(userId, { dryRun })
      users.push({ userId, result, ...(expiredAsks !== undefined ? { expiredAsks } : {}) })
      // Liveness: a skip (awaiting_reply, pending, …) must be visible to
      // health/digest, not just console. Idempotent per user per UTC day.
      if (!dryRun) {
        await writeCronSuccessTrace(userId, {
          cronName: 'ask-mine',
          outcome: result.status === 'created' ? 'ok' : 'skipped',
          ...(result.status === 'skipped' ? { skipReason: result.reason } : {}),
          ...(expiredAsks !== undefined ? { details: { asksExpired: expiredAsks } } : {}),
        })
      }
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
      users.push({
        userId,
        ...(expiredAsks !== undefined ? { expiredAsks } : {}),
        error: error instanceof Error ? error.message : String(error),
      })
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
    asksExpired,
    paidBackupOff,
    dryRun,
    users,
  })
}
