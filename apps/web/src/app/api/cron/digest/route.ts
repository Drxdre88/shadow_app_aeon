import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { runEveningDigestForUser } from '@/lib/kairos/digest'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Evening Digest cron (guaranteed-daily register, docs/kairos/29 note).
//
// Single-operator convention (matches /api/v1/kairos/speak + the
// synthesis-health 2-strike alert): KAIROS_OPERATOR_USER_ID resolves the one
// delivery target — no per-user loop. runEveningDigestForUser owns every
// failure mode internally (already-ran-today, model failure -> deterministic
// fallback, uncaught gather exception) and never throws, so this route
// always returns 200 with a JSON body describing the outcome.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorUserId) {
    return jsonResponse({ ran: false, reason: 'KAIROS_OPERATOR_USER_ID unset' })
  }

  const result = await runEveningDigestForUser(operatorUserId)
  return jsonResponse({ ran: true, ...result })
}
