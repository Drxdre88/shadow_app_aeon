import { after } from 'next/server'
import type { BreakTrigger } from './break'
import { gateMode, gateOperator } from './flag'

// Event-driven release: a card closed or a coding session ended is a natural
// break, so held speaks may go out now instead of at the next hourly sweep.
// Flag checked first (off/observe → nothing loaded, nothing awaited); operator
// only; never throws, never blocks the caller (detached via after()).
export function noteKairosBreak(userId: string, trigger: BreakTrigger): void {
  if (gateMode() !== 'on' || !userId || userId !== gateOperator()) return
  const pending = import('./release')
    .then(({ releaseHeldSpeaks }) => releaseHeldSpeaks(userId, new Date(), trigger))
    .catch((err) => console.warn('[kairos:gate] break release failed', err instanceof Error ? err.message : String(err)))
  try {
    after(() => pending)
  } catch {
    // outside a request scope: the detached promise still completes
  }
}
