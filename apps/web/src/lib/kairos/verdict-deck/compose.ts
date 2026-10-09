import type { DailyMessageInputs } from '../daily-message-prompt'
import { isLondonSunday } from '../daily-message-time'
import { buildVerdictDeck, type VerdictDeckBrief } from './build'
import type { DeckItem, VerdictDeck } from './types'

// The 06:00 run's two deck steps: compose (Sunday London only; null on any
// other day or on a failure, so the ordinary brief goes out) and remember the
// number → item mapping once Telegram delivered it.

export async function composeVerdictDeck(
  userId: string,
  narrative: string,
  inputs: DailyMessageInputs,
  now: Date,
): Promise<VerdictDeckBrief | null> {
  if (!isLondonSunday(now)) return null
  try {
    const { gatherDeckCandidates } = await import('./gather')
    const { candidates, failed } = await gatherDeckCandidates(userId, now)
    // Every source that might hold items failed: say nothing rather than "nothing waiting".
    if (candidates.length === 0 && failed.length > 0) return null
    return buildVerdictDeck(narrative, candidates, inputs, now)
  } catch (err) {
    console.warn('[kairos:verdict-deck] compose failed — sending the ordinary brief:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function rememberVerdictDeck(userId: string, date: string, items: ReadonlyArray<DeckItem>, messageIds: ReadonlyArray<number>): Promise<void> {
  if (items.length === 0) return
  const { saveVerdictDeck } = await import('@/lib/data/kairos-verdict-deck')
  const deck: VerdictDeck = { v: 1, date, messageIds: [...messageIds].slice(-10), items: [...items] }
  await saveVerdictDeck(userId, deck)
}
