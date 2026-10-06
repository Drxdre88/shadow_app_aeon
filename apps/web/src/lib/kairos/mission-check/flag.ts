import { mindSwitch } from '@/lib/kairos/level'

// KAIROS_MISSION_CHECK: unset/'0'/'off' → off (nothing planned); 'observe' →
// verdicts are written but the board does not show them; '1'/'on' → shown.
// Boards still need their owner's per-board switch (settings.kairosMissionCheck).
export type MissionCheckMode = 'off' | 'observe' | 'on'

export function missionCheckMode(): MissionCheckMode {
  const raw = mindSwitch('KAIROS_MISSION_CHECK').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}
