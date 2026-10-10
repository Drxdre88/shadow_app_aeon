import { z } from 'zod'
import { getProviderForTask } from '@/lib/ai/route-task'
import type { AIProvider } from '@/lib/ai/provider'
import { spendMeter } from '@/lib/ai/spend'
import { createChatThread, findOpenChatThreadByTitle, getChatThread } from '@/lib/data/kairos-chat'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import type { LoadedChatThread } from '@/lib/kairos/chat-turn-reply'
import { stripMomentFooters } from '@/lib/kairos/moment/chat'
import { toSpeechText } from './speech-text'
import { VoiceTapProvider } from './tap-provider'
import { VoiceTurnClock } from './timing'
import { voiceNeedsTools } from './tool-intent'
import { createVoiceTurnStream, type VoiceTurnOutcome } from './turn-stream'

// One owner-initiated voice turn through the shared chat engine (same
// grounding, memory, tools and reply recording as web chat), on the owner's
// paid key only. The Max routine is never used here: it is far too slow for a
// spoken reply, and a missing paid key is a 409, not a fallback.

export const VOICE_THREAD_TITLE = 'Voice · Vorath'

export const voiceTurnSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  // Names a separate voice thread (e.g. one per device); absent = the one voice thread.
  threadKey: z.string().trim().min(1).max(80).regex(/^[\w.:-]+$/, 'threadKey: letters, digits, _ . : - only').optional(),
})

export type VoiceTurnInput = z.infer<typeof voiceTurnSchema>

export function voiceThreadTitle(threadKey?: string): string {
  return threadKey ? `${VOICE_THREAD_TITLE} · ${threadKey}` : VOICE_THREAD_TITLE
}

export type VoicePaidKey =
  | { ok: true; provider: AIProvider }
  | { ok: false; code: 'no_paid_key'; message: string }

const MISSING_KEY_ERRORS = new Set(['AiCredentialMissingError', 'AiCredentialDecryptError'])

// Resolved before anything is persisted, so a turn without a usable paid key
// leaves no orphan message behind. The 'voice_chat' task pins Sonnet and is
// owner-initiated, so the paid-backup switch does not apply. Other errors
// propagate (500). The daily spend read runs alongside, filling the spend
// cache so the model call doesn't wait on it later; a reached cap is still
// refused there.
export async function resolveVoicePaidKey(
  userId: string,
  warmSpend: (userId: string) => Promise<void> = (id) => spendMeter.check(id),
): Promise<VoicePaidKey> {
  try {
    const [{ provider }] = await Promise.all([
      getProviderForTask(userId, { taskType: 'voice_chat' }),
      warmSpend(userId).catch(() => undefined),
    ])
    return { ok: true, provider }
  } catch (err) {
    if (err instanceof Error && MISSING_KEY_ERRORS.has(err.name)) {
      return { ok: false, code: 'no_paid_key', message: 'No usable paid AI key is configured for Vorath chat. Add one in Settings → AI to use the voice line.' }
    }
    throw err
  }
}

// A turn counts as in progress while the thread's last message is an
// unanswered owner turn younger than this (beyond the route's own duration).
export const VOICE_TURN_IN_PROGRESS_MS = 2 * 60_000

export interface VoiceThreadState {
  threadId: string | null
  // The thread is still answering a recent turn. Older unanswered turns are
  // left to the engine's orphan recovery.
  inProgress: boolean
  // The thread as read for the check, handed to the engine so it isn't read twice.
  loaded: LoadedChatThread | null
}

// Read-only, one lookup for both route checks: the voice thread (if any) and
// whether it is still answering.
export async function loadVoiceThreadState(userId: string, threadKey?: string, now: Date = new Date()): Promise<VoiceThreadState> {
  const threadId = await findOpenChatThreadByTitle(userId, voiceThreadTitle(threadKey))
  if (!threadId) return { threadId: null, inProgress: false, loaded: null }
  const loaded = await getChatThread(userId, threadId)
  const last = loaded?.messages[loaded.messages.length - 1]
  const inProgress = !!last && last.role === 'user' && now.getTime() - last.createdAt.getTime() < VOICE_TURN_IN_PROGRESS_MS
  return { threadId, inProgress, loaded }
}

export async function ensureVoiceThread(userId: string, state: VoiceThreadState, threadKey?: string): Promise<string | null> {
  if (state.threadId) return state.threadId
  const created = await createChatThread(userId, { dominionId: null, title: voiceThreadTitle(threadKey) })
  return created.ok ? created.threadId : null
}

export interface VoiceTurnRequest {
  userId: string
  threadId: string
  text: string
  provider: AIProvider
  // Started when the route received the request, so the timing covers it.
  clock?: VoiceTurnClock
  // The voice thread as the route read it; absent = the engine reads it.
  loadedThread?: LoadedChatThread | null
}

// The engine turn behind one voice line request. Simple questions answer in
// one tool-less call, so the reply streams token by token; the tool loop runs
// only when the words ask for a lookup (tool-intent.ts). The ask classifier
// and memory reinforcement run after the reply is saved (the engine defers
// them on the voice channel), on the untapped provider.
async function runVoiceTurn(
  req: VoiceTurnRequest,
  clock: VoiceTurnClock,
  onText: (text: string) => void,
  onEnd: () => void,
): Promise<VoiceTurnOutcome> {
  const { userId, threadId, text, provider } = req
  const tapped = new VoiceTapProvider(provider, onText, clock, onEnd)
  const tools = voiceNeedsTools(text)
  clock.note('tools', tools)
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage(userId, threadId, text, {
      channel: 'voice',
      provider: tapped,
      sideProvider: provider,
      tools,
      onMark: (mark) => clock.mark(mark),
      onSpan: (name, ms) => clock.span(name, ms),
      ...(req.loadedThread ? { loadedThread: req.loadedThread } : {}),
    })
  } finally {
    // Nothing a late provider call produces may reach the line after this.
    tapped.seal()
  }
  if (!result.ok) {
    return { ok: false, reason: result.reason, ...('message' in result && result.message ? { message: result.message } : {}), threadId }
  }
  const usage = tapped.answerUsage
  console.info('[kairos-voice] turn persisted', {
    threadId,
    assistantSeq: result.assistantSeq,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  })
  return {
    ok: true,
    done: {
      threadId: result.threadId,
      userSeq: result.userSeq,
      assistantSeq: result.assistantSeq,
      text: toSpeechText(stripMomentFooters(result.assistantContent)),
      model: result.model,
    },
  }
}

// The `ack` goes out before any engine work so the desk app can play its
// earcon; `done.timing` carries the stage breakdown (docs/kairos/voice-api.md).
export function voiceTurnStream(req: VoiceTurnRequest): ReadableStream<Uint8Array> {
  const clock = req.clock ?? new VoiceTurnClock()
  const streamStartedMs = clock.elapsed()
  return createVoiceTurnStream(
    (onText, onEnd) => runVoiceTurn(req, clock, onText, onEnd),
    (stream) => console.info('[kairos-voice] turn timing', { threadId: req.threadId, ok: stream.ok, ...clock.payload(stream, streamStartedMs), marks: clock.snapshot() }),
    {
      ack: { threadId: req.threadId },
      timing: (stream) => clock.payload(stream, streamStartedMs),
    },
  )
}