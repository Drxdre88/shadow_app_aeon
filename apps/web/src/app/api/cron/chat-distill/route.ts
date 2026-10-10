import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { markTodayConsumed, purgeTodayEntries } from '@/lib/data/kairos-today'
import { runChatDistillForUser, type ChatDistillRunResult } from '@/lib/kairos/chat-distill'
import { skipCronIfPaidBackupOff } from '@/lib/kairos/paid-backup-cron'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { canUseVorath } from '@/lib/vorath-access'

export const maxDuration = 300

// Bail before Vercel kills the invocation mid-user: users past the deadline
// are reported as skipped instead of silently never running (recoverable via
// a manual date-backfill call).
const DEADLINE_MS = 240_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  const userIds = (await listChatDistillEligibleUserIds()).filter((userId) => canUseVorath(userId))
  const users: Array<{ userId: string; result?: ChatDistillRunResult; error?: string }> = []
  const skippedUserIds: string[] = []

  const paidBackupOff: string[] = []
  for (const userId of userIds) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      skippedUserIds.push(userId)
      continue
    }
    // Paid backup switched off: skip before building any prompt.
    if (await skipCronIfPaidBackupOff(userId, 'chat-distill')) {
      paidBackupOff.push(userId)
      continue
    }
    try {
      users.push({ userId, result: await runChatDistillForUser(userId) })
    } catch (error) {
      try {
        await writeCronFailureTrace(userId, {
          cronName: 'chat-distill',
          reason: 'uncaught_exception',
          error,
        })
      } catch (traceErr) {
        console.error('[chat-distill] failed to write failure trace', traceErr)
      }
      users.push({ userId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (skippedUserIds.length) {
    console.warn('[chat-distill] deadline reached — users skipped this run', { skippedUserIds })
  }

  const today = await consumeAndTrimToday(new Date())

  return jsonResponse({
    ran: users.length,
    paidBackupOff,
    skipped: skippedUserIds.length,
    ...(skippedUserIds.length ? { skippedUserIds } : {}),
    reflectionsCreated: users.reduce(
      (count, user) => count + (user.result?.reflectionsCreated ?? 0),
      0,
    ),
    users,
    today,
  })
}

// Nightly consume + trim of the one-mind today log (spec_one_mind). Today is
// a cache, never a distill source, so the run marks everything up to the end
// of the distilled UTC day consumed, then drops entries past the 36h window
// (72h hard stop for anything unmarked). Never fails the cron.
async function consumeAndTrimToday(now: Date): Promise<{ consumed: number; purged: number } | { error: string }> {
  try {
    const through = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const consumed = await markTodayConsumed(through)
    const purged = await purgeTodayEntries(now)
    return { consumed, purged }
  } catch (error) {
    console.error('[chat-distill] today consume/trim failed', error)
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
