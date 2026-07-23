import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import { computeSynthesisHealth, type SynthesisHealthResult } from '@/lib/kairos/synthesis-health'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Synthesis reliability (docs/kairos/31, B3) — daily synthesis health rollup.
//
// Pure SQL read over each user's own trace history — no LLM/BYOK involved.
// Runs after the morning briefing (08:00 UTC, a free slot) so the rollup
// covers every generator that fired overnight. Idempotent: computeSynthesis-
// Health stamps one rollup memory per UTC day via externalId, so a retry
// (or a manual re-curl) is a no-op rather than a duplicate.
//
// Auth + per-user iteration mirror apps/web/src/app/api/cron/memory-compaction.
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

  const userIds = usersWithDominions.map((r) => r.userId)
  const users: Array<{ userId: string; result?: SynthesisHealthResult; error?: string }> = []

  for (const userId of userIds) {
    try {
      users.push({ userId, result: await computeSynthesisHealth(userId) })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'synthesis-health', reason: 'uncaught_exception', error: err })
      users.push({ userId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return jsonResponse({
    ran: users.length,
    alertsSent: users.reduce((count, user) => count + (user.result?.newlyAlertedStages.length ?? 0), 0),
    users,
  })
}
