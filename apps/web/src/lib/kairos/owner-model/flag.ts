import { mindSwitch } from '@/lib/kairos/level'
// Owner model flags (wave 4 lane B). Default off in code: every prompt, reply,
// sweep result and webhook answer stays byte-identical.
//   KAIROS_OWNER_MODEL           unset/'0' → off; 'observe' → extract + store
//                                + read view only; '1'/'on' → prompt block,
//                                weekly card, Telegram + web corrections.
//   KAIROS_OWNER_STATE_TTL_DAYS  state lifetime after his last confirmation
//                                (default 10, clamped 3–30).

export type OwnerModelMode = 'off' | 'observe' | 'on'

export function ownerModelMode(): OwnerModelMode {
  const raw = mindSwitch('KAIROS_OWNER_MODEL').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export const DEFAULT_OWNER_STATE_TTL_DAYS = 10
export const MIN_OWNER_STATE_TTL_DAYS = 3
export const MAX_OWNER_STATE_TTL_DAYS = 30

export function ownerStateTtlDays(): number {
  const raw = process.env.KAIROS_OWNER_STATE_TTL_DAYS
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_OWNER_STATE_TTL_DAYS
  return Math.min(MAX_OWNER_STATE_TTL_DAYS, Math.max(MIN_OWNER_STATE_TTL_DAYS, Math.round(n)))
}
