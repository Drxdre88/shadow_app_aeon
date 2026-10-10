import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import { runAetherForUser } from '@/lib/kairos/aether'
import { skipCronIfPaidBackupOff } from '@/lib/kairos/paid-backup-cron'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { canUseVorath } from '@/lib/vorath-access'

// Aether cron — 03:15 UTC daily (after cortex-regen at 03:00). Idempotent.

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const usersWithDominions = (await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt)))
    .filter(({ userId }) => canUseVorath(userId))

  if (usersWithDominions.length === 0) {
    return jsonResponse({ ran: 0, generated: 0, users: [] })
  }

  const userResults: Array<{
    userId: string
    generated: boolean
    reason?: string
    error?: string
  }> = []

  const paidBackupOff: string[] = []
  for (const { userId } of usersWithDominions) {
    // Paid backup switched off: skip before building any prompt.
    if (await skipCronIfPaidBackupOff(userId, 'aether-regen')) {
      paidBackupOff.push(userId)
      continue
    }
    try {
      const result = await runAetherForUser(userId)
      userResults.push({ userId, generated: result.generated, reason: result.reason })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'aether-regen', reason: 'uncaught_exception', error: err })
      userResults.push({
        userId,
        generated: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return jsonResponse({
    ran: userResults.length,
    paidBackupOff,
    generated: userResults.filter((r) => r.generated).length,
    users: userResults,
  })
}
