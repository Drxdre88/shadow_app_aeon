'use server'

import { z } from 'zod'
import { safeAuth } from './helpers'
import {
  createChatThread as _createChatThread,
  getChatThread as _getChatThread,
  listChatThreads as _listChatThreads,
  archiveChatThread as _archiveChatThread,
} from '@/lib/data/kairos-chat'
import { runChatTurn, sendChatMessage, type KairosChatTurnResult } from '@/lib/kairos/chat-turn'

// Chat server actions — session-auth wrappers over the shared chat-turn
// engine (lib/kairos/chat-turn.ts), which the Telegram webhook also drives.
// The engine persists the user turn BEFORE calling the model so a model
// failure can never silently lose input.

const startSchema = z.object({
  // Optional anchor — omitted/null starts an unanchored whole-brain thread.
  dominionId: z.string().uuid().nullish(),
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

export type KairosChatActionResult = KairosChatTurnResult

export async function startKairosThread(input: z.infer<typeof startSchema>): Promise<KairosChatActionResult> {
  const auth = await safeAuth()
  if (!auth.ok) return auth
  const userId = auth.userId
  const parsed = startSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid_input', message: parsed.error.issues[0].message }

  // Derive thread title from first message when caller didn't supply one.
  const derivedTitle = parsed.data.title ?? parsed.data.body.split('\n')[0].slice(0, 80)

  const dominionId = parsed.data.dominionId ?? null
  const created = await _createChatThread(userId, {
    dominionId,
    title: derivedTitle,
  })
  if (!created.ok) return { ok: false, reason: 'dominion_not_found' }

  return runChatTurn(userId, created.threadId, dominionId, parsed.data.body)
}

export async function sendKairosMessage(input: z.infer<typeof sendSchema>): Promise<KairosChatActionResult> {
  const auth = await safeAuth()
  if (!auth.ok) return auth
  const userId = auth.userId
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'invalid_input', message: parsed.error.issues[0].message }

  return sendChatMessage(userId, parsed.data.threadId, parsed.data.body)
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
