import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, isNull, inArray } from 'drizzle-orm'
import { runContradictionScanForUser } from '@/lib/kairos/contradiction'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { embeddingsEnabled } from '@/lib/kairos/embeddings'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Contradiction detection cron (propose-not-commit, L1 autonomy).
//
// Per eligible user (has a non-archived Dominion, an active BYOK credential,
// AND an embedding provider configured — candidate retrieval is vector-only):
// scan recently-touched beliefs against their nearest semantic neighbours and
// stage grounded contradictions as `inbound` proposals for the operator to
// accept (supersedes the loser) or dismiss (archive). Idempotent per UTC day.
// Auth + per-user iteration mirror app/api/cron/introspection; the
// embeddings guard mirrors app/api/cron/memory-dedup. Suggested schedule:
// daily ~05:00 UTC, after the 04:00 embed-backfill so same-day beliefs
// already have a vector.
// ─────────────────────────────────────────────────────────────────────────

// 800s (Pro/fluid ceiling): a failure night doubles model calls per Dominion
// (generate + repair) — 300s timed out mid-fleet with no trace (2026-07-23 504).
export const maxDuration = 800

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  if (!embeddingsEnabled()) {
    return jsonResponse(
      { error: 'embeddings_disabled', note: 'Set VOYAGE_API_KEY or OPENAI_API_KEY to enable.' },
      { status: 200 },
    )
  }

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
    results: Awaited<ReturnType<typeof runContradictionScanForUser>>
    error?: string
  }> = []

  for (const userId of eligibleIds) {
    try {
      userResults.push({ userId, results: await runContradictionScanForUser(userId) })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'contradiction-scan', reason: 'uncaught_exception', error: err })
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
