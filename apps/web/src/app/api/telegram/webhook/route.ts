import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { acceptInboxProposal, dismissInboxMemory } from '@/lib/data/inbox'
import { createChatThread, findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import {
  answerCallbackQuery,
  editMessageText,
  renderTelegramHtml,
  sendMessage,
  splitTelegramMessage,
  TELEGRAM_HTML_SPLIT_LIMIT,
} from '@/lib/kairos/telegram'

// ─────────────────────────────────────────────────────────────────────────
// Kairos in the gram — Telegram bot webhook.
//
// Single-operator by design: only updates from TELEGRAM_OPERATOR_CHAT_ID are
// handled; everything else is silently ignored. The brain stays multi-tenant
// — every data call below is scoped to KAIROS_OPERATOR_USER_ID.
//
// Auth: Telegram echoes the secret_token passed to setWebhook in the
// X-Telegram-Bot-Api-Secret-Token header on every delivery.
//
// Handlers are idempotent (Telegram redelivers updates): a duplicate
// dismiss/accept answers the callback gracefully instead of erroring, and
// handler failures still return 200 so Telegram doesn't redeliver forever.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

const TELEGRAM_THREAD_TITLE = 'Telegram · Kairos'
const CALLBACK_RE = /^(dismiss|accept):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const CITATION_RE = /\s*\[\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]\]/gi

type TelegramUpdate = {
  callback_query?: {
    id: string
    data?: string
    message?: {
      message_id: number
      text?: string
      chat?: { id: number | string }
    }
  }
  message?: {
    text?: string
    chat?: { id: number | string }
  }
}

function accepted() {
  return jsonResponse({ ok: true })
}

function isOperatorChat(chatId: number | string | undefined, operatorChatId: string): boolean {
  return chatId !== undefined && String(chatId) === operatorChatId
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }

  const operatorChatId = process.env.TELEGRAM_OPERATOR_CHAT_ID
  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorChatId || !operatorUserId) {
    console.error('[telegram-webhook] TELEGRAM_OPERATOR_CHAT_ID / KAIROS_OPERATOR_USER_ID unset — ignoring update')
    return accepted()
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null
  if (!update) return accepted()

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, operatorChatId, operatorUserId)
    } else if (update.message?.text) {
      await handleTextMessage(update.message, operatorChatId, operatorUserId)
    }
  } catch (err) {
    // Never surface a 5xx to Telegram — it would redeliver the update.
    console.error('[telegram-webhook] update handling failed', err)
  }
  return accepted()
}

async function handleCallbackQuery(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  operatorChatId: string,
  operatorUserId: string,
) {
  const chatId = callback.message?.chat?.id
  if (!isOperatorChat(chatId, operatorChatId)) return

  const match = CALLBACK_RE.exec(callback.data ?? '')
  if (!match) {
    await answerCallbackQuery(callback.id, 'Unknown action')
    return
  }

  const [, action, memoryId] = match
  const result = action.toLowerCase() === 'accept'
    ? await acceptInboxProposal(operatorUserId, memoryId)
    : await dismissInboxMemory(operatorUserId, memoryId)

  const outcome = result.ok
    ? (action.toLowerCase() === 'accept' ? 'Accepted' : 'Dismissed')
    : (result.reason === 'already_resolved' ? 'Already handled' : 'Not found')

  await answerCallbackQuery(callback.id, outcome)

  if (result.ok && callback.message) {
    const original = callback.message.text ?? ''
    await editMessageText(chatId!, callback.message.message_id, `${original}\n\n— ${outcome} ✓`.trim())
  }
}

async function handleTextMessage(
  message: NonNullable<TelegramUpdate['message']>,
  operatorChatId: string,
  operatorUserId: string,
) {
  const chatId = message.chat?.id
  if (!isOperatorChat(chatId, operatorChatId)) return
  const body = (message.text ?? '').trim()
  if (!body) return

  // One persistent whole-brain thread for the operator, found by title.
  let threadId = await findOpenChatThreadByTitle(operatorUserId, TELEGRAM_THREAD_TITLE)
  if (!threadId) {
    const created = await createChatThread(operatorUserId, {
      dominionId: null,
      title: TELEGRAM_THREAD_TITLE,
    })
    if (!created.ok) {
      await sendMessage(chatId!, 'Could not open the Telegram thread in Aeon.')
      return
    }
    threadId = created.threadId
  }

  const result = await sendChatMessage(operatorUserId, threadId, body, { surface: 'telegram' })

  if (result.ok) {
    // Citation markers are UI chips in Aeon; plain noise in Telegram.
    const reply = result.assistantContent.replace(CITATION_RE, '')
    // Split the raw markdown (tags must not straddle chunks), render each
    // chunk to Telegram HTML, and fall back to plain text if Telegram
    // rejects the formatting — delivery beats styling.
    for (const chunk of splitTelegramMessage(reply, TELEGRAM_HTML_SPLIT_LIMIT)) {
      try {
        await sendMessage(chatId!, renderTelegramHtml(chunk), { parseMode: 'HTML' })
      } catch {
        await sendMessage(chatId!, chunk)
      }
    }
    return
  }

  if (result.reason === 'no_credential') {
    await sendMessage(
      chatId!,
      'Kairos brain is offline — no AI provider key is configured in Aeon. ' +
      'Your message is saved; add a key in Settings → AI to wake him up.',
    )
    return
  }

  await sendMessage(chatId!, `Kairos could not reply (${result.reason}). Your message is saved in the thread.`)
}
