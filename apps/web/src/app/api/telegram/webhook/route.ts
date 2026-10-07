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
import { appendAssistantReplyOnce } from '@/lib/kairos/chat-turn-reply'
import { answerNumberedKairosAsks, type NumberedAnswerOutcome } from '@/lib/kairos/ask'
import { formatNumberedAck } from '@/lib/kairos/ask-numbered'
import {
  chatJobKey,
  chatJobOwnsMessage,
  chatRoutineConfig,
  chatRoutineEnabled,
  chatRoutineTimeoutMs,
  CHAT_PAID_BACKUP_OFF_MESSAGE,
  settleChatJob,
  supersedeOpenChatJobs,
} from '@/lib/kairos/chat-routine'
import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { agendaEnabled } from '@/lib/kairos/agenda/flag'
import { routeAgendaCommands } from '@/lib/kairos/agenda/telegram-commands'
import { recordChatOwnerTurn } from '@/lib/kairos/chat-today'
import { routeDecisionCommands } from '@/lib/kairos/decisions/telegram-commands'
import { routePredictionCommands } from '@/lib/kairos/predictions/telegram-commands'
import { routePromiseCommands } from '@/lib/kairos/promises/telegram-commands'
import { handleProposalCallback, routeVetoReason } from '@/lib/kairos/proposal-telegram'
import { routeMomentCallback, routeMomentMessage, routeMomentText } from '@/lib/kairos/moment/telegram-routes'
import { routeOwnerCommands } from '@/lib/kairos/telegram-commands'
import type { TelegramMediaRef } from '@/lib/kairos/moment/types'
import { buildChatJobSpec, chatHandler } from '@/lib/kairos/thinking/handlers/chat'
import {
  answerCallbackQuery,
  editMessageText,
  PROPOSAL_CALLBACK_RE,
  sendChatAction,
  sendMessage,
  sendTelegramChatReply,
  telegramChatFailureText,
  type ProposalCallbackAction,
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

type TelegramUser = { id: number | string }

type TelegramUpdate = {
  update_id?: number
  callback_query?: {
    id: string
    data?: string
    from?: TelegramUser
    message?: {
      message_id: number
      text?: string
      chat?: { id: number | string }
    }
  }
  message?: {
    message_id?: number
    text?: string
    chat?: { id: number | string }
    from?: TelegramUser
    reply_to_message?: { message_id: number; text?: string }
    caption?: string; sticker?: TelegramMediaRef; animation?: TelegramMediaRef; photo?: TelegramMediaRef[]
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
      await handleTextMessage(update.message, operatorChatId, operatorUserId, update.update_id ?? null)
    } else if (update.message) {
      await routeMomentMessage(update.message, operatorChatId, operatorUserId, update.update_id ?? null)
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
  const proposal = PROPOSAL_CALLBACK_RE.exec(callback.data ?? '')
  if (proposal) {
    // A decision button: only the operator's own tap counts (a chat id match
    // alone would let anyone in a shared chat decide).
    if (String(callback.from?.id) !== operatorChatId) {
      await answerCallbackQuery(callback.id, 'Not allowed')
      return
    }
    try {
      await handleProposalCallback(operatorUserId, {
        callbackId: callback.id,
        action: proposal[1].toLowerCase() as ProposalCallbackAction,
        proposalId: proposal[2].toLowerCase(),
        chatId: chatId!,
        messageId: callback.message?.message_id ?? null,
        originalText: callback.message?.text ?? '',
      }, repliedAt)
    } finally {
      await markKairosSpeaksReplied(operatorUserId, repliedAt)
        .catch((err) => console.error('[telegram-webhook] reply marker failed', err))
    }
    return
  }

  if (await routeMomentCallback(callback, chatId!, operatorUserId)) return
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
  updateId: number | null,
) {
  const chatId = message.chat?.id
  if (!isOperatorChat(chatId, operatorChatId)) return
  await markKairosSpeaksReplied(operatorUserId, new Date())
    .catch((err) => console.error('[telegram-webhook] reply marker failed', err))
  const body = (message.text ?? '').trim()
  if (!body) return

  // Deterministic pre-router: "Q12: …" answers / "skip Q12" against the open
  // question backlog never reach the chat model. Plain prose falls through.
  if (await routeNumberedAnswers(chatId!, operatorUserId, body, message.reply_to_message?.text)) return

  // Phase 2 (dormant unless KAIROS_INITIATIVE=1): "P3 kept" / "drop P3" /
  // "P3 by 20/10"; track record (KAIROS_PREDICTIONS=1): "R3 right" / "void R3";
  // Horae (KAIROS_AGENDA=1): "cancel A3"; then the free-text reason after a
  // "Veto + why". Each router either handles the whole message or passes.
  if (initiativeEnabled() && await routeOwnerCommands('promise', routePromiseCommands, chatId!, operatorUserId, body)) return
  if (await routeOwnerCommands('prediction', routePredictionCommands, chatId!, operatorUserId, body)) return
  if (await routeOwnerCommands('decision', routeDecisionCommands, chatId!, operatorUserId, body)) return
  if (agendaEnabled() && await routeOwnerCommands('agenda', routeAgendaCommands, chatId!, operatorUserId, body)) return
  if (initiativeEnabled() && await routeVetoReasonText(chatId!, operatorUserId, body, message, updateId)) return
  if (await routeMomentText(chatId!, operatorUserId, body, message, updateId)) return

  // One persistent whole-brain thread for the operator, found by title.
  const threadId = await findOrCreateTelegramThread(operatorUserId)
  if (!threadId) {
    await sendMessage(chatId!, 'Could not open the Telegram thread in Aeon.')
    return
  }

  if (chatRoutineEnabled()) {
    if (chatRoutineConfig()) {
      await handleTextViaRoutine(chatId!, operatorUserId, threadId, body)
      return
    }
    console.warn('[telegram-webhook] KAIROS_CHAT_ROUTINE is on but ROUTINE_CHAT_ID / ROUTINE_CHAT_TOKEN are unset — answering on the paid key')
  }

  const result = await sendChatMessage(operatorUserId, threadId, body, { surface: 'telegram' })

  if (result.ok) {
    await sendTelegramChatReply(chatId!, result.assistantContent)
    return
  }

  await sendMessage(chatId!, telegramChatFailureText(result.reason))
}

async function findOrCreateTelegramThread(userId: string): Promise<string | null> {
  const existing = await findOpenChatThreadByTitle(userId, TELEGRAM_THREAD_TITLE)
  if (existing) return existing
  const created = await createChatThread(userId, { dominionId: null, title: TELEGRAM_THREAD_TITLE })
  return created.ok ? created.threadId : null
}

async function routeVetoReasonText(
  chatId: number | string,
  userId: string,
  body: string,
  message: NonNullable<TelegramUpdate['message']>,
  updateId: number | null,
): Promise<boolean> {
  try {
    return await routeVetoReason(userId, chatId, {
      text: body,
      updateId,
      replyToMessageId: message.reply_to_message?.message_id ?? null,
    })
  } catch (err) {
    console.error('[telegram-webhook] veto-reason routing failed — handing the text to chat', err)
    return false
  }
}

// Numbered answers to the 06:00 message's open questions. Answers are the
// operator's own words (operator origin, via answerKairosAsk); one short ack
// goes back, and the exchange is written into the Telegram thread so chat
// history keeps it. Returns false (→ ordinary chat) when no label names an
// open question, or when the backlog cannot be read.
async function routeNumberedAnswers(chatId: number | string, userId: string, body: string, replyText?: string): Promise<boolean> {
  let outcome: NumberedAnswerOutcome
  try {
    outcome = replyText
      ? await answerNumberedKairosAsks(userId, body, new Date(), replyText)
      : await answerNumberedKairosAsks(userId, body)
  } catch (err) {
    console.error('[telegram-webhook] numbered-answer routing failed — handing the text to chat', err)
    return false
  }
  if (!outcome.matched) return false

  const ack = formatNumberedAck(outcome)
  try {
    const threadId = await findOrCreateTelegramThread(userId)
    if (threadId) {
      const turn = await appendChatMessage(userId, threadId, { role: 'user', content: body })
      // Ledgered to this turn only, so an earlier in-flight chat turn still gets its reply.
      if (turn.ok) await appendAssistantReplyOnce(userId, threadId, turn.seq, { content: ack })
    }
  } catch (err) {
    console.error('[telegram-webhook] writing the numbered-answer exchange to the thread failed', err)
  }
  await sendMessage(chatId, ack)
  return true
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
    // the paid path exactly as before the routine existed, if the paid
    // backup is on.
    if (await chatJobOwnsMessage(userId, threadId, last.id)) return
    if (!(await isPaidBackupEnabled(userId))) {
      await sendMessage(chatId, CHAT_PAID_BACKUP_OFF_MESSAGE)
      return
    }
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
  recordChatOwnerTurn(userId, threadId, appended.seq, body, 'telegram')
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
    channel: 'telegram',
    threadId,
    userSeq: appended.seq,
    userMessageId: appended.messageId,
    chatId,
    dominionId: loaded.thread.dominionId,
    userBody: body,
  }, timeoutMs))
  // Unique key already taken: another delivery owns this turn.
  if (!job) return

  after(() => settleChatJob(userId, job.id, {
    channel: 'telegram',
    timeoutMs,
    logTag: 'telegram-webhook',
    fallback: chatHandler.fallback,
    onPoll: () => sendChatAction(chatId),
  }))
}
