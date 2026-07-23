import { jsonResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { deliverKairosSpeak, speakSchema } from '@/lib/kairos/speak'

// ─────────────────────────────────────────────────────────────────────────
// Kairos speaks first — POST /api/v1/kairos/speak.
//
// Kairos-initiated delivery: automation (cron recipes, Claude Code hooks,
// housekeeping) posts here when Kairos has something to say. The message
// always lands in the Will inbox as a `notify` item; Telegram fan-out is
// best-effort and must never fail the request.
//
// Deliberately OUTSIDE the MCP/REST parity surface (no MCP mirror) — this
// is an internal delivery channel, not an operator-facing data tool.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}`, same idiom as app/api/cron/*.
// In dev the request is accepted without auth so the route can be curl'd.
//
// The throttle + capture + Telegram fan-out logic lives in
// lib/kairos/speak.ts so internal server-side callers (synthesis-health's
// 2-strike alert) can invoke it directly instead of a self-fetch.
// ─────────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorUserId) {
    return jsonResponse(
      { error: 'KAIROS_OPERATOR_USER_ID is not set — cannot resolve the operator to speak to' },
      { status: 500 },
    )
  }

  const json = await req.json().catch(() => null)
  const parsed = speakSchema.safeParse(json)
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const outcome = await deliverKairosSpeak(operatorUserId, parsed.data)
  return jsonResponse(outcome.body, { status: outcome.status })
}
