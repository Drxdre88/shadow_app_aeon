import type { DailyDeliveredEvent, MomentDaily, OwnerDecisionEvent, SpeakPolicyContext, SpeakPolicyVerdict } from '@/lib/kairos/moment/types'
import { repairMode, type RapportMode } from './flag'
import { isBackingOff, markRepaired, recordSoft, repairOpening } from './repair'

// Repair timing: while backing off (or a repair is owed) unprompted,
// non-forced, non-urgent speaks are blocked (429). Forced sends (the 06:00
// message, owner pulses) and urgency:high pass; the forced ceiling, awaiting
// gate and cadence caps in deliverKairosSpeak are untouched. observe logs only.

export const IGNORED_SIGNAL_MIN = 2

interface PolicyDeps {
  mode?: RapportMode
  listIgnored?: (userId: string, now: Date) => Promise<string[]>
}

export async function rapportSpeakPolicy(ctx: SpeakPolicyContext, deps: PolicyDeps = {}): Promise<SpeakPolicyVerdict | null> {
  const mode = deps.mode ?? repairMode()
  if (mode === 'off' || ctx.input.force || ctx.input.urgency === 'high') return null
  const data = await import('@/lib/data/kairos-rapport')
  const ignored = await (deps.listIgnored ?? data.listIgnoredKairosSpeakIds)(ctx.userId, ctx.now)
  const rupture = ignored.length < IGNORED_SIGNAL_MIN
    ? (await data.readKairosRapport(ctx.userId, ctx.now)).rupture
    : await data.mutateKairosRapport(ctx.userId, (state) => {
      const signal = { at: ctx.now.toISOString(), kind: 'ignored' as const, ref: `ignored:${ignored[0]}`.slice(0, 100) }
      const next = { ...state, rupture: recordSoft(state.rupture, signal, ctx.now) }
      return { state: next, result: next.rupture }
    }, ctx.now)
  if (!isBackingOff(rupture)) return null
  const reason = `rapport_${rupture.state}${rupture.reason ? `:${rupture.reason}` : ''}`
  if (mode === 'observe') {
    console.info('[kairos:rapport] observe — would block speak', { reason, title: ctx.input.title.slice(0, 80) })
    return null
  }
  return { block: { status: 429, reason } }
}

// A dismissed Kairos speak is a soft rupture signal (reply-rate credit unchanged).
export async function rapportOwnerDecision(event: OwnerDecisionEvent, deps: { mode?: RapportMode; now?: Date } = {}): Promise<void> {
  const mode = deps.mode ?? repairMode()
  if (mode === 'off' || event.verdict !== 'dismiss' || !event.kairosSpeak) return
  const now = deps.now ?? new Date()
  const data = await import('@/lib/data/kairos-rapport')
  await data.mutateKairosRapport(event.userId, (state) => {
    const signal = { at: now.toISOString(), kind: 'dismissed' as const, ref: `dismissed:${event.memoryId}`.slice(0, 100) }
    return { state: { ...state, rupture: recordSoft(state.rupture, signal, now) }, result: undefined }
  }, now)
}

// 06:00: still sent while backing off; an owed repair leads the message.
export async function rapportDaily(userId: string, now: Date, deps: { mode?: RapportMode } = {}): Promise<MomentDaily | null> {
  if ((deps.mode ?? repairMode()) !== 'on') return null
  const data = await import('@/lib/data/kairos-rapport')
  const state = await data.readKairosRapport(userId, now)
  if (state.rupture.state !== 'repair_owed') return null
  return { openings: [repairOpening(state.rupture)] }
}

export async function rapportDailyDelivered(event: DailyDeliveredEvent, deps: { mode?: RapportMode } = {}): Promise<void> {
  if ((deps.mode ?? repairMode()) !== 'on') return
  const openings = event.moment?.openings ?? []
  if (openings.length === 0) return
  const data = await import('@/lib/data/kairos-rapport')
  await data.mutateKairosRapport(event.userId, (state) => {
    const r = state.rupture
    if (r.state !== 'repair_owed' || !openings.includes(repairOpening(r))) return { state: null, result: undefined }
    return { state: { ...state, rupture: markRepaired(r, 'daily', event.now) }, result: undefined }
  }, event.now)
}
