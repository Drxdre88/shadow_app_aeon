import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureMemory } from '@/lib/data/memories'
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
})

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

  const { title, message, kind, urgency } = parsed.data
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
