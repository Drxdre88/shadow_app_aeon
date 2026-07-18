import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, isNull, inArray } from 'drizzle-orm'
import { runIntrospectionForUser } from '@/lib/kairos/introspection'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Guided Introspection cron (propose-not-commit, L1 autonomy).
//
// Per eligible user (has a non-archived Dominion AND an active BYOK credential):
// read recent substrate per Dominion and write a few grounded proposals as
// staged `inbound` memories for the operator to accept (via kairos_reflect) or
// dismiss (archive). Idempotent per UTC day. Auth + iteration mirror
// app/api/cron/archetype-synthesis. Suggested schedule: daily ~06:30 UTC,
// before the 07:00 Briefer so the morning brief can surface fresh proposals.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  if (usersWithDominions.length === 0) return jsonResponse({ ran: 0, users: [] })

  const userIds = usersWithDominions.map((r) => r.userId)
  const credentialed = await db
    .selectDistinct({ userId: userAiCredentials.userId })
    .from(userAiCredentials)
    .where(and(isNull(userAiCredentials.revokedAt), inArray(userAiCredentials.userId, userIds)))

  const eligibleIds = credentialed.map((r) => r.userId)

  const userResults: Array<{
    userId: string
    results: Awaited<ReturnType<typeof runIntrospectionForUser>>
    error?: string
  }> = []

  for (const userId of eligibleIds) {
    try {
      userResults.push({ userId, results: await runIntrospectionForUser(userId) })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'introspection', reason: 'uncaught_exception', error: err })
      userResults.push({ userId, results: [], error: err instanceof Error ? err.message : String(err) })
    }
  }

  const totals = userResults.reduce(
    (acc, u) => {
      for (const r of u.results) {
        acc.proposalsCreated += r.proposalsCreated ?? 0
        acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1
      }
      return acc
    },
    { proposalsCreated: 0, byStatus: {} as Record<string, number> },
  )

  return jsonResponse({ ran: eligibleIds.length, ...totals, users: userResults })
}
