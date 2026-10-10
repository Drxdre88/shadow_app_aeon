import {
  getChatThread,
  appendChatMessage,
  updateChatMessageContent,
} from '@/lib/data/kairos-chat'
import { CHAT_REPLY_PENDING_MESSAGE, chatJobOwnsMessage } from '@/lib/kairos/chat-routine'
import { answerBuiltAssistantTurn, buildAssistantTurn, runAssistantTurn } from '@/lib/kairos/chat-turn-assistant'
import { chatTodayChannel, recordChatOwnerTurn } from '@/lib/kairos/chat-today'
import type { ChatTurnOptions, KairosChatTurnResult, LoadedChatThread } from '@/lib/kairos/chat-turn-reply'

// Whole-brain chat turn engine, extracted from the chat server actions so
// non-session surfaces (the Telegram webhook) can run the SAME machinery
// against a caller-resolved userId. Auth stays at the caller: server actions
// guard with safeAuth, the webhook resolves the operator from env.
//
// Both entry points persist the user turn BEFORE calling the model so a
// model failure can never silently lose input — the next call detects the
// orphan and retries the AI half (or rewrites the orphan body on an edited
// retry).
//
// The assistant half lives in chat-turn-assistant.ts and the shared leaves
// (result type, cut-short guard, ask resolution, reply ledger) in
// chat-turn-reply.ts; both are re-exported here so callers keep one import.

export {
  buildAssistantTurn,
  persistAssistantReply,
  persistAssistantReplyOnce,
  runAssistantTurn,
  runAssistantTurnOnce,
  type AssistantTurnOptions,
  type BuiltAssistantTurn,
  type ChatCitationsContext,
  type PersistAssistantReplyMeta,
} from '@/lib/kairos/chat-turn-assistant'
export {
  askResolutionSchema,
  CHAT_CUT_SHORT_FALLBACK,
  CHAT_CUT_SHORT_MARKER,
  guardChatReply,
  isTurnAnswered,
  parseAskResolutionResponse,
  resolvePendingAskForTurn,
  trimToCompleteBoundary,
  turnCoveredBy,
  type AlreadyAnsweredResult,
  type AskResolution,
  type ChatReplyMark,
  type ChatTurnMark,
  type ChatTurnOptions,
  type KairosChatTurnResult,
} from '@/lib/kairos/chat-turn-reply'

// Full send flow into an existing thread: orphan-user-message recovery, then
// persist + assistant half. Any trailing user message means the previous AI
// call failed mid-flight after the user turn was saved — retry against the
// orphan (exact body) or rewrite it in place (edited retry) instead of
// double-posting.
export async function sendChatMessage(
  userId: string,
  threadId: string,
  body: string,
  opts: ChatTurnOptions = {},
): Promise<KairosChatTurnResult> {
  const loaded = opts.loadedThread ?? await getChatThread(userId, threadId)
  if (!loaded) return { ok: false, reason: 'thread_not_found' }

  const last = loaded.messages[loaded.messages.length - 1]
  if (last && last.role === 'user') {
    // A Telegram turn handed to the chat routine is not an orphan: its job
    // (routine, or the watchdog's paid fallback still in flight) owns the
    // reply. Answering or rewriting it here would double-reply.
    if (await chatJobOwnsMessage(userId, threadId, last.id)) {
      return { ok: false, reason: 'ai_failed', message: CHAT_REPLY_PENDING_MESSAGE, threadId }
    }
    if (last.content !== body) {
      const updated = await updateChatMessageContent(userId, threadId, last.seq, body)
      if (!updated.ok) return { ok: false, reason: 'thread_not_found' }
      // Same key as the original turn: the edited text replaces it in today.
      recordChatOwnerTurn(userId, threadId, last.seq, body, chatTodayChannel(opts.surface, opts.channel))
    }
    return runAssistantTurn(userId, threadId, loaded.thread.dominionId, body, last.seq, opts)
  }

  if (opts.channel === 'voice') return runVoiceChatTurn(userId, threadId, loaded, body, opts)
  return runChatTurn(userId, threadId, loaded.thread.dominionId, body, opts)
}

// Voice: the owner's turn is saved while the context is built, from the
// thread as already read (so the new message can't appear twice). The model
// call starts only once the save succeeded, so input is never lost.
async function runVoiceChatTurn(
  userId: string,
  threadId: string,
  loaded: LoadedChatThread,
  body: string,
  opts: ChatTurnOptions,
): Promise<KairosChatTurnResult> {
  const dominionId = loaded.thread.dominionId
  const started = Date.now()
  const appended = appendChatMessage(userId, threadId, { role: 'user', content: body }).then((saved) => {
    opts.onSpan?.('thread', Date.now() - started)
    if (saved.ok) recordChatOwnerTurn(userId, threadId, saved.seq, body, chatTodayChannel(opts.surface, opts.channel))
    return saved
  })
  const [userAppend, built] = await Promise.all([
    appended,
    buildAssistantTurn(userId, threadId, {
      ...opts,
      loadedThread: loaded,
      dominionId,
      userBody: body,
      // Every message already read precedes the turn being saved.
      userSeq: Number.MAX_SAFE_INTEGER,
    }),
  ])
  if (!userAppend.ok) return { ok: false, reason: 'thread_not_found' }
  if (!built.ok) return { ok: false, reason: built.reason }
  return answerBuiltAssistantTurn(userId, threadId, dominionId, body, userAppend.seq, opts, built.turn)
}

// Shared core: persist user message → run assistant half.
export async function runChatTurn(
  userId: string,
  threadId: string,
  dominionId: string | null,
  body: string,
  opts: ChatTurnOptions = {},
): Promise<KairosChatTurnResult> {
  // Persist BEFORE the AI call — see file header.
  const userAppend = await appendChatMessage(userId, threadId, {
    role: 'user',
    content: body,
  })
  if (!userAppend.ok) return { ok: false, reason: 'thread_not_found' }
  recordChatOwnerTurn(userId, threadId, userAppend.seq, body, chatTodayChannel(opts.surface, opts.channel))

  return runAssistantTurn(userId, threadId, dominionId, body, userAppend.seq, opts)
}

