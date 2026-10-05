import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listDominionActivityUserIds, scoreDominionActivityForUser, type DominionActivityRun } from '@/lib/data/dominion-activity'
import { livingDominionsMode } from '@/lib/kairos/living/flag'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// Living Dominions activity score — 01:10 UTC daily (living_dominions.md §2 A).
// Off: does nothing. Observe and on: scores every user with a live Dominion;
// observe only changes what Health shows, focus consumers read it when on.

export const maxDuration = 300

const CRON_NAME = 'dominion-activity'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

type UserOutcome = DominionActivityRun | { userId: string; error: string }

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const mode = livingDominionsMode()
  if (mode === 'off') return jsonResponse({ skipped: 'off' })

  const users: UserOutcome[] = []
  for (const userId of await listDominionActivityUserIds()) {
    try {
      users.push(await scoreDominionActivityForUser(userId))
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: CRON_NAME, reason: 'uncaught_exception', error: err })
      users.push({ userId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return jsonResponse({
    mode,
    ran: users.length,
    failed: users.filter((u) => 'error' in u).length,
    users,
  })
}
