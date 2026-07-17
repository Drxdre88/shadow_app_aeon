import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import {
  getChatThread,
  appendChatMessage,
  updateChatMessageContent,
} from '@/lib/data/kairos-chat'
import type { ChatRetrievalMeta } from '@/lib/data/kairos-chat-payload'
import { buildChatMessages, type ChatPromptSurface } from '@/lib/kairos/chat-prompt'
import {
  retrieveForChatGlobal,
  extractCitationIds,
  intersectWithRetrieved,
  type ChatRetrieval,
} from '@/lib/kairos/chat-retrieval'
import { toPromptRetrieval, toRetrievalMeta } from '@/lib/kairos/chat-retrieval-mapping'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'

// Whole-brain chat turn engine, extracted from the chat server actions so
// non-session surfaces (the Telegram webhook) can run the SAME machinery
// against a caller-resolved userId. Auth stays at the caller: server actions
// guard with safeAuth, the webhook resolves the operator from env.
//
// Both entry points persist the user turn BEFORE calling the model so a
// model failure can never silently lose input — the next call detects the
// orphan and retries the AI half (or rewrites the orphan body on an edited
// retry).

export interface ChatTurnOptions {
  surface?: ChatPromptSurface
}

interface AssistantReply {
  content: string
  model: string | null
}

export type KairosChatTurnResult =
  | { ok: true; threadId: string; userSeq: number; assistantSeq: number; assistantContent: string; model: string | null }
  // `threadId` is present on AI-failure cases (no_credential/ai_empty/ai_failed):
  // the thread was created and the user message persisted before the AI call,
  // so the client can recover to it on retry instead of starting a new thread.
  | { ok: false; reason: 'unauthorized' | 'dominion_not_found' | 'thread_not_found' | 'no_credential' | 'ai_empty' | 'ai_failed' | 'invalid_input'; message?: string; threadId?: string }

async function callAssistant(
  userId: string,
  dominionId: string | null,
  systemMessages: ReturnType<typeof buildChatMessages>,
): Promise<AssistantReply | { error: 'no_credential' } | { error: 'empty' } | { error: 'failed'; message: string }> {
  try {
    const { provider } = await getProviderForTask(userId, {
      taskType: 'chat',
      dominionId,
    })
    // No temperature: current-gen Claude models 400 on non-default values
    // (same reason PR #84 stripped it from the synthesis call sites).
    const response = await provider.ask({
      messages: systemMessages,
      maxTokens: 2000,
    })
    const text = response.text.trim()
    if (!text) return { error: 'empty' }
    return { content: text, model: response.modelId }
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { error: 'no_credential' }
    if (err instanceof AiCredentialDecryptError) return { error: 'no_credential' }
    return { error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

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
  const loaded = await getChatThread(userId, threadId)
  if (!loaded) return { ok: false, reason: 'thread_not_found' }

  const last = loaded.messages[loaded.messages.length - 1]
  if (last && last.role === 'user') {
    if (last.content !== body) {
      const updated = await updateChatMessageContent(userId, threadId, last.seq, body)
      if (!updated.ok) return { ok: false, reason: 'thread_not_found' }
    }
    return runAssistantTurn(userId, threadId, loaded.thread.dominionId, body, last.seq, opts)
  }

  return runChatTurn(userId, threadId, loaded.thread.dominionId, body, opts)
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

  return runAssistantTurn(userId, threadId, dominionId, body, userAppend.seq, opts)
}

export async function runAssistantTurn(
  userId: string,
  threadId: string,
  dominionId: string | null,
  userBody: string,
  userSeq: number,
  opts: ChatTurnOptions = {},
): Promise<KairosChatTurnResult> {
  // An anchored thread's Dominion frames the prompt (persona + vision/mission).
  // Unanchored (null) threads get the whole-brain persona; provider routing is
  // Dominion-agnostic either way (routeTask resolves on taskType + tier).
  let dominion: { name: string; vision: string | null; missionLong: string | null } | null = null
  if (dominionId) {
    const [domRow] = await db
      .select({ name: dominions.name, vision: dominions.vision, missionLong: dominions.missionLong })
      .from(dominions)
      .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
      .limit(1)
    if (!domRow) return { ok: false, reason: 'dominion_not_found' }
    dominion = domRow
  }

  const thread = await getChatThread(userId, threadId)
  if (!thread) return { ok: false, reason: 'thread_not_found' }

  const priorHistory = thread.messages
    .filter((m) => m.seq < userSeq)
    .map((m) => ({ role: m.role, content: m.content }))

  // JARVIS-level recall — whole-brain, no Dominion scope. Kairos pulls the
  // Aether self-model + top-k substrate across EVERY Dominion, so the operator
  // talks to him without pinpointing a front. Failure here must NOT block the
  // reply (a warming brain has no Aether yet); fall back to bare chat on any
  // retrieval error. Logged so a silently-bare reply is debuggable.
  let retrieval: ChatRetrieval | null = null
  try {
    retrieval = await retrieveForChatGlobal(userId, userBody)
  } catch (err) {
    console.error('[kairos-chat] retrieval failed, falling back to bare chat', {
      threadId,
      dominionId,
      error: err instanceof Error ? err.message : String(err),
    })
    retrieval = null
  }

  const promptRetrieval = retrieval ? toPromptRetrieval(retrieval) : undefined

  const messages = buildChatMessages({
    dominion,
    history: priorHistory,
    userMessage: userBody,
    retrieval: promptRetrieval,
    surface: opts.surface,
  })

  const reply = await callAssistant(userId, dominionId, messages)
  if ('error' in reply) {
    // The user message is already persisted on `threadId` — surface it so the
    // client recovers to this thread on retry (no duplicate thread).
    if (reply.error === 'no_credential') return { ok: false, reason: 'no_credential', threadId }
    if (reply.error === 'empty') return { ok: false, reason: 'ai_empty', threadId }
    return { ok: false, reason: 'ai_failed', message: reply.message, threadId }
  }

  // Strip hallucinated citations: only persist ids that were actually
  // retrieved this turn. UI then renders only chips it can name.
  const citedIds = retrieval
    ? intersectWithRetrieved(extractCitationIds(reply.content), retrieval)
    : []
  const retrievalMeta: ChatRetrievalMeta | undefined = retrieval ? toRetrievalMeta(retrieval) : undefined

  const asstAppend = await appendChatMessage(userId, threadId, {
    role: 'assistant',
    content: reply.content,
    model: reply.model ?? undefined,
    ...(citedIds.length ? { citations: citedIds } : {}),
    ...(retrievalMeta ? { retrieval: retrievalMeta } : {}),
  })
  if (!asstAppend.ok) return { ok: false, reason: 'thread_not_found' }

  return {
    ok: true,
    threadId,
    userSeq,
    assistantSeq: asstAppend.seq,
    assistantContent: reply.content,
    model: reply.model,
  }
}
