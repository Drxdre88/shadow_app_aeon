import type { TelegramCallbackContext } from '@/lib/kairos/moment/types'
import { correctOwnerItem } from './correct'
import { OWNER_CALLBACK_RE, remainingKeyboard } from './card'

// The carrying card's buttons: om1:k:<seq> (still / yes) and om1:x:<seq>
// (over for a state, wrong for a trait). Answers the callback itself, then
// edits the card: "— C1 over ✓" appended, that row removed.

const FAILED: Record<string, string> = { not_found: 'No longer open', duplicate: 'Already noted' }

export async function handleOwnerCardCallback(ctx: TelegramCallbackContext): Promise<boolean> {
  const m = OWNER_CALLBACK_RE.exec(ctx.data)
  if (!m) return false
  const { answerCallbackQuery, editMessageText } = await import('@/lib/kairos/telegram')
  // Only the operator's own tap counts (a chat id match alone is not enough).
  if (ctx.fromId !== (process.env.TELEGRAM_OPERATOR_CHAT_ID ?? '').trim()) {
    await answerCallbackQuery(ctx.callbackId, 'Not allowed')
    return true
  }
  const seq = Number(m[2])
  const res = await correctOwnerItem(ctx.userId, { seq }, m[1] === 'k' ? 'still' : 'drop', { via: 'telegram' }, ctx.now)
  await answerCallbackQuery(ctx.callbackId, res.ok ? res.label : FAILED[res.reason] ?? 'Unknown action')
  try {
    const { markKairosSpeaksReplied } = await import('@/lib/data/memories')
    await markKairosSpeaksReplied(ctx.userId, ctx.now)
  } catch (err) {
    console.error('[kairos:owner-model] reply marker failed', err)
  }
  if (!res.ok || ctx.messageId === null) return true
  try {
    const { readKairosOwnerModel } = await import('@/lib/data/kairos-owner-model')
    const keyboard = remainingKeyboard(await readKairosOwnerModel(ctx.userId), seq, ctx.now)
    await editMessageText(ctx.chatId, ctx.messageId, `${ctx.originalText}\n\n— ${res.label}`.trim(), { inlineKeyboard: keyboard })
  } catch (err) {
    console.error('[kairos:owner-model] editing the card failed', err)
  }
  return true
}
