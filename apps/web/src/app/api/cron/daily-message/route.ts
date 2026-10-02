import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { runDailyMessageForUser } from '@/lib/kairos/daily-message'
import { DAILY_MESSAGE_HOUR, isLondonHour } from '@/lib/kairos/daily-message-prompt'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Daily Message cron (docs/kairos/34 §3). Scheduled at 05:00Z and
// 06:00Z; only the slot that is 06:00 Europe/London runs (BST → 05:00Z,
// GMT → 06:00Z). `?force=1` runs outside the hour (manual); `?dryRun=1`
// composes and returns the message without delivering (any hour). Both still
// require CRON_SECRET. Single-operator: KAIROS_OPERATOR_USER_ID.
// runDailyMessageForUser owns every failure mode and never throws.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function flag(params: URLSearchParams, name: string): boolean {
  const v = params.get(name)
  return v === '1' || v === 'true'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const force = flag(params, 'force')
  const dryRun = flag(params, 'dryRun')
  const now = new Date()

  if (!force && !dryRun && !isLondonHour(now, DAILY_MESSAGE_HOUR)) {
    return jsonResponse({ ran: false, reason: `not ${DAILY_MESSAGE_HOUR}:00 in Europe/London` })
  }

  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorUserId) {
    return jsonResponse({ ran: false, reason: 'KAIROS_OPERATOR_USER_ID unset' })
  }

  const result = await runDailyMessageForUser(operatorUserId, { now, dryRun })
  return jsonResponse({ ran: true, ...result })
}
