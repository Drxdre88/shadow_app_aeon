import { z } from 'zod'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { AWAIT_WINDOW_HOURS, getConversationState } from '@/lib/kairos/engagement'
import { sendKairosSpeak, type InlineKeyboardButton } from '@/lib/kairos/telegram'
import { recordToday } from '@/lib/kairos/today'
import type { SpeakMomentOptions } from '@/lib/kairos/moment/types'

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
  // never consume the gap/cap cadence budget. (Only kind:'question' arms
  // awaitingReply — see getConversationState.)
  digest: z.boolean().default(false),
  // Atomic idempotency key (F2, horsemen review) — forwarded into
  // captureMemory's own (source, externalId) dedup so two concurrent callers
  // racing the same logical send (e.g. two cron overlaps) fan out at most
  // once. Optional: callers without one get byte-identical prior behavior.
  externalId: z.string().trim().min(1).max(255).optional(),
})

export type SpeakInput = z.infer<typeof speakSchema>

export type SpeakOutcome =
  | { status: 200; body: { id: string; delivered: { inbox: boolean; telegram: boolean }; alreadyDelivered?: boolean; held?: { until: string } } }
  | { status: 429; body: Record<string, unknown> }

// Server-side interrupt throttle: an unprompted Kairos message is only
// valuable while it is rare, and the guard must hold for EVERY caller (tick
// routines, hooks, future recipes), so it lives here rather than in any one
// scheduler's prompt. All callers share one CRON_SECRET, so `force` is a
// convention, not an identity check — forced sends are logged and still
// bounded by an absolute ceiling to cap the blast radius of a runaway
// automation that sets it anyway.
const FORCE_CEILING = 10

// Defence in depth (research/kairos_2909 A1): internal callers bypass
// speakSchema, so a runaway model output could otherwise be stored and
// chunked to Telegram whole. Truncate rather than reject so no caller breaks.
export const SPEAK_MESSAGE_MAX_CHARS = 4000
const TRUNCATION_MARK = '…'

export function capSpeakMessage(message: string, max: number = SPEAK_MESSAGE_MAX_CHARS): string {
  if (message.length <= max) return message
  const hardCut = message.slice(0, max - TRUNCATION_MARK.length)
  // Prefer a paragraph, line or word boundary in the last quarter of the budget.
  const floor = Math.floor(hardCut.length * 0.75)
  const boundary = Math.max(
    hardCut.lastIndexOf('\n\n'),
    hardCut.lastIndexOf('\n'),
    hardCut.lastIndexOf(' '),
  )
  const cut = boundary >= floor ? hardCut.slice(0, boundary) : hardCut
  return `${cut.trimEnd()}${TRUNCATION_MARK}`
}

export interface FanOutSpeakInput {
  userId: string
  memoryId: string
  title: string
  message: string
  kind: SpeakInput['kind']
  opsAlert: boolean
}

// Telegram-only extras for one fan-out; never stored.
export type FanOutSpeakOptions = { telegramTail?: string; telegramKeyboard?: InlineKeyboardButton[][] }

// opts.telegramTail: Telegram-only text appended to the sent message (the 06:00
// dream line). Never stored — the inbox capture and the today log see `message`
// alone — so it can never be retrieved, distilled or quoted back as memory.
// opts.gate / opts.telegramKeyboard: wave 4 moment seam (lib/kairos/moment/types.ts).
export async function deliverKairosSpeak(
  operatorUserId: string,
  input: SpeakInput,
  opts: { telegramTail?: string } & SpeakMomentOptions = {},
): Promise<SpeakOutcome> {
  const { title, kind, urgency, force, opsAlert, digest, externalId } = input
  const message = capSpeakMessage(input.message)

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

  // replyRate7d is 0 both for "no recent sends" and "all recent sends unanswered";
  // the 7-day lookup disambiguates. Deliberately not keyed on lastOutbound, which
  // only tracks questions (the reply gate) and would hide an unanswered notify run.
  if (!force && state.replyRate7d >= 0.5) {
    gapHours = 4
    cap = 3
  } else if (!force && state.replyRate7d === 0) {
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

  // Wave 4 moment policies (loaded on use): may only block or hold, never relax.
  const moment = await import('./moment')
  const now = new Date()
  const verdict = opsAlert || !moment.hasMomentHook('speakPolicy')
    ? null
    : await moment.runSpeakPolicies({
      userId: operatorUserId,
      input: { ...input, message },
      gate: opts.gate === true,
      awaitingReply: state.awaitingReply,
      replyRate7d: state.replyRate7d,
      now,
    })
  if (verdict?.block) return { status: 429, body: { error: 'moment_blocked', reason: verdict.block.reason } }
  // Telegram-only extras are never stored, so a hold would lose them at release: such a send goes out now.
  const hasTelegramExtras = Boolean(opts.telegramTail?.trim() || opts.telegramKeyboard?.length)
  const hold = verdict?.hold && !hasTelegramExtras ? { heldAt: now.toISOString(), until: verdict.hold.until, reason: verdict.hold.reason } : null

  const { memory, created } = await captureMemory(operatorUserId, {
    title,
    bodyMd: message,
    summary: message.slice(0, 1000),
    type: 'inbound',
    source: 'system',
    sourceMetadata: {
      kairosSpeak: true,
      status: hold ? 'held' : 'pending',
      kind,
      urgency,
      ...(opsAlert ? { opsAlert: true } : {}),
      ...(digest ? { digest: true } : {}),
      ...(externalId ? { externalId } : {}),
      ...(hold ? { gate: hold } : {}),
    },
  })

  // A dedup hit means an earlier call with the same externalId already ran
  // the Telegram/web-push fan-out — resending here would double-deliver.
  if (!created) {
    return { status: 200, body: { id: memory.id, delivered: { inbox: false, telegram: false }, alreadyDelivered: true } }
  }
  // Held: the today log and Telegram happen at release (fanOutSpeak).
  if (hold) return { status: 200, body: { id: memory.id, delivered: { inbox: false, telegram: false }, held: { until: hold.until } } }

  const telegram = await fanOutSpeak({ userId: operatorUserId, memoryId: memory.id, title, message, kind, opsAlert }, opts)
  if (moment.hasMomentHook('speakDelivered')) {
    await moment.runSpeakDelivered({ userId: operatorUserId, memoryId: memory.id, input: { ...input, message }, telegram, now })
  }

  return { status: 200, body: { id: memory.id, delivered: { inbox: true, telegram } } }
}

// Today log + Telegram for a speak row already in the inbox (a new speak, or a
// held one at release). Returns whether Telegram delivered; never throws.
export async function fanOutSpeak(params: FanOutSpeakInput, opts: FanOutSpeakOptions = {}): Promise<boolean> {
  const { userId, memoryId, title, message, kind, opsAlert } = params
  // Today log: what Kairos said, once per new speak (ops alerts are health
  // signals, not something he said to the owner). recordToday never throws.
  if (!opsAlert) {
    await recordToday(
      userId,
      { key: `speak:${memoryId}`, channel: 'kairos', type: 'spoke', text: `${title}: ${message}`, ref: { memoryId } },
      { kind: 'kairos', via: 'speak' },
    )
  }

  let telegram = false
  const tail = opts.telegramTail?.trim()
  const keyboard = opts.telegramKeyboard?.length ? { keyboard: opts.telegramKeyboard } : {}
  try {
    telegram = await sendKairosSpeak({ memoryId, title, message: tail ? `${message}\n\n${tail}` : message, kind, ...keyboard })
  } catch (err) {
    console.error('[kairos-speak] telegram fan-out failed', err)
  }
  return telegram
}
