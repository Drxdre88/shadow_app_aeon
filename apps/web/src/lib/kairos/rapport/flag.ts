import { mindSwitch } from '@/lib/kairos/level'
export type RapportMode = 'off' | 'observe' | 'on'

function triState(name: string): RapportMode {
  const raw = mindSwitch(name).trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

// KAIROS_READINESS / KAIROS_BIDS / KAIROS_REPAIR: unset/'0' → off (every
// surface byte-identical), 'observe' → compute, store and log only, '1' → live.
export const readinessMode = (): RapportMode => triState('KAIROS_READINESS')
export const bidsMode = (): RapportMode => triState('KAIROS_BIDS')
export const repairMode = (): RapportMode => triState('KAIROS_REPAIR')

export interface RapportModes {
  readiness: RapportMode
  bids: RapportMode
  repair: RapportMode
}

export function rapportModes(): RapportModes {
  return { readiness: readinessMode(), bids: bidsMode(), repair: repairMode() }
}

export function anyRapportFlag(modes: RapportModes = rapportModes()): boolean {
  return modes.readiness !== 'off' || modes.bids !== 'off' || modes.repair !== 'off'
}

export function anyRapportLive(modes: RapportModes = rapportModes()): boolean {
  return modes.readiness === 'on' || modes.bids === 'on' || modes.repair === 'on'
}
