import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userAiCredentials, dominions } from '@/lib/db/schema'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { findDominionsByUser } from '@/lib/data/dominions'
import { runRecipe } from '@/lib/kairos/dispatch'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — daily Briefer cron endpoint, dispatcher-driven.
//
// Triggered by Vercel Cron at 07:00 UTC daily. Iterates every user that
// has at least one active BYOK credential AND at least one non-archived
// Dominion, then runs the BRIEF recipe per active Dominion via runRecipe.
//
// Response shape preserved from Phase 1 so the dashboard polling UI is
// unaffected: { ran, advisoriesCreated, users: [{ userId, results, error? }] }
// where each `results` entry mirrors the legacy BrieferResult shape.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. In dev
// the request is accepted without auth so the route can be hit by curl.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

interface BrieferResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped'
  memoryId?: string
  reason?: string
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

async function briefUser(userId: string): Promise<BrieferResult[]> {
  const doms = await findDominionsByUser(userId)
  const active = doms.filter((d) => !d.archivedAt)
  const out: BrieferResult[] = []

  for (const dom of active) {
    try {
      const run = await runRecipe('BRIEF', {
        userId,
        dominionId: dom.id,
        surface: 'byok',
      })
      out.push({
        dominionId: dom.id,
        dominionName: dom.name,
        status: run.status,
        memoryId: run.memoryId,
      })
    } catch (err) {
      if (err instanceof AiCredentialMissingError) {
        out.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' })
        continue
      }
      if (err instanceof AiCredentialDecryptError) {
        out.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'key undecryptable' })
        continue
      }
      const msg = err instanceof Error ? err.message : String(err)
      // Per-Dominion recipe-level skips surface as 'skipped' so the UI can
      // distinguish them from outright failures; anything else re-throws
      // and aborts this user's batch (matches Phase 1 behaviour).
      if (msg.startsWith('BRIEF: no Dominion bundle')) {
        out.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'not found' })
        continue
      }
      if (msg.startsWith('BRIEF: empty response')) {
        out.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'empty response' })
        continue
      }
      throw err
    }
  }

  return out
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

  const userResults: Array<{ userId: string; results: BrieferResult[]; error?: string }> = []
  for (const userId of eligibleIds) {
    try {
      const results = await briefUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'briefer', reason: 'uncaught_exception', error: err })
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
