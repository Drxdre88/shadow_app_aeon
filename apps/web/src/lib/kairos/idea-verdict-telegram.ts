import type { Origin } from './origin'
import { settledIdeaKeyboard, type IdeaVerdict } from './idea-verdict-keyboard'
import { acceptInboxProposal, dismissInboxMemory } from './proposal-accept'
import { answerCallbackQuery, editMessageReplyMarkup, type InlineKeyboardButton } from './telegram'

// A Keep / Drop tap on an idea (webhook side). The tap is the owner's own act
// on an owner-authenticated surface, so it is recorded with operator origin
// through the same inbox triage the Accept / Dismiss buttons use.

export const TELEGRAM_OWNER_ORIGIN: Origin = { kind: 'operator', via: 'telegram' }

export interface IdeaVerdictTap {
  callbackId: string
  chatId: number | string
  messageId: number | null
  keyboard: InlineKeyboardButton[][]
  data: string
  memoryId: string
  verdict: IdeaVerdict
}

// Records the verdict, acks in one line ("✓ kept" / "✓ dropped") and
// collapses that idea's buttons; the message text is left as sent.
export async function handleIdeaVerdictTap(userId: string, tap: IdeaVerdictTap): Promise<void> {
  const result = tap.verdict === 'kept'
    ? await acceptInboxProposal(userId, tap.memoryId, TELEGRAM_OWNER_ORIGIN)
    : await dismissInboxMemory(userId, tap.memoryId, TELEGRAM_OWNER_ORIGIN)
  const ack = result.ok ? `✓ ${tap.verdict}` : result.reason === 'already_resolved' ? 'Already handled' : 'Not found'
  await answerCallbackQuery(tap.callbackId, ack)
  if (!result.ok || tap.messageId === null) return
  try {
    await editMessageReplyMarkup(tap.chatId, tap.messageId, settledIdeaKeyboard(tap.keyboard, tap.data, tap.verdict))
  } catch (err) {
    console.error('[kairos-telegram] idea verdict keyboard edit failed', err)
  }
}
