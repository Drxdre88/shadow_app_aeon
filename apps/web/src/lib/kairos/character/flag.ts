import { mindSwitch } from '@/lib/kairos/level'
// Character-drift check (weekly blind style rating) has its own switch.
// Off = no character_check job is planned, no weekly-review line is added,
// the reflection tone rule is not in the prompt, and hourly reflections are
// neither tone-tagged nor quarantined (prompts and rows stay as before).
export function characterCheckEnabled(): boolean {
  return mindSwitch('KAIROS_CHARACTER_CHECK') === '1'
}
