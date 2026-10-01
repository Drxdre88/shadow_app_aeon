import { jsonResponse } from '@/lib/api/response'
import { NextRequest, after } from 'next/server'
import { acceptInboxProposal, dismissInboxMemory } from '@/lib/kairos/proposal-accept'
import {
  appendChatMessage,
  createChatThread,
  findOpenChatThreadByTitle,
  getChatThread,
} from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { upsertJob } from '@/lib/data/thinking-jobs'
import { buildAssistantTurn, sendChatMessage } from '@/lib/kairos/chat-turn'
import {
  chatJobKey,
  chatJobOwnsMessage,
  chatRoutineConfig,
  chatRoutineTimeoutMs,
  fireChatRoutine,
  runChatWatchdog,
  supersedeOpenChatJobs,
  takeOverChatJob,
  telegramRoutineEnabled,
} from '@/lib/kairos/chat-routine'
import { buildChatJobSpec, chatHandler } from '@/lib/kairos/thinking/handlers/chat'
import {
  answerCallbackQuery,
  editMessageText,
  sendChatAction,
  sendMessage,
  sendTelegramChatReply,
  telegramChatFailureText,
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

// Mirrored by CHAT_JOB_OWNERSHIP_WINDOW_MS and the chat routine timeout clamp
// (lib/kairos/chat-routine.ts) — change them together.
export const maxDuration = 300

const TELEGRAM_THREAD_TITLE = 'Telegram · Kairos'
const CALLBACK_RE = /^(dismiss|accept):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// Best-effort redelivery dedup for text messages (Telegram is at-least-once
// delivery; a slow chat turn can outlast Telegram's own retry window and
// trigger a genuine resend). Module-scope Map, so this ONLY survives within
// a single warm serverless instance — cold starts and concurrent instances
// each get their own empty set. That's a real gap, not durable dedup, but
// migrations stay hand-managed (see CLAUDE.md) so a DB-backed dedup table is
// out of scope here; this is cheap insurance against the common case of one
// warm lambda seeing the same retry twice.
const SEEN_UPDATE_IDS_MAX = 200
const seenUpdateIds = new Map<number, true>()

function isDuplicateUpdate(updateId: number | undefined): boolean {
  if (updateId === undefined) return false
  if (seenUpdateIds.has(updateId)) return true
  seenUpdateIds.set(updateId, true)
  if (seenUpdateIds.size > SEEN_UPDATE_IDS_MAX) {
    const oldest = seenUpdateIds.keys().next().value
    if (oldest !== undefined) seenUpdateIds.delete(oldest)
  }
  return false
}

type TelegramUpdate = {
  update_id?: number
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
      if (isDuplicateUpdate(update.update_id)) return accepted()
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

  const repliedAt = new Date()
  const match = CALLBACK_RE.exec(callback.data ?? '')
  if (!match) {
    await markKairosSpeaksReplied(operatorUserId, repliedAt)
      .catch((err) => console.error('[telegram-webhook] reply marker failed', err))
    await answerCallbackQuery(callback.id, 'Unknown action')
    return
  }

  const [, action, memoryId] = match
  const result = await (async () => {
    try {
      return action.toLowerCase() === 'accept'
        ? await acceptInboxProposal(operatorUserId, memoryId)
        : await dismissInboxMemory(operatorUserId, memoryId)
    } finally {
      // Resolve the callback target before the bulk reply marker changes its
      // pending status; otherwise the existing dismiss/accept gate would
      // treat this first click as an already-handled Telegram retry.
      await markKairosSpeaksReplied(operatorUserId, repliedAt)
        .catch((err) => console.error('[telegram-webhook] reply marker failed', err))
    }
  })()

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
  await markKairosSpeaksReplied(operatorUserId, new Date())
    .catch((err) => console.error('[telegram-webhook] reply marker failed', err))
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

  if (telegramRoutineEnabled()) {
    if (chatRoutineConfig()) {
      await handleTextViaRoutine(chatId!, operatorUserId, threadId, body)
      return
    }
    console.warn('[telegram-webhook] KAIROS_TELEGRAM_ROUTINE is on but ROUTINE_CHAT_ID / ROUTINE_CHAT_TOKEN are unset — answering on the paid key')
  }

  const result = await sendChatMessage(operatorUserId, threadId, body, { surface: 'telegram' })

  if (result.ok) {
    await sendTelegramChatReply(chatId!, result.assistantContent)
    return
  }

  await sendMessage(chatId!, telegramChatFailureText(result.reason))
}

// Chat on the Max plan (docs/kairos/34 §5): persist the turn, queue a `chat`
// thinking job, return; after() fires the "Kairos chat" routine and watches
// the job, answering on the paid key if the routine is not done in time (or
// never fired). Exactly one reply per turn — see lib/kairos/chat-routine.ts.
async function handleTextViaRoutine(
  chatId: number | string,
  userId: string,
  threadId: string,
  body: string,
) {
  const loaded = await getChatThread(userId, threadId)
  if (!loaded) {
    await sendMessage(chatId, 'Could not open the Telegram thread in Aeon.')
    return
  }

  const last = loaded.messages[loaded.messages.length - 1]
  if (last && last.role === 'user' && last.content === body) {
    // Same text again on an unanswered turn: a cross-instance redelivery of a
    // turn already in flight — its job answers it, including while the
    // watchdog's paid fallback is still running after a takeover — or the
    // operator retrying a turn whose reply failed; that retry goes through
    // the paid path exactly as before the routine existed.
    if (await chatJobOwnsMessage(userId, threadId, last.id)) return
    const retried = await sendChatMessage(userId, threadId, body, { surface: 'telegram' })
    if (retried.ok) await sendTelegramChatReply(chatId, retried.assistantContent)
    else await sendMessage(chatId, telegramChatFailureText(retried.reason))
    return
  }

  // Persist BEFORE anything can fail — input is never lost.
  const appended = await appendChatMessage(userId, threadId, { role: 'user', content: body })
  if (!appended.ok) {
    await sendMessage(chatId, telegramChatFailureText('thread_not_found'))
    return
  }
  await sendChatAction(chatId).catch(() => undefined)

  const key = chatJobKey(threadId, appended.messageId)
  await supersedeOpenChatJobs(userId, threadId, key).catch((err) =>
    console.error('[telegram-webhook] superseding open chat jobs failed', err))

  const built = await buildAssistantTurn(userId, threadId, {
    dominionId: loaded.thread.dominionId,
    userBody: body,
    userSeq: appended.seq,
    surface: 'telegram',
  })
  if (!built.ok) {
    await sendMessage(chatId, telegramChatFailureText(built.reason))
    return
  }

  const timeoutMs = chatRoutineTimeoutMs()
  const job = await upsertJob(userId, buildChatJobSpec(built.turn, {
    threadId,
    userSeq: appended.seq,
    userMessageId: appended.messageId,
    chatId,
    dominionId: loaded.thread.dominionId,
    userBody: body,
  }, timeoutMs))
  // Unique key already taken: another delivery owns this turn.
  if (!job) return

  after(async () => {
    try {
      const fired = await fireChatRoutine()
      const outcome = fired.ok
        ? await runChatWatchdog(userId, job.id, chatHandler.fallback, {
            timeoutMs,
            onPoll: () => sendChatAction(chatId),
          })
        : await takeOverChatJob(userId, job.id, fired.error, chatHandler.fallback)
      if (!fired.ok) console.error('[telegram-webhook] chat routine fire failed — paid fallback', fired.error)
      if (outcome.outcome === 'fallback_failed') {
        console.error('[telegram-webhook] chat fallback failed', { jobId: job.id, reason: outcome.reason })
      } else {
        console.info('[telegram-webhook] chat turn settled', { jobId: job.id, outcome: outcome.outcome })
      }
    } catch (err) {
      console.error('[telegram-webhook] chat routine watchdog failed', err)
    }
  })
}
