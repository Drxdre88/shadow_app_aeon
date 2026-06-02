'use server'

import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { safeAuth } from './helpers'
import {
  createChatThread as _createChatThread,
  getChatThread as _getChatThread,
  listChatThreads as _listChatThreads,
  appendChatMessage as _appendChatMessage,
  archiveChatThread as _archiveChatThread,
  updateChatMessageContent as _updateChatMessageContent,
} from '@/lib/data/kairos-chat'
import type { ChatRetrievalMeta } from '@/lib/data/kairos-chat-payload'
import { buildChatMessages } from '@/lib/kairos/chat-prompt'
import {
  retrieveForChat,
  extractCitationIds,
  intersectWithRetrieved,
  type ChatRetrieval,
} from '@/lib/kairos/chat-retrieval'
import { toPromptRetrieval, toRetrievalMeta } from '@/lib/kairos/chat-retrieval-mapping'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'

// Chat server actions. Both startKairosThread + sendKairosMessage persist
// the user turn BEFORE calling the model so a model failure can never
// silently lose input — the next call detects the orphan and retries the
// AI half (or rewrites the orphan body if the user edited the retry).

const startSchema = z.object({
  dominionId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(200).nullable().optional(),
})

const sendSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
})

const listSchema = z.object({
  dominionId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

const threadIdSchema = z.object({
  threadId: z.string().uuid(),
})

interface AssistantReply {
  content: string
  model: string | null
}

async function callAssistant(
  userId: string,
  dominionId: string,
  systemMessages: ReturnType<typeof buildChatMessages>,
): Promise<AssistantReply | { error: 'no_credential' } | { error: 'empty' } | { error: 'failed'; message: string }> {
  try {
    const { provider } = await getProviderForTask(userId, {
      taskType: 'chat',
      dominionId,
    })
    const response = await provider.ask({
      messages: systemMessages,
      maxTokens: 2000,
      temperature: 0.5,
    })
    const text = response.text.trim()
    if (!text) return { error: 'empty' }
    return { content: text, model: response.modelId }
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { error: 'no_credential' }
    return { error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

export type KairosChatActionResult =
  | { ok: true; threadId: string; userSeq: number; assistantSeq: number; assistantContent: string; model: string | null }
  | { ok: false; reason: 'unauthorized' | 'dominion_not_found' | 'thread_not_found' | 'no_credential' | 'ai_empty' | 'ai_failed' | 'invalid_input'; message?: string }

export async function startKairosThread(input: z.infer<typeof startSchema>): Promise<KairosChatActionResult> {
  const auth = await safeAuth()
  if (!auth.ok) return auth
  const userId = auth.userId
  const parsed = startSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid_input', message: parsed.error.issues[0].message }

  // Derive thread title from first message when caller didn't supply one.
  const derivedTitle = parsed.data.title ?? parsed.data.body.split('\n')[0].slice(0, 80)

  const created = await _createChatThread(userId, {
    dominionId: parsed.data.dominionId,
    title: derivedTitle,
  })
  if (!created.ok) return { ok: false, reason: 'dominion_not_found' }

  return runChatTurn(userId, created.threadId, parsed.data.dominionId, parsed.data.body)
}

export async function sendKairosMessage(input: z.infer<typeof sendSchema>): Promise<KairosChatActionResult> {
  const auth = await safeAuth()
  if (!auth.ok) return auth
  const userId = auth.userId
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid_input', message: parsed.error.issues[0].message }

  const loaded = await _getChatThread(userId, parsed.data.threadId)
  if (!loaded) return { ok: false, reason: 'thread_not_found' }
  if (!loaded.thread.dominionId) return { ok: false, reason: 'dominion_not_found' }

  // Orphan-user-message recovery: any trailing user message means the
  // previous AI call failed mid-flight after we'd already saved the user
  // turn. Rather than double-post, either retry against the existing
  // orphan (exact body) or rewrite the orphan's body to the new draft
  // (edited retry) and then re-run only the AI half of the turn.
  const last = loaded.messages[loaded.messages.length - 1]
  if (last && last.role === 'user') {
    if (last.content !== parsed.data.body) {
      const updated = await _updateChatMessageContent(userId, parsed.data.threadId, last.seq, parsed.data.body)
      if (!updated.ok) return { ok: false, reason: 'thread_not_found' }
    }
    return runAssistantTurn(userId, parsed.data.threadId, loaded.thread.dominionId, parsed.data.body, last.seq)
  }

  return runChatTurn(userId, parsed.data.threadId, loaded.thread.dominionId, parsed.data.body)
}

// Shared core: persist user message → run assistant half.
async function runChatTurn(
  userId: string,
  threadId: string,
  dominionId: string,
  body: string,
): Promise<KairosChatActionResult> {
  // Persist BEFORE the AI call — see file header.
  const userAppend = await _appendChatMessage(userId, threadId, {
    role: 'user',
    content: body,
  })
  if (!userAppend.ok) return { ok: false, reason: 'thread_not_found' }

  return runAssistantTurn(userId, threadId, dominionId, body, userAppend.seq)
}

async function runAssistantTurn(
  userId: string,
  threadId: string,
  dominionId: string,
  userBody: string,
  userSeq: number,
): Promise<KairosChatActionResult> {
  const [domRow] = await db
    .select({ name: dominions.name, vision: dominions.vision, missionLong: dominions.missionLong })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  if (!domRow) return { ok: false, reason: 'dominion_not_found' }

  const thread = await _getChatThread(userId, threadId)
  if (!thread) return { ok: false, reason: 'thread_not_found' }

  const priorHistory = thread.messages
    .filter((m) => m.seq < userSeq)
    .map((m) => ({ role: m.role, content: m.content }))

  // C2 — pull cortex + archetypes + top-k substrate for this Dominion.
  // Failure here must NOT block the reply (Dominions still warming up have
  // no cortex yet); fall back to bare chat on any retrieval error.
  let retrieval: ChatRetrieval | null = null
  try {
    retrieval = await retrieveForChat(userId, dominionId, userBody)
  } catch {
    retrieval = null
  }

  const promptRetrieval = retrieval ? toPromptRetrieval(retrieval) : undefined

  const messages = buildChatMessages({
    dominion: {
      name: domRow.name,
      vision: domRow.vision,
      missionLong: domRow.missionLong,
    },
    history: priorHistory,
    userMessage: userBody,
    retrieval: promptRetrieval,
  })

  const reply = await callAssistant(userId, dominionId, messages)
  if ('error' in reply) {
    if (reply.error === 'no_credential') return { ok: false, reason: 'no_credential' }
    if (reply.error === 'empty') return { ok: false, reason: 'ai_empty' }
    return { ok: false, reason: 'ai_failed', message: reply.message }
  }

  // Strip hallucinated citations: only persist ids that were actually
  // retrieved this turn. UI then renders only chips it can name.
  const citedIds = retrieval
    ? intersectWithRetrieved(extractCitationIds(reply.content), retrieval)
    : []
  const retrievalMeta: ChatRetrievalMeta | undefined = retrieval ? toRetrievalMeta(retrieval) : undefined

  const asstAppend = await _appendChatMessage(userId, threadId, {
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

// Read fetchers — all wrapped in safeAuth so an expired session surfaces
// as an empty result rather than a raw exception that bubbles to the UI
// error boundary.

export async function listKairosThreads(input: z.infer<typeof listSchema> = {}) {
  const auth = await safeAuth()
  if (!auth.ok) return []
  const parsed = listSchema.safeParse(input)
  if (!parsed.success) return []
  return _listChatThreads(auth.userId, parsed.data)
}

export async function loadKairosThread(input: z.infer<typeof threadIdSchema>) {
  const auth = await safeAuth()
  if (!auth.ok) return null
  const parsed = threadIdSchema.safeParse(input)
  if (!parsed.success) return null
  return _getChatThread(auth.userId, parsed.data.threadId)
}

export async function archiveKairosThread(input: z.infer<typeof threadIdSchema>) {
  const auth = await safeAuth()
  if (!auth.ok) return { ok: false as const }
  const parsed = threadIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const }
  const archived = await _archiveChatThread(auth.userId, parsed.data.threadId)
  return { ok: archived }
}
