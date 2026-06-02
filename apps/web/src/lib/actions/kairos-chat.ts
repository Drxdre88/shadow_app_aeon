'use server'

import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { requireAuth } from './helpers'
import {
  createChatThread as _createChatThread,
  getChatThread as _getChatThread,
  listChatThreads as _listChatThreads,
  appendChatMessage as _appendChatMessage,
  archiveChatThread as _archiveChatThread,
} from '@/lib/data/kairos-chat'
import { buildChatMessages } from '@/lib/kairos/chat-prompt'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C1) — chat server actions.
//
// Two main entry points:
//   - startKairosThread(dominionId, firstMessage): creates a new thread
//     anchored to a Dominion, posts the first user message, calls the
//     BYOK model, posts the assistant reply. Returns the thread + the
//     two messages so the UI can render them immediately.
//   - sendKairosMessage(threadId, body): appends the user message to an
//     existing thread, calls the BYOK model with the full history, posts
//     the assistant reply. Returns the two new messages.
//
// Both flows persist BEFORE calling the AI so a model failure doesn't
// lose the user's message. If the AI call fails, the action returns
// `{ok: false, reason}` and the user message stays in the thread; the
// next call can retry without resending.
// ─────────────────────────────────────────────────────────────────────────

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

// Convert the requireAuth throw into the action's structured ok:false
// envelope so callers don't have to wrap every action in a try/catch
// just to surface "not signed in" instead of a raw exception string.
async function safeAuth(): Promise<{ ok: true; userId: string } | { ok: false; reason: 'unauthorized' }> {
  try {
    const userId = await requireAuth()
    return { ok: true, userId }
  } catch {
    return { ok: false, reason: 'unauthorized' }
  }
}

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

  // Orphan-user-message recovery: if the last persisted message is a user
  // message with the same body as this retry, the previous AI call failed
  // mid-flight after the user message was already saved. Skip the duplicate
  // append and re-run the AI turn against the existing orphan.
  const last = loaded.messages[loaded.messages.length - 1]
  if (last && last.role === 'user' && last.content === parsed.data.body) {
    return retryAssistantOnly(userId, parsed.data.threadId, loaded.thread.dominionId, last.seq)
  }

  return runChatTurn(userId, parsed.data.threadId, loaded.thread.dominionId, parsed.data.body)
}

// Shared core: append user message → load dominion + history → call AI →
// append assistant message → return both seqs. Centralised so start and
// send can both rely on the same persistence ordering.
async function runChatTurn(
  userId: string,
  threadId: string,
  dominionId: string,
  body: string,
): Promise<KairosChatActionResult> {
  // 1. Persist the user message FIRST. A model failure must not lose it.
  const userAppend = await _appendChatMessage(userId, threadId, {
    role: 'user',
    content: body,
  })
  if (!userAppend.ok) return { ok: false, reason: 'thread_not_found' }

  return runAssistantTurn(userId, threadId, dominionId, body, userAppend.seq)
}

// Re-runs only the AI + assistant-persist half of a turn against an
// existing user message. Used when the previous turn errored after
// persisting the user message — we don't want to append a second copy.
async function retryAssistantOnly(
  userId: string,
  threadId: string,
  dominionId: string,
  userSeq: number,
): Promise<KairosChatActionResult> {
  const thread = await _getChatThread(userId, threadId)
  if (!thread) return { ok: false, reason: 'thread_not_found' }
  const orphan = thread.messages.find((m) => m.seq === userSeq)
  if (!orphan) return { ok: false, reason: 'thread_not_found' }
  return runAssistantTurn(userId, threadId, dominionId, orphan.content, userSeq)
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

  const messages = buildChatMessages({
    dominion: {
      name: domRow.name,
      vision: domRow.vision,
      missionLong: domRow.missionLong,
    },
    history: priorHistory,
    userMessage: userBody,
  })

  const reply = await callAssistant(userId, dominionId, messages)
  if ('error' in reply) {
    if (reply.error === 'no_credential') return { ok: false, reason: 'no_credential' }
    if (reply.error === 'empty') return { ok: false, reason: 'ai_empty' }
    return { ok: false, reason: 'ai_failed', message: reply.message }
  }

  const asstAppend = await _appendChatMessage(userId, threadId, {
    role: 'assistant',
    content: reply.content,
    model: reply.model ?? undefined,
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

// Read-only fetchers exposed for the UI.

export async function listKairosThreads(input: z.infer<typeof listSchema> = {}) {
  const userId = await requireAuth()
  const parsed = listSchema.safeParse(input)
  if (!parsed.success) return []
  return _listChatThreads(userId, parsed.data)
}

export async function loadKairosThread(input: z.infer<typeof threadIdSchema>) {
  const userId = await requireAuth()
  const parsed = threadIdSchema.safeParse(input)
  if (!parsed.success) return null
  return _getChatThread(userId, parsed.data.threadId)
}

export async function archiveKairosThread(input: z.infer<typeof threadIdSchema>) {
  const userId = await requireAuth()
  const parsed = threadIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const }
  const archived = await _archiveChatThread(userId, parsed.data.threadId)
  return { ok: archived }
}
