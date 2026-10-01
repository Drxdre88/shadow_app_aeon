import { and, desc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { agentSessions, sessionEvents } from '@/lib/db/schema'
import { getPendingKairosAsk, type KairosAskRow } from '@/lib/data/ask'
import { CHAT_ENGINE, type ChatMessagePayload } from '@/lib/data/kairos-chat'
import { hasAnyRetrieval } from '@/lib/data/kairos-chat-payload'
import { getProviderForTask } from '@/lib/ai/route-task'
import type { AIProvider } from '@/lib/ai/provider'
import { answerKairosAsk } from '@/lib/kairos/ask'
import type { ChatPromptSurface } from '@/lib/kairos/chat-prompt'
import { extractJsonBlock, neutraliseFences } from '@/lib/kairos/_prompt-utils'

// Shared leaves of the chat turn engine (chat-turn.ts → chat-turn-assistant.ts
// → here, no cycles): the turn result type, ask resolution, the P0 cut-short
// guard, and the reply ledger that makes "one reply per turn" hold across the
// Telegram chat routine, its watchdog and the sweep.

export interface ChatTurnOptions {
  surface?: ChatPromptSurface
}

export type KairosChatTurnResult =
  | { ok: true; threadId: string; userSeq: number; assistantSeq: number; assistantContent: string; model: string | null }
  // `threadId` is present on AI-failure cases (no_credential/ai_empty/ai_failed):
  // the thread was created and the user message persisted before the AI call,
  // so the client can recover to it on retry instead of starting a new thread.
  | { ok: false; reason: 'unauthorized' | 'dominion_not_found' | 'thread_not_found' | 'no_credential' | 'ai_empty' | 'ai_failed' | 'invalid_input'; message?: string; threadId?: string }

// An exclusive persist (chat job apply / fallback) found the turn already
// answered and wrote nothing.
export type AlreadyAnsweredResult = { ok: false; reason: 'already_answered'; threadId: string }

// ── Ask resolution contract ───────────────────────────────────────────────

export const askResolutionSchema = z.object({
  answersPending: z.boolean(),
  distilledAnswer: z.string().trim().min(1).max(10000).optional(),
})

export type AskResolution = z.infer<typeof askResolutionSchema>

export const ASK_RESOLUTION_SYSTEM_PROMPT = [
  'Decide whether the operator turn answers the single open Kairos question.',
  'True means the turn supplies a substantive answer, decision, correction, preference, or reason relevant to that question.',
  'False means it is a greeting, deflection, clarification request, unrelated topic, or too ambiguous to preserve as an answer.',
  'When true, distil only what the operator explicitly said into concise first-person text. Never add Kairos\'s inference.',
  'Return only JSON: {"answersPending":boolean,"distilledAnswer"?:string}.',
].join('\n')

export function parseAskResolutionResponse(text: string): AskResolution {
  return askResolutionSchema.parse(extractJsonBlock(text, 'ask-resolution'))
}

export function pendingAskRationale(pending: KairosAskRow): string {
  if (pending.askMine?.rationale) return pending.askMine.rationale
  if (pending.summary?.trim() && pending.summary.trim() !== pending.title.trim()) {
    return pending.summary.trim()
  }
  if (pending.askMine) {
    return `Selected as a high-leverage ${pending.askMine.kind} question from ${pending.askMine.sourceMemoryIds.length} grounded source(s) (leverage ${pending.askMine.leverage.toFixed(2)}).`
  }
  return 'Selected from the latest Aether question or tension.'
}

export async function classifyAskResolution(
  provider: AIProvider,
  pending: KairosAskRow,
  userBody: string,
): Promise<AskResolution> {
  try {
    const response = await provider.ask({
      system: ASK_RESOLUTION_SYSTEM_PROMPT,
      prompt: [
        'Open question JSON:',
        neutraliseFences(JSON.stringify({
          question: pending.title,
          kind: pending.askMine?.kind ?? 'aether',
          rationale: pendingAskRationale(pending),
        })),
        '',
        'Operator turn:',
        neutraliseFences(userBody),
      ].join('\n'),
      maxOutputTokens: 240,
    })
    return parseAskResolutionResponse(response.text.trim())
  } catch (error) {
    console.error('[kairos-chat] ask resolution classification failed', {
      askId: pending.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { answersPending: false }
  }
}

export async function applyAskResolution(
  userId: string,
  pending: KairosAskRow,
  resolution: AskResolution,
  userBody: string,
): Promise<void> {
  // A card_notes answer is parsed line-by-line onto the asked cards
  // ("1. …", "2. …"); the classifier's distilled prose would flatten those
  // numbers and silently drop the write-back. Hand over the operator's raw
  // text for that kind; every other ask keeps the distilled answer.
  const isCardNotesAsk = pending.askMine?.kind === 'card_notes' || !!pending.cardNotes
  const answer = isCardNotesAsk
    ? userBody
    : resolution.distilledAnswer ?? userBody
  try {
    const result = await answerKairosAsk(
      userId,
      pending.id,
      answer,
    )
    if ('error' in result && result.error === 'dominion_not_found') {
      console.error('[kairos-chat] pending ask answer Dominion was not found', {
        askId: pending.id,
      })
    }
  } catch (error) {
    console.error('[kairos-chat] pending ask resolution failed', {
      askId: pending.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Ask resolution for a reply that was NOT written on the paid key (the chat
// routine): classify the operator turn against the ask that was pending when
// the turn was built, on the paid key's cheap classifier, and record it.
// Best-effort — no credential, a different ask now pending, or any failure
// leaves the ask open (it stays answerable from the next turn).
export async function resolvePendingAskForTurn(
  userId: string,
  dominionId: string | null,
  pendingAskId: string,
  userBody: string,
): Promise<boolean> {
  try {
    const pending = await getPendingKairosAsk(userId)
    if (!pending || pending.id !== pendingAskId) return false
    const { provider } = await getProviderForTask(userId, { taskType: 'chat', dominionId })
    const resolution = await classifyAskResolution(provider, pending, userBody)
    if (!resolution.answersPending) return false
    await applyAskResolution(userId, pending, resolution, userBody)
    return true
  } catch (error) {
    console.warn('[kairos-chat] routine ask resolution skipped', {
      askId: pendingAskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}


// ── P0 cut-short guard ────────────────────────────────────────────────────

export const CHAT_CUT_SHORT_MARKER = '(cut short)'
export const CHAT_CUT_SHORT_FALLBACK =
  'I got cut off before I could finish a coherent reply. Ask again, or narrow the question.'
const MIN_SALVAGEABLE_CHARS = 80
const SENTENCE_END_RE = /[.!?\u2026]["')\]*_]*(?=\s|$)/g

// Longest prefix (≤ maxChars) ending on a paragraph break or sentence end, with
// any unterminated code fence closed. Null when nothing coherent survives.
export function trimToCompleteBoundary(text: string, maxChars = text.length): string | null {
  const window = text.slice(0, maxChars)
  let cut = window.lastIndexOf('\n\n')
  for (const m of window.matchAll(SENTENCE_END_RE)) cut = Math.max(cut, m.index + m[0].length)
  if (cut < MIN_SALVAGEABLE_CHARS) return null
  const trimmed = window.slice(0, cut).trimEnd()
  const fences = trimmed.match(/```/g)?.length ?? 0
  return fences % 2 === 1 ? `${trimmed}\n\`\`\`` : trimmed
}

// A non-'stop' finish (usually 'length': the output cap hit mid-thought) means
// the tail is unfinished and possibly runaway text (27/09 digest incident).
// Keep the coherent prefix and say it was cut short; if none, admit it plainly.
// Undefined finishReason (deadline fallback, providers that omit it) passes.
export function guardChatReply(text: string, finishReason: string | undefined): string {
  if (finishReason === undefined || finishReason === 'stop') return text
  const trimmed = trimToCompleteBoundary(text)
  return trimmed ? `${trimmed}\n\n${CHAT_CUT_SHORT_MARKER}` : CHAT_CUT_SHORT_FALLBACK
}

// ── Reply ledger ──────────────────────────────────────────────────────────
//
// An exclusive assistant reply records the user turn it answers
// (`answersSeq`). A reply answering turn N also covers every earlier turn:
// its transcript carried them (a newer message supersedes older ones). A
// reply with no `answersSeq` (paid web/Telegram path, pre-ledger history)
// is attributed conservatively to every turn before it.
//
// TODO(parent): this is DB access outside lib/data — it belongs next to
// appendChatMessage in lib/data/kairos-chat.ts (out of this lane's ownership).

export interface ChatReplyMark {
  seq: number
  role: 'user' | 'assistant'
  answersSeq: number | null
}

export function turnCoveredBy(messages: readonly ChatReplyMark[], userSeq: number): boolean {
  return messages.some((m) => m.role === 'assistant'
    && m.seq > userSeq
    && (m.answersSeq === null || m.answersSeq >= userSeq))
}

function toMark(seq: number, payload: unknown): ChatReplyMark {
  const p = (payload ?? {}) as { role?: unknown; answersSeq?: unknown }
  return {
    seq,
    role: p.role === 'assistant' ? 'assistant' : 'user',
    answersSeq: typeof p.answersSeq === 'number' && Number.isInteger(p.answersSeq) ? p.answersSeq : null,
  }
}

const threadScope = (userId: string, threadId: string) => and(
  eq(agentSessions.id, threadId),
  eq(agentSessions.userId, userId),
  eq(agentSessions.engine, CHAT_ENGINE),
)

// Is there an assistant reply that answers this user turn?
export async function isTurnAnswered(userId: string, threadId: string, userSeq: number): Promise<boolean> {
  const rows = await db
    .select({ seq: sessionEvents.seq, payload: sessionEvents.payload })
    .from(sessionEvents)
    .innerJoin(agentSessions, eq(agentSessions.id, sessionEvents.sessionId))
    .where(and(
      threadScope(userId, threadId),
      eq(sessionEvents.kind, 'message'),
      gt(sessionEvents.seq, userSeq),
    ))
  return turnCoveredBy(rows.map((r) => toMark(r.seq, r.payload)), userSeq)
}

export type ReplyOnceOutcome =
  | { ok: true; messageId: string; seq: number }
  | { ok: false; reason: 'thread_not_found' | 'already_answered' }

// Append an assistant reply for `answersSeq` unless the turn is already
// answered — check and insert under the thread row lock appendChatMessage
// also takes, so two writers (routine apply vs watchdog/sweep fallback)
// cannot both pass the check.
export async function appendAssistantReplyOnce(
  userId: string,
  threadId: string,
  answersSeq: number,
  payload: Omit<ChatMessagePayload, 'role'>,
): Promise<ReplyOnceOutcome> {
  return db.transaction(async (tx) => {
    const [thread] = await tx
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(threadScope(userId, threadId))
      .for('update')
    if (!thread) return { ok: false as const, reason: 'thread_not_found' as const }

    const later = await tx
      .select({ seq: sessionEvents.seq, payload: sessionEvents.payload })
      .from(sessionEvents)
      .where(and(
        eq(sessionEvents.sessionId, threadId),
        eq(sessionEvents.kind, 'message'),
        gt(sessionEvents.seq, answersSeq),
      ))
    if (turnCoveredBy(later.map((r) => toMark(r.seq, r.payload)), answersSeq)) {
      return { ok: false as const, reason: 'already_answered' as const }
    }

    const [last] = await tx
      .select({ seq: sessionEvents.seq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, threadId))
      .orderBy(desc(sessionEvents.seq))
      .limit(1)
    const nextSeq = (last?.seq ?? 0) + 1

    const [inserted] = await tx
      .insert(sessionEvents)
      .values({
        sessionId: threadId,
        seq: nextSeq,
        kind: 'message',
        payload: {
          role: 'assistant',
          content: payload.content,
          answersSeq,
          ...(payload.citations?.length ? { citations: payload.citations } : {}),
          ...(payload.retrieval && hasAnyRetrieval(payload.retrieval) ? { retrieval: payload.retrieval } : {}),
          ...(payload.model ? { model: payload.model } : {}),
        },
      })
      .returning({ id: sessionEvents.id })
    return { ok: true as const, messageId: inserted.id, seq: nextSeq }
  })
}
