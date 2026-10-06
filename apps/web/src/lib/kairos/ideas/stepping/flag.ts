import { mindSwitch } from '@/lib/kairos/level'
// Lane D flags (wave 3), default off: 'off' = byte-identical, 'observe' = record only, '1'/'on' = live.

export type SteppingMode = 'off' | 'observe' | 'on'

function triState(name: string): SteppingMode {
  const raw = mindSwitch(name).trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export const NOVELTY_EVERY_DEFAULT = 5
export const NOVELTY_EVERY_MIN = 2
export const NOVELTY_EVERY_MAX = 30

// KAIROS_IDEA_NOVELTY 0|observe|1 — pure-novelty round one night in N.
export const noveltyMode = (): SteppingMode => triState('KAIROS_IDEA_NOVELTY')

// KAIROS_IDEA_TASTE 0|observe|1 — learned owner taste + reserved surprise slot.
export const tasteMode = (): SteppingMode => triState('KAIROS_IDEA_TASTE')

// KAIROS_IDEA_NOVELTY_EVERY 2–30 (default 5); out of range or junk → default.
export function noveltyEvery(): number {
  const raw = (process.env.KAIROS_IDEA_NOVELTY_EVERY ?? '').trim()
  const n = raw === '' ? NaN : Number(raw)
  return Number.isInteger(n) && n >= NOVELTY_EVERY_MIN && n <= NOVELTY_EVERY_MAX ? n : NOVELTY_EVERY_DEFAULT
}
