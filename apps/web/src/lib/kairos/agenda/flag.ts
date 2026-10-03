import { initiativeEnabled } from '@/lib/kairos/initiative'

// Horae (Kairos's agenda) runs only when the initiative switch is on AND its
// own switch KAIROS_AGENDA=1. Flags off: nothing is booked or planned.
export function agendaEnabled(): boolean {
  return initiativeEnabled() && process.env.KAIROS_AGENDA === '1'
}
