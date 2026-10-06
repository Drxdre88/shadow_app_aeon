import { mindSwitch } from '@/lib/kairos/level'
// KAIROS_TRUST 0|observe|1 — earned trust per area (lane D). Unset/'0' → 'off'
// (nothing computed on chat or 06:00 paths); 'observe' → compute + log only;
// '1'/'on' → chat footer + Monday 06:00 tail line. The read surface always works.

export type TrustMode = 'off' | 'observe' | 'on'

export function triStateFlag(name: string): TrustMode {
  const raw = mindSwitch(name).trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export const trustMode = (): TrustMode => triStateFlag('KAIROS_TRUST')
