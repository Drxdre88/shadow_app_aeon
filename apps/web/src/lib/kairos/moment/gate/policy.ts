import type { SpeakInput } from '@/lib/kairos/speak'
import type { SpeakPolicyContext, SpeakPolicyVerdict } from '../types'
import { detectBreak, withTrigger, type BreakReason, type BreakTrigger } from './break'
import { coldHourHolds, gateLimits, receptivityMode, type GateMode } from './flag'
import { isColdNow } from './receptivity'
import { loadGateSignals } from './signals'

// Speak-time decision for the Kairos gate. 'observe' computes and logs the
// would-be decision and always sends; 'on' holds until a natural break, at
// most KAIROS_GATE_MAX_HOLD_MIN. lib/data is imported lazily.

const MIN_MS = 60_000

// Never gateable: ops alerts, the 06:00 / Monday digests, urgency high. A
// forced send is gateable only when its caller opted in (promise nudge).
export function isGateable(input: Pick<SpeakInput, 'opsAlert' | 'digest' | 'urgency' | 'force'>, gate: boolean): boolean {
  if (input.opsAlert || input.digest || input.urgency === 'high') return false
  return input.force ? gate : true
}

export type MomentReason = BreakReason | 'cold_hour'

export interface MomentDecision {
  action: 'send' | 'hold'
  reason: MomentReason
  cold: boolean
}

// Break verdict, then the receptivity map: an idle/quiet send in a cold
// London hour becomes a cold_hour hold (only when receptivity is live).
export async function decideMoment(userId: string, now: Date, trigger: BreakTrigger | null = null): Promise<MomentDecision> {
  const limits = gateLimits()
  const signals = withTrigger(await loadGateSignals(userId, now, limits.awayMin), trigger, now)
  const verdict = detectBreak(signals, now, limits)
  if (verdict.action === 'hold' || (verdict.reason !== 'idle' && verdict.reason !== 'quiet') || receptivityMode() === 'off') {
    return { ...verdict, cold: false }
  }
  const { readKairosGate } = await import('@/lib/data/kairos-gate')
  const cold = isColdNow((await readKairosGate(userId)).receptivity, now)
  if (cold && coldHourHolds()) return { action: 'hold', reason: 'cold_hour', cold }
  return { ...verdict, cold }
}

async function logDecision(userId: string, now: Date, mode: GateMode, d: MomentDecision): Promise<void> {
  try {
    const { appendKairosGateLog } = await import('@/lib/data/kairos-gate')
    await appendKairosGateLog(userId, [{ at: now.toISOString(), memoryId: null, mode, decision: d.action, reason: d.reason, ...(d.cold ? { cold: true } : {}) }])
  } catch (err) {
    console.warn('[kairos:gate] decision log failed', err instanceof Error ? err.message : String(err))
  }
}

export async function decideSpeakPolicy(ctx: SpeakPolicyContext, mode: Exclude<GateMode, 'off'>): Promise<SpeakPolicyVerdict | null> {
  const decision = await decideMoment(ctx.userId, ctx.now)
  await logDecision(ctx.userId, ctx.now, mode, decision)
  if (mode !== 'on' || decision.action !== 'hold') return null
  const until = new Date(ctx.now.getTime() + gateLimits().maxHoldMin * MIN_MS).toISOString()
  return { hold: { until, reason: decision.reason } }
}
