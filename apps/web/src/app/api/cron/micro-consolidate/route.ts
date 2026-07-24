import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, isNull, inArray } from 'drizzle-orm'
import { runMicroConsolidateForUser } from '@/lib/kairos/micro-consolidate'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Micro-consolidation cron. Runs 6x/day, off-peak of the nightly
// synthesis chain (see vercel.json: "15 6,9,12,15,18,21 * * *"). Per eligible
// user (has a non-archived Dominion AND an active BYOK credential), folds
// new substrate into a compact 'delta' memory per Dominion when there's
// enough of it — cheap, mechanical, idempotent per hour-bucket.
//
// Auth + iteration mirror app/api/cron/cortex-regen and app/api/cron/introspection.
// ─────────────────────────────────────────────────────────────────────────

// Single-shot mechanical fold, no repair round-trips — well under the 800s
// ceiling the failure-night nightly crons need.
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

  if (usersWithDominions.length === 0) {
    return jsonResponse({ ran: 0, deltaCreated: 0, byStatus: {}, users: [] })
  }

  const userIds = usersWithDominions.map((r) => r.userId)
  const credentialed = await db
    .selectDistinct({ userId: userAiCredentials.userId })
    .from(userAiCredentials)
    .where(and(
      isNull(userAiCredentials.revokedAt),
      inArray(userAiCredentials.userId, userIds),
    ))

  const eligibleIds = credentialed.map((r) => r.userId)

  const userResults: Array<{
    userId: string
    results: Awaited<ReturnType<typeof runMicroConsolidateForUser>>
    error?: string
  }> = []

  for (const userId of eligibleIds) {
    try {
      const results = await runMicroConsolidateForUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'micro-consolidate', reason: 'uncaught_exception', error: err })
      userResults.push({
        userId,
        results: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const totals = userResults.reduce(
    (acc, u) => {
      for (const r of u.results) {
        if (r.status === 'created') acc.deltaCreated += 1
        acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1
      }
      return acc
    },
    { deltaCreated: 0, byStatus: {} as Record<string, number> },
  )

  return jsonResponse({
    ran: eligibleIds.length,
    ...totals,
    users: userResults,
  })
}
