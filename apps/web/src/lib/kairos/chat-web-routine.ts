import { after } from 'next/server'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import { upsertJob } from '@/lib/data/thinking-jobs'
import {
  chatJobKey,
  chatJobOwnsMessage,
  chatRoutineConfig,
  chatRoutineEnabled,
  chatRoutineTimeoutMs,
  settleChatJob,
  supersedeOpenChatJobs,
  type ChatWatchdogOutcome,
} from '@/lib/kairos/chat-routine'
import { buildAssistantTurn, type KairosChatTurnResult } from '@/lib/kairos/chat-turn'
import { buildChatJobSpec, chatHandler } from '@/lib/kairos/thinking/handlers/chat'

// Kairos-page chat on the Max plan (docs/kairos/34 §5). Same machinery as
// the Telegram webhook: persist the turn, queue a `chat` job (channel web),
// return at once with a pending marker; after() fires the "Kairos chat"
// routine and runs the watchdog, which answers on the paid key (if the paid
// backup is on) when the routine is not done in time. The page polls the
// thread for the reply.

export type KairosChatPendingResult = {
  ok: true
  pending: true
  threadId: string
  userSeq: number
}

export type WebChatTurnResult = KairosChatTurnResult | KairosChatPendingResult

// Flag on and the routine configured. Otherwise the web chat stays on
// today's synchronous paid path.
export function webChatRoutineReady(): boolean {
  return chatRoutineEnabled() && chatRoutineConfig() !== null
}

const pending = (threadId: string, userSeq: number): KairosChatPendingResult =>
  ({ ok: true, pending: true, threadId, userSeq })

interface Turn { seq: number; messageId: string }

export async function sendWebChatViaRoutine(
  userId: string,
  threadId: string,
  body: string,
): Promise<WebChatTurnResult> {
  const loaded = await getChatThread(userId, threadId)
  if (!loaded) return { ok: false, reason: 'thread_not_found' }
  const dominionId = loaded.thread.dominionId

  const last = loaded.messages[loaded.messages.length - 1]
  let reuse: Turn | null = null
  if (last && last.role === 'user' && last.content === body) {
    // Same text on an unanswered turn: a double submit while its job is in
    // flight (nothing to do), or a retry of a turn nothing answers — re-queue
    // that turn instead of posting the message twice.
    if (await chatJobOwnsMessage(userId, threadId, last.id)) return pending(threadId, last.seq)
    reuse = { seq: last.seq, messageId: last.id }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let turn = reuse
    // Message → queue time, measured only for a freshly persisted message.
    let persistedAt: number | null = null
    if (!turn) {
      // Persist BEFORE anything can fail — input is never lost.
      const appended = await appendChatMessage(userId, threadId, { role: 'user', content: body })
      if (!appended.ok) return { ok: false, reason: 'thread_not_found' }
      persistedAt = Date.now()
      turn = { seq: appended.seq, messageId: appended.messageId }
    }

    const key = chatJobKey(threadId, turn.messageId)
    await supersedeOpenChatJobs(userId, threadId, key).catch((err) =>
      console.error('[kairos-web-chat] superseding open chat jobs failed', err))

    const built = await buildAssistantTurn(userId, threadId, {
      dominionId,
      userBody: body,
      userSeq: turn.seq,
      surface: 'app',
    })
    if (!built.ok) return { ok: false, reason: built.reason, threadId }

    const timeoutMs = chatRoutineTimeoutMs()
    const job = await upsertJob(userId, buildChatJobSpec(built.turn, {
      channel: 'web',
      threadId,
      userSeq: turn.seq,
      userMessageId: turn.messageId,
      dominionId,
      userBody: body,
    }, timeoutMs))

    if (job) {
      const messageToEnqueueMs = persistedAt === null ? null : Date.now() - persistedAt
      after(() => settleWebChatJob(userId, job.id, timeoutMs, messageToEnqueueMs))
      return pending(threadId, turn.seq)
    }
    // The key is taken. For a fresh message another request owns the turn;
    // for a re-queued old turn its earlier job is long closed, so post the
    // retry as a new message.
    if (!reuse) return pending(threadId, turn.seq)
    reuse = null
  }
  return { ok: false, reason: 'ai_failed', threadId }
}

export async function settleWebChatJob(
  userId: string,
  jobId: string,
  timeoutMs: number,
  messageToEnqueueMs: number | null = null,
): Promise<ChatWatchdogOutcome | null> {
  return settleChatJob(userId, jobId, {
    channel: 'web',
    timeoutMs,
    logTag: 'kairos-web-chat',
    fallback: chatHandler.fallback,
    messageToEnqueueMs,
  })
}
