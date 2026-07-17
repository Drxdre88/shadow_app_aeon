import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { sendKairosSpeak } from '@/lib/kairos/telegram'

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
// ─────────────────────────────────────────────────────────────────────────

const speakSchema = z.object({
  title: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(20_000),
  kind: z.enum(['notify', 'question']).default('notify'),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),
  // Operator-initiated pulses bypass the throttle; automation must not set it.
  force: z.boolean().default(false),
})

// Server-side interrupt throttle: an unprompted Kairos message is only
// valuable while it is rare, and the guard must hold for EVERY caller (tick
// routines, hooks, future recipes), so it lives here rather than in any one
// scheduler's prompt. All callers share one CRON_SECRET, so `force` is a
// convention, not an identity check — forced sends are logged and still
// bounded by an absolute ceiling to cap the blast radius of a runaway
// automation that sets it anyway.
const MIN_GAP_HOURS = 4
const DAILY_CAP = 3
const FORCE_CEILING = 10

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorUserId) {
    return NextResponse.json(
      { error: 'KAIROS_OPERATOR_USER_ID is not set — cannot resolve the operator to speak to' },
      { status: 500 },
    )
  }

  const json = await req.json().catch(() => null)
  const parsed = speakSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { title, message, kind, urgency, force } = parsed.data

  const recent = await listRecentKairosSpeaks(operatorUserId, { hours: 24 })
  const last = recent[0]
  const gapMs = last ? Date.now() - last.createdAt.getTime() : Infinity
  const overLimit = force
    ? recent.length >= FORCE_CEILING
    : recent.length >= DAILY_CAP || gapMs < MIN_GAP_HOURS * 60 * 60 * 1000
  if (overLimit) {
    return NextResponse.json(
      {
        error: 'throttled',
        lastSpokeAt: last?.createdAt ?? null,
        spokenLast24h: recent.length,
      },
      { status: 429 },
    )
  }
  if (force && recent.length > 0) {
    console.warn('[kairos-speak] forced throttle bypass', { spokenLast24h: recent.length })
  }

  const { memory } = await captureMemory(operatorUserId, {
    title,
    bodyMd: message,
    summary: message.slice(0, 1000),
    type: 'inbound',
    source: 'system',
    sourceMetadata: { kairosSpeak: true, status: 'pending', kind, urgency },
  })

  let telegram = false
  try {
    telegram = await sendKairosSpeak({ memoryId: memory.id, title, message, kind })
  } catch (err) {
    console.error('[kairos-speak] telegram fan-out failed', err)
  }

  return NextResponse.json({ id: memory.id, delivered: { inbox: true, telegram } })
}
