import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, isNull, inArray } from 'drizzle-orm'
import { runArchetypeSynthesisForUser } from '@/lib/kairos/archetypes'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B1) — daily Archetype Synthesis cron endpoint.
//
// Suggested Vercel Cron schedule: 02:30 UTC daily, ahead of the 07:00
// Briefer so the morning briefing can reference the day's archetypes once
// Phase 1B B2 lands (cortex). Idempotent — re-running mid-day is a no-op
// for any Dominion whose archetypes already exist for today.
//
// Auth + iteration mirror app/api/cron/briefer/route.ts. Eligible users
// must have at least one active BYOK credential and at least one
// non-archived Dominion.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  if (usersWithDominions.length === 0) {
    return jsonResponse({ ran: 0, users: [] })
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
    results: Awaited<ReturnType<typeof runArchetypeSynthesisForUser>>
    error?: string
  }> = []

  for (const userId of eligibleIds) {
    try {
      const results = await runArchetypeSynthesisForUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'archetype-synthesis', reason: 'uncaught_exception', error: err })
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
        if (r.status === 'created') {
          acc.archetypesCreated += r.archetypeMemoryIds?.length ?? 0
          acc.priorArchived += r.archivedPrior ?? 0
        }
        acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1
      }
      return acc
    },
    { archetypesCreated: 0, priorArchived: 0, byStatus: {} as Record<string, number> },
  )

  return jsonResponse({
    ran: eligibleIds.length,
    ...totals,
    users: userResults,
  })
}
