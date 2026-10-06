import { mindSwitch } from '@/lib/kairos/level'

// KAIROS_CARD_TREE: unset/'0'/'off' → off (no new card tree requests are
// taken); '1'/'on' → on. A proposal already drafted can still be decided.
export type CardTreeMode = 'off' | 'on'

export function cardTreeMode(): CardTreeMode {
  const raw = mindSwitch('KAIROS_CARD_TREE').trim().toLowerCase()
  return raw === '1' || raw === 'on' ? 'on' : 'off'
}
