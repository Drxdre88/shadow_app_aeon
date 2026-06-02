import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, isNull, inArray } from 'drizzle-orm'
import { runCortexRegenForUser } from '@/lib/kairos/cortex'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B2) — daily Dominion Cortex regen cron endpoint.
//
// Suggested Vercel Cron schedule: 03:00 UTC daily — AFTER 02:30 archetype
// synthesis (so cortex reads today's fresh archetypes), BEFORE 07:00
// Briefer (so the morning briefing can prepend the cortex once B3 wires
// it in). Idempotent — re-running mid-day is a no-op for any Dominion
// whose live cortex already has today's date.
//
// Auth + iteration mirror briefer and archetype-synthesis routes.
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
    // Return the same shape as the populated path so monitoring/alerting
    // that pattern-matches on byStatus / cortexCreated doesn't misfire.
    return NextResponse.json({
      ran: 0,
      cortexCreated: 0,
      priorArchived: 0,
      byStatus: {},
      users: [],
    })
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
    results: Awaited<ReturnType<typeof runCortexRegenForUser>>
    error?: string
  }> = []

  for (const userId of eligibleIds) {
    try {
      const results = await runCortexRegenForUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
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
          acc.cortexCreated += 1
          acc.priorArchived += r.archivedPrior ?? 0
        }
        acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1
      }
      return acc
    },
    { cortexCreated: 0, priorArchived: 0, byStatus: {} as Record<string, number> },
  )

  return NextResponse.json({
    ran: eligibleIds.length,
    ...totals,
    users: userResults,
  })
}
