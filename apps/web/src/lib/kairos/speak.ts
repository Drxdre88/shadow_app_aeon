import { z } from 'zod'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { AWAIT_WINDOW_HOURS, getConversationState } from '@/lib/kairos/engagement'
import { sendKairosSpeak } from '@/lib/kairos/telegram'

// ─────────────────────────────────────────────────────────────────────────
// Kairos speaks first — delivery logic shared by POST /api/v1/kairos/speak
// (external callers: brain-tick, ask-mine's flow, Telegram-facing automation)
// and internal server-side callers (synthesis-health's 2-strike alert, docs/
// kairos/31 B4) that need the same Will-inbox + Telegram fan-out without an
// HTTP self-fetch round trip. Speak fan-out and inbox capture stay owned by
// this module — nothing else talks to Telegram outbound (docs/kairos/30).
// ─────────────────────────────────────────────────────────────────────────

export const speakSchema = z.object({
  title: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(20_000),
  kind: z.enum(['notify', 'question']).default('notify'),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),
  // Operator-initiated pulses bypass the throttle; automation must not set it.
  force: z.boolean().default(false),
  // Synthesis reliability (docs/kairos/31, B5) — system health signals, not
  // conversational turns. Persisted so listRecentKairosSpeaks can exclude
  // them from Kairos's gap/cap cadence bookkeeping.
  opsAlert: z.boolean().default(false),
  // Evening Digest (docs/kairos/29 note) — a guaranteed-daily register, not
  // a conversational turn. Same exclusion treatment as opsAlert: it must
  // never consume the gap/cap cadence budget or set awaitingReply.
  digest: z.boolean().default(false),
  // Atomic idempotency key (F2, horsemen review) — forwarded into
  // captureMemory's own (source, externalId) dedup so two concurrent callers
  // racing the same logical send (e.g. two cron overlaps) fan out at most
  // once. Optional: callers without one get byte-identical prior behavior.
  externalId: z.string().trim().min(1).max(255).optional(),
})

export type SpeakInput = z.infer<typeof speakSchema>

export type SpeakOutcome =
  | { status: 200; body: { id: string; delivered: { inbox: boolean; telegram: boolean }; alreadyDelivered?: boolean } }
  | { status: 429; body: Record<string, unknown> }

// Server-side interrupt throttle: an unprompted Kairos message is only
// valuable while it is rare, and the guard must hold for EVERY caller (tick
// routines, hooks, future recipes), so it lives here rather than in any one
// scheduler's prompt. All callers share one CRON_SECRET, so `force` is a
// convention, not an identity check — forced sends are logged and still
// bounded by an absolute ceiling to cap the blast radius of a runaway
// automation that sets it anyway.
const FORCE_CEILING = 10

export async function deliverKairosSpeak(operatorUserId: string, input: SpeakInput): Promise<SpeakOutcome> {
  const { title, message, kind, urgency, force, opsAlert, digest, externalId } = input

  const state = await getConversationState(operatorUserId)
  if (state.awaitingReply && !force && urgency !== 'high') {
    return {
      status: 429,
      body: {
        error: 'awaiting_reply',
        lastOutboundAt: state.lastOutbound!.createdAt,
        expiresAt: new Date(
          state.lastOutbound!.createdAt.getTime() + AWAIT_WINDOW_HOURS * 60 * 60 * 1000,
        ),
      },
    }
  }

  let gapHours = 8
  let cap = 2
  let cadenceWindowHours = 24

  if (!force && state.replyRate7d >= 0.5) {
    gapHours = 4
    cap = 3
  } else if (!force && state.replyRate7d === 0 && state.lastOutbound) {
    const recent7d = await listRecentKairosSpeaks(operatorUserId, { hours: 168, limit: 3 })
    if (recent7d.length >= 3) {
      gapHours = 24
      cap = 1
      cadenceWindowHours = 72
    }
  }

  const recent = await listRecentKairosSpeaks(operatorUserId, {
    hours: force ? 24 : cadenceWindowHours,
    limit: FORCE_CEILING,
  })
  const last = recent[0]
  const gapMs = last ? Date.now() - last.createdAt.getTime() : Infinity
  const overLimit = force
    ? recent.length >= FORCE_CEILING
    : recent.length >= cap || gapMs < gapHours * 60 * 60 * 1000
  if (overLimit) {
    return {
      status: 429,
      body: {
        error: 'throttled',
        lastSpokeAt: last?.createdAt ?? null,
        spokenLast24h: recent.length,
      },
    }
  }
  if (force && recent.length > 0) {
    console.warn('[kairos-speak] forced throttle bypass', { spokenLast24h: recent.length })
  }

  const { memory, created } = await captureMemory(operatorUserId, {
    title,
    bodyMd: message,
    summary: message.slice(0, 1000),
    type: 'inbound',
    source: 'system',
    sourceMetadata: {
      kairosSpeak: true,
      status: 'pending',
      kind,
      urgency,
      ...(opsAlert ? { opsAlert: true } : {}),
      ...(digest ? { digest: true } : {}),
      ...(externalId ? { externalId } : {}),
    },
  })

  // A dedup hit means an earlier call with the same externalId already ran
  // the Telegram/web-push fan-out — resending here would double-deliver.
  if (!created) {
    return { status: 200, body: { id: memory.id, delivered: { inbox: false, telegram: false }, alreadyDelivered: true } }
  }

  let telegram = false
  try {
    telegram = await sendKairosSpeak({ memoryId: memory.id, title, message, kind })
  } catch (err) {
    console.error('[kairos-speak] telegram fan-out failed', err)
  }

  return { status: 200, body: { id: memory.id, delivered: { inbox: true, telegram } } }
}
