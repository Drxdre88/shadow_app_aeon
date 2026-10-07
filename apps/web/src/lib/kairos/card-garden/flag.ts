import { mindSwitch } from '@/lib/kairos/level'

// KAIROS_CARD_GARDEN: unset/'0'/'off' → off (no weekly card_garden job is
// planned); '1'/'on' → on. A proposal already filed can still be decided.
export type CardGardenMode = 'off' | 'on'

export function cardGardenMode(): CardGardenMode {
  const raw = mindSwitch('KAIROS_CARD_GARDEN').trim().toLowerCase()
  return raw === '1' || raw === 'on' ? 'on' : 'off'
}
