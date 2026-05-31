import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { runBrieferForUser } from '@/lib/kairos/briefer'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (E20) — daily Briefer cron endpoint.
//
// Triggered by Vercel Cron at 07:00 UTC daily. Iterates every user that
// has at least one active BYOK credential AND at least one non-archived
// Dominion, then runs the Briefer for each.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. In dev
// the request is accepted without auth so the route can be hit by curl.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  if (usersWithDominions.length === 0) {
    return NextResponse.json({ ran: 0, users: [] })
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

  const userResults: Array<{ userId: string; results: Awaited<ReturnType<typeof runBrieferForUser>>; error?: string }> = []
  for (const userId of eligibleIds) {
    try {
      const results = await runBrieferForUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
      userResults.push({ userId, results: [], error: err instanceof Error ? err.message : String(err) })
    }
  }

  const totalCreated = userResults.reduce(
    (n, u) => n + u.results.filter((r) => r.status === 'created').length,
    0,
  )

  return NextResponse.json({
    ran: eligibleIds.length,
    advisoriesCreated: totalCreated,
    users: userResults,
  })
}
