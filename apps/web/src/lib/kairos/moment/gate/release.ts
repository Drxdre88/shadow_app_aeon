import type { GateLogEntry } from '@/lib/data/validators/kairos-gate'
import type { BreakTrigger } from './break'
import { gateMode } from './flag'
import { decideMoment, type MomentDecision } from './policy'

// Releases held speaks: oldest first, at most RELEASE_MAX_PER_CALL per call
// while the gate is on. A row goes out when its deadline passed or the moment
// is a natural break. With the gate off (or observe) every held row is flushed
// so switching the flag off never strands a message. Each row is claimed
// atomically (held → pending) before fanOutSpeak, so a release is single-flight;
// a Telegram failure leaves it pending in the inbox. Release never creates rows,
// so the cadence caps and the forced ceiling stay as enforced at capture.

export const RELEASE_MAX_PER_CALL = 2
export const FLUSH_MAX = 50

export type ReleaseTrigger = 'tick' | BreakTrigger

export interface ReleasedSpeak {
  id: string
  reason: string
  telegram: boolean
}

export interface ReleaseResult {
  trigger: ReleaseTrigger
  released: ReleasedSpeak[]
  remaining: number
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function pastDeadline(meta: Record<string, unknown>, now: Date): boolean {
  const until = Date.parse(String(record(meta.gate).until ?? ''))
  return !Number.isFinite(until) || until <= now.getTime()
}

export async function releaseHeldSpeaks(userId: string, now: Date, trigger: ReleaseTrigger): Promise<ReleaseResult | null> {
  const mode = gateMode()
  const live = mode === 'on'
  const data = await import('@/lib/data/kairos-gate')
  const held = await data.listHeldSpeaks(userId, live ? 20 : FLUSH_MAX)
  if (held.length === 0) return null

  let decision: MomentDecision | null = null
  const released: ReleasedSpeak[] = []
  const log: GateLogEntry[] = []
  for (const row of held) {
    if (live && released.length >= RELEASE_MAX_PER_CALL) break
    let reason: string
    if (!live) reason = 'flush'
    else if (pastDeadline(record(row.sourceMetadata), now)) reason = 'deadline'
    else {
      decision ??= await decideMoment(userId, now, trigger === 'tick' ? null : trigger)
      if (decision.action !== 'send') continue
      reason = decision.reason
    }

    const claimed = await data.claimHeldSpeak(userId, row.id, now, reason)
    if (!claimed) continue
    const meta = record(claimed.sourceMetadata)
    const { fanOutSpeak } = await import('@/lib/kairos/speak')
    const telegram = await fanOutSpeak({
      userId,
      memoryId: claimed.id,
      title: claimed.title,
      message: claimed.bodyMd,
      kind: meta.kind === 'question' ? 'question' : 'notify',
      opsAlert: false,
    })
    if (!telegram) console.warn('[kairos:gate] released speak not delivered to Telegram (stays in the inbox)', claimed.id)
    released.push({ id: claimed.id, reason, telegram })
    log.push({ at: now.toISOString(), memoryId: claimed.id, mode, decision: 'release', reason })
  }

  try {
    await data.appendKairosGateLog(userId, log)
  } catch (err) {
    console.warn('[kairos:gate] release log failed', err instanceof Error ? err.message : String(err))
  }
  return { trigger, released, remaining: held.length - released.length }
}
