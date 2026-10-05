// KAIROS_LIVING_DOMINIONS (alias VORATH_LIVING_DOMINIONS): unset/'0' → off
// (no scoring, behaviour unchanged); 'observe' → the nightly score and dormant
// flags are computed and shown in Health, nothing Vorath says changes; '1' →
// every focus consumer reads the ranked list and skips dormant Dominions.
export type LivingDominionsMode = 'off' | 'observe' | 'on'

export function livingDominionsMode(): LivingDominionsMode {
  const raw = (process.env.KAIROS_LIVING_DOMINIONS ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export const DEFAULT_DORMANT_DAYS = 21

// KAIROS_DORMANT_DAYS: quiet days before an unpinned Dominion goes dormant (7–90).
export function dormantAfterDays(): number {
  const n = Number.parseInt((process.env.KAIROS_DORMANT_DAYS ?? '').trim(), 10)
  if (!Number.isFinite(n)) return DEFAULT_DORMANT_DAYS
  return Math.min(90, Math.max(7, n))
}
