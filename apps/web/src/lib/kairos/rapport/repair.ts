import {
  RAPPORT_MAX_COOLDOWN_H,
  RAPPORT_MAX_SOFT,
  RAPPORT_MIN_COOLDOWN_H,
  RAPPORT_SOFT_WINDOW_MS,
  type RapportRupture,
  type RapportSoft,
  type RuptureReason,
} from '@/lib/data/validators/kairos-rapport'

// Rupture / repair state machine (pure).
//  steady ──1 strong ("not now") or 2 distinct soft signals in 72h──▶ backing_off
//  backing_off ──cooldown elapsed (and no repair in the last 7 days)──▶ repair_owed
//  repair_owed ──repair delivered (chat reply or 06:00 opening)──▶ repaired
//  repaired ──next owner message──▶ steady (cooldown resets)
//  repaired via 06:00 + 48h silence ──▶ backing_off, cooldown doubled (max 168h)
//  repaired via chat + 72h ──▶ steady

const HOUR_MS = 3_600_000
export const REPAIR_MIN_GAP_MS = 7 * 24 * HOUR_MS
export const REPAIRED_SILENCE_MS = 48 * HOUR_MS
export const REPAIRED_SETTLE_MS = 72 * HOUR_MS
export const SOFT_ENTRY_COUNT = 2

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN)
const doubled = (h: number): number => Math.min(RAPPORT_MAX_COOLDOWN_H, Math.max(RAPPORT_MIN_COOLDOWN_H, h * 2))

export function emptyRupture(now: Date): RapportRupture {
  return { state: 'steady', since: now.toISOString(), soft: [], cooldownH: RAPPORT_MIN_COOLDOWN_H }
}

export const isBackingOff = (r: RapportRupture): boolean => r.state === 'backing_off' || r.state === 'repair_owed'

function pruneSoft(soft: readonly RapportSoft[], now: Date): RapportSoft[] {
  const floor = now.getTime() - RAPPORT_SOFT_WINDOW_MS
  return soft.filter((s) => ms(s.at) >= floor).slice(-RAPPORT_MAX_SOFT)
}

function enterBackingOff(r: RapportRupture, reason: RuptureReason, now: Date, trigger?: string): RapportRupture {
  return {
    state: 'backing_off',
    since: now.toISOString(),
    reason,
    ...(trigger ? { trigger: trigger.slice(0, 120) } : {}),
    soft: r.soft,
    ...(r.lastRepairAt ? { lastRepairAt: r.lastRepairAt } : {}),
    cooldownH: r.state === 'repaired' ? doubled(r.cooldownH) : r.cooldownH,
  }
}

export function recordNotNow(r: RapportRupture, trigger: string, now: Date): RapportRupture {
  return enterBackingOff(r, 'not_now', now, trigger.trim())
}

export function recordSoft(r: RapportRupture, signal: RapportSoft, now: Date): RapportRupture {
  if (r.soft.some((s) => s.ref === signal.ref)) return { ...r, soft: pruneSoft(r.soft, now) }
  const soft = pruneSoft([...r.soft, signal], now)
  const next = { ...r, soft }
  if (isBackingOff(r) || soft.length < SOFT_ENTRY_COUNT) return next
  return enterBackingOff(next, signal.kind, now)
}

// Time-driven transitions; applied on every read and write.
export function advanceRupture(r: RapportRupture, now: Date, lastOwnerAt: string | null): RapportRupture {
  const t = now.getTime()
  const soft = pruneSoft(r.soft, now)
  const base = { ...r, soft }
  if (r.state === 'backing_off') {
    const cooled = t - ms(r.since) >= r.cooldownH * HOUR_MS
    const lastRepair = ms(r.lastRepairAt)
    const repairDue = !Number.isFinite(lastRepair) || t - lastRepair >= REPAIR_MIN_GAP_MS
    return cooled && repairDue ? { ...base, state: 'repair_owed', since: now.toISOString() } : base
  }
  if (r.state === 'repaired') {
    const since = ms(r.since)
    if (r.via === 'daily') {
      const answered = lastOwnerAt !== null && ms(lastOwnerAt) > since
      if (!answered && t - since >= REPAIRED_SILENCE_MS) return enterBackingOff(base, r.reason ?? 'ignored', now, r.trigger)
      return base
    }
    if (t - since >= REPAIRED_SETTLE_MS) return toSteady(base, now)
  }
  return base
}

function toSteady(r: RapportRupture, now: Date): RapportRupture {
  return {
    state: 'steady',
    since: now.toISOString(),
    soft: [],
    cooldownH: RAPPORT_MIN_COOLDOWN_H,
    ...(r.lastRepairAt ? { lastRepairAt: r.lastRepairAt } : {}),
  }
}

// Any owner message while repaired closes the episode.
export function onOwnerMessage(r: RapportRupture, now: Date): RapportRupture {
  return r.state === 'repaired' ? toSteady(r, now) : r
}

export function markRepaired(r: RapportRupture, via: 'chat' | 'daily', now: Date): RapportRupture {
  if (!isBackingOff(r)) return r
  return { ...r, state: 'repaired', since: now.toISOString(), via, lastRepairAt: now.toISOString() }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

// The repair opening: names what happened, owns Kairos's part, one question.
export function repairOpening(r: Pick<RapportRupture, 'reason' | 'trigger'>): string {
  switch (r.reason) {
    case 'not_now':
      return r.trigger
        ? `You told me “${clip(r.trigger, 60)}” and I kept going anyway — that's on me. Should I keep things lighter for a while?`
        : "You told me not now and I kept going anyway — that's on me. Should I keep things lighter for a while?"
    case 'dismissed':
      return "You waved off a couple of my messages — fair, they probably weren't worth your time, and that's on me. What would you rather I flag?"
    case 'terse':
      return "Your replies have been short lately — I may have been crowding you, and that's on me. Want me to dial it back?"
    default:
      return 'My last few messages went unanswered — I was probably sending too much, and that’s on me. What would be more useful from me right now?'
  }
}
