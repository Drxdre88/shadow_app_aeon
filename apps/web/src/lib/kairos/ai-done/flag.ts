import { mindSwitch } from '@/lib/kairos/level'

// KAIROS_AI_DONE: '1'/'on' → planned (level 1); anything else → off. Boards
// still need their creator's per-board switch (settings.kairosAiDone).
export function aiDoneEnabled(): boolean {
  const raw = mindSwitch('KAIROS_AI_DONE').trim().toLowerCase()
  return raw === '1' || raw === 'on'
}
