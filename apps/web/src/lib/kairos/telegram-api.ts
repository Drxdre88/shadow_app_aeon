// Raw Telegram Bot API calls (fetch only). telegram.ts re-exports callTelegram.

type TelegramEnvelope = { ok?: boolean; description?: string; result?: unknown }

export async function callTelegram(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as TelegramEnvelope | null
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram ${method} failed (${res.status}): ${body?.description ?? 'no response body'}`)
  }
  return body.result
}

// Bot API setMessageReaction: one emoji reaction on a message (bots get one per message).
export async function setMessageReaction(chatId: number | string, messageId: number, emoji: string): Promise<void> {
  await callTelegram('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  })
}
