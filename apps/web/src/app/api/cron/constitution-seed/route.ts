import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { listUsersForConstitutionSeed } from '@/lib/data/constitution'
import { seedConstitutionDraft, type SeedResult } from '@/lib/kairos/constitution/seed'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos constitution seed (docs/kairos/34 §2). One-shot safe: per eligible
// user (active Dominion + live BYOK credential) with NO constitution and NO
// pending amendment, draft the first constitution from Dominion vision/
// mission/objectives + the top 20 reflections and write it as a PROPOSAL.
// Every later run is a cheap no-op for that user until they dismiss the draft
// (then it re-drafts) — accepting it ends seeding for good.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const userIds = await listUsersForConstitutionSeed()
  const users: Array<{ userId: string; result?: SeedResult; error?: string }> = []

  for (const userId of userIds) {
    try {
      const result = await seedConstitutionDraft(userId)
      users.push({ userId, result })
      if (result.status === 'error') {
        await writeCronFailureTrace(userId, { cronName: 'constitution-seed', reason: result.reason })
      } else if (result.status === 'created') {
        await writeCronSuccessTrace(userId, { cronName: 'constitution-seed' })
      }
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'constitution-seed', reason: 'uncaught_exception', error: err })
      users.push({ userId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return jsonResponse({
    ran: userIds.length,
    created: users.filter((u) => u.result?.status === 'created').length,
    users,
  })
}
