import { callTelegram, sendMessage } from '@/lib/kairos/telegram'
import { hasMomentHook, runTelegramCallback, runTelegramMessage, runTelegramText } from './index'
import type { TelegramMomentMessage } from './types'

// Telegram webhook side of the moment seam. Lane routers run after the owner
// command routers (text) and before dismiss/accept parsing (callbacks); with
// no lane hooks every function returns false without a Telegram call.

export type CommandRouter = (userId: string, body: string, send: (text: string) => Promise<unknown>) => Promise<boolean>

// Owner command routers (promises, predictions, agenda). A failure to route
// hands the text to chat.
export async function routeOwnerCommands(
  name: string,
  router: CommandRouter,
  chatId: number | string,
  userId: string,
  body: string,
): Promise<boolean> {
  try {
    return await router(userId, body, (text) => sendMessage(chatId, text))
  } catch (err) {
    console.error(`[telegram-webhook] ${name}-command routing failed — handing the text to chat`, err)
    return false
  }
}

export async function routeMomentText(
  chatId: number | string,
  userId: string,
  body: string,
  message: TelegramMomentMessage,
  updateId: number | null,
): Promise<boolean> {
  if (!hasMomentHook('telegramText')) return false
  return runTelegramText({ userId, chatId, body, message, updateId, send: (text) => sendMessage(chatId, text), now: new Date() })
}

export interface MomentCallback {
  id: string
  data?: string
  from?: { id: number | string }
  message?: { message_id: number; text?: string }
}

// Operator chat already checked by the webhook.
export async function routeMomentCallback(callback: MomentCallback, chatId: number | string, userId: string): Promise<boolean> {
  if (!hasMomentHook('telegramCallback')) return false
  return runTelegramCallback({
    userId,
    callbackId: callback.id,
    data: callback.data ?? '',
    fromId: callback.from?.id !== undefined ? String(callback.from.id) : null,
    chatId,
    messageId: callback.message?.message_id ?? null,
    originalText: callback.message?.text ?? '',
    now: new Date(),
  })
}

// A message without text (sticker, animation, photo). Today such updates are
// ignored; that stays true unless a lane handles them.
export async function routeMomentMessage(
  message: TelegramMomentMessage,
  operatorChatId: string,
  userId: string,
  updateId: number | null,
): Promise<boolean> {
  if (!hasMomentHook('telegramMessage')) return false
  const chatId = message.chat?.id
  if (chatId === undefined || String(chatId) !== operatorChatId) return false
  return runTelegramMessage({ userId, chatId, message, updateId, now: new Date() })
}

// Bot API setMessageReaction: one emoji reaction on a message (bots get one per message).
export async function setMessageReaction(chatId: number | string, messageId: number, emoji: string): Promise<void> {
  await callTelegram('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  })
}
