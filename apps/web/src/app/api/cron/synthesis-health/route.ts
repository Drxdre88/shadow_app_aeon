import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import { computeSynthesisHealth, type SynthesisHealthResult } from '@/lib/kairos/synthesis-health'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { canUseVorath } from '@/lib/vorath-access'
import { chatRoutineEnabled } from '@/lib/kairos/chat-routine'
import { writeChatLatencyRollup } from '@/lib/kairos/chat-latency-rollup'

// ─────────────────────────────────────────────────────────────────────────
// Synthesis reliability (docs/kairos/31, B3) — daily synthesis health rollup.
//
// Pure SQL read over each user's own trace history — no LLM/BYOK involved.
// Runs at 04:25 UTC: after the night's core synthesis (memory engine →
// cortex → aether, done by ~03:30) and before the 06:00 London daily message
// is drafted (the 04:40Z brain-routine run in summer), which only reads a rollup from the same
// London date. Stages that run later (ask-mine, idea tournament) show their
// last completed night. Idempotent: computeSynthesis-
// Health stamps one rollup memory per UTC day via externalId, so a retry
// (or a manual re-curl) is a no-op rather than a duplicate.
//
// Auth + per-user iteration mirror the other Kairos cron routes.
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

  const userIds = usersWithDominions.map((r) => r.userId).filter((userId) => canUseVorath(userId))
  const users: Array<{ userId: string; result?: SynthesisHealthResult; error?: string }> = []
  const chatRoutineOn = chatRoutineEnabled()

  for (const userId of userIds) {
    // Yesterday's chat-routine latency first, so today's rollup sees it as
    // an ok `chat-routine` stage. Best-effort (never throws).
    if (chatRoutineOn) await writeChatLatencyRollup(userId)
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
