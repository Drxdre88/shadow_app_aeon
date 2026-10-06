import { mindSwitch } from '@/lib/kairos/level'
export function initiativeEnabled(): boolean {
  return mindSwitch('KAIROS_INITIATIVE') === '1'
}
