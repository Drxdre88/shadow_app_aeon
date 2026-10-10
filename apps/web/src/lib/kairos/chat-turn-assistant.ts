import type { KairosAskRow } from '@/lib/data/ask'
import { appendChatMessage, type ChatMessagePayload } from '@/lib/data/kairos-chat'
import type { buildChatMessages } from '@/lib/kairos/chat-prompt'
import { extractCitationIds, intersectWithRetrieved } from '@/lib/kairos/chat-retrieval'
import { buildChatTools, runChatToolLoop } from '@/lib/kairos/chat-tools'
import { extractStance } from '@/lib/kairos/cold-read/stance'
import { finishChatReply } from '@/lib/kairos/moment/chat'
import { runDetached } from '@/lib/kairos/moment/detached'
import { chatTodayChannel, recordChatReply, type ChatTodayChannel } from '@/lib/kairos/chat-today'
import { buildAssistantTurn, type ChatCitationsContext } from '@/lib/kairos/chat-turn-context'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { isPaidBackupOffError } from '@/lib/ai/paid-backup-off'
import type { AIProvider } from '@/lib/ai/provider'
import { reactUsed } from '@/lib/kairos/reactions'
import {
  appendAssistantReplyOnce,
  applyAskResolution,
  classifyAskResolution,
  type AlreadyAnsweredResult,
  type AskResolution,
  type ChatTurnOptions,
  type KairosChatTurnResult,
  type ReplyOnceOutcome,
} from '@/lib/kairos/chat-turn-reply'

// Assistant half of a chat turn (split out of chat-turn.ts): build the
// context (chat-turn-context.ts), call the paid model, persist the reply.
// Shared by the paid path and the Telegram chat routine job
// (lib/kairos/thinking/handlers/chat.ts).
//
// The voice channel defers the work nobody hears: the pending-ask classifier
// and memory reinforcement run detached after the reply is saved, so the
// voice line's `done` is not held up by them.

export {
  buildAssistantTurn,
  type AssistantTurnOptions,
  type BuiltAssistantTurn,
  type ChatCitationsContext,
} from '@/lib/kairos/chat-turn-context'

// Model output before the P0 cut-short guard — persistAssistantReply guards it.
interface RawAssistantReply {
  content: string
  model: string | null
  finishReason?: string
  askResolution?: AskResolution
  provider: AIProvider
}

// Default ON: the agentic tool loop is the standard chat path now. Only an
// explicit '0' or 'false' (any case) opts back out — the kill switch from the
// original opt-in flag, inverted.
function agenticToolsEnabled(): boolean {
  const raw = process.env.KAIROS_CHAT_AGENTIC_TOOLS?.trim().toLowerCase()
  return raw !== '0' && raw !== 'false'
}

interface CallAssistantOptions {
  provider?: AIProvider
  sideProvider?: AIProvider
  tools: boolean
  // Classify the pending ask now (before persisting); false = the caller defers it.
  classifyNow: boolean
}

async function callAssistant(
  userId: string,
  dominionId: string | null,
  systemMessages: ReturnType<typeof buildChatMessages>,
  pendingAsk: KairosAskRow | null,
  userBody: string,
  opts: CallAssistantOptions,
): Promise<RawAssistantReply | { error: 'no_credential' } | { error: 'paid_backup_off' } | { error: 'empty' } | { error: 'failed'; message: string }> {
  try {
    const provider = opts.provider ?? (await getProviderForTask(userId, {
      taskType: 'chat',
      dominionId,
    })).provider
    // No temperature: current-gen Claude models 400 on non-default values
    // (same reason PR #84 stripped it from the synthesis call sites).
    // Agentic tools default ON as of the live-mind work: only an explicit
    // '0'/'false' opts back out to the plain (no tools key) call — the kill
    // switch stays, but the WP2 lookup loop is now the default path. A caller
    // can also answer tool-less (`tools: false`, the voice line's simple
    // questions). The deterministic board/recency sections are already baked
    // into systemMessages in both modes.
    const response = opts.tools && agenticToolsEnabled()
      ? await runChatToolLoop(provider, systemMessages, buildChatTools(userId), {
          maxOutputTokens: 2000,
        })
      : await provider.ask({
          messages: systemMessages,
          maxOutputTokens: 2000,
        })
    const raw = response.text.trim()
    if (!raw) return { error: 'empty' }
    const askResolution = pendingAsk && opts.classifyNow
      ? await classifyAskResolution(opts.sideProvider ?? provider, pendingAsk, userBody)
      : undefined
    return { content: raw, model: response.modelId, finishReason: response.finishReason, askResolution, provider }
  } catch (err) {
    if (isPaidBackupOffError(err)) return { error: 'paid_backup_off' }
    if (err instanceof AiCredentialMissingError) return { error: 'no_credential' }
    if (err instanceof AiCredentialDecryptError) return { error: 'no_credential' }
    return { error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

// Voice: the pending ask is classified after the reply is saved, detached,
// on the untapped provider, so its answer is never spoken and never delays
// `done`. Never throws (classifyAskResolution falls back to not answered).
function deferAskResolution(userId: string, provider: AIProvider, pending: KairosAskRow, userBody: string): void {
  runDetached(async () => {
    try {
      const resolution = await classifyAskResolution(provider, pending, userBody)
      if (resolution.answersPending) await applyAskResolution(userId, pending, resolution, userBody)
    } catch (error) {
      console.error('[kairos-chat] deferred ask resolution failed', {
        askId: pending.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

export interface PersistAssistantReplyMeta {
  userSeq: number
  userBody: string
  model: string | null
  // undefined = clean / unknown finish (routine answers, deadline fallbacks).
  finishReason?: string
  citationsContext: ChatCitationsContext
  // Ask resolution is applied only when both are present.
  pendingAsk?: KairosAskRow | null
  askResolution?: AskResolution
  // Where the turn happened, for the "today" log. Absent = web.
  channel?: ChatTodayChannel
  // Reinforce cited memories detached instead of before returning (voice).
  deferReinforcement?: boolean
}

type ReplyAppender = (payload: Omit<ChatMessagePayload, 'role'>) => Promise<ReplyOnceOutcome>

// Persistence half of an assistant turn: P0 cut-short guard, hallucinated-
// citation strip, assistant append, memory reactions, pending-ask answer.
async function persistReply(
  userId: string,
  threadId: string,
  text: string,
  meta: PersistAssistantReplyMeta,
  append: ReplyAppender,
): Promise<KairosChatTurnResult | AlreadyAnsweredResult> {
  const raw = extractStance(text).text.trim()
  if (!raw) return { ok: false, reason: 'ai_empty', threadId }
  const content = await finishChatReply(userId, threadId, raw, {
    userSeq: meta.userSeq,
    userBody: meta.userBody,
    channel: meta.channel ?? 'web',
    finishReason: meta.finishReason,
  })

  // Strip hallucinated citations: only persist ids that were actually
  // retrieved this turn. UI then renders only chips it can name.
  const { retrieved, retrievalMeta } = meta.citationsContext
  const citedIds = retrieved
    ? intersectWithRetrieved(extractCitationIds(content), retrieved)
    : []

  const asstAppend = await append({
    content,
    model: meta.model ?? undefined,
    ...(citedIds.length ? { citations: citedIds } : {}),
    ...(retrievalMeta ? { retrieval: retrievalMeta } : {}),
  })
  if (!asstAppend.ok) {
    return asstAppend.reason === 'already_answered'
      ? { ok: false, reason: 'already_answered', threadId }
      : { ok: false, reason: 'thread_not_found' }
  }

  // One mind: the reply's gist joins today's log (never throws). Only after a
  // real append — an already-answered turn records nothing.
  await recordChatReply(userId, threadId, asstAppend.seq, content, meta.channel ?? 'web')

  // Memory engine reaction (docs/kairos/32 §2): memories actually cited in the
  // persisted reply (hallucinated ids already stripped) → Usage + 'feedback'
  // op. reactUsed swallows its own errors, so this never fails the turn.
  if (citedIds.length > 0) {
    if (meta.deferReinforcement) runDetached(() => reactUsed(userId, citedIds, 'cited in kairos chat reply'))
    else await reactUsed(userId, citedIds, 'cited in kairos chat reply')
  }

  if (meta.pendingAsk && meta.askResolution?.answersPending) {
    await applyAskResolution(userId, meta.pendingAsk, meta.askResolution, meta.userBody)
  }

  return {
    ok: true,
    threadId,
    userSeq: meta.userSeq,
    assistantSeq: asstAppend.seq,
    assistantContent: content,
    model: meta.model,
  }
}

function narrowPlain(result: KairosChatTurnResult | AlreadyAnsweredResult): KairosChatTurnResult {
  if (!result.ok && result.reason === 'already_answered') {
    throw new Error('unreachable: a plain append never reports already_answered')
  }
  return result
}

export async function persistAssistantReply(
  userId: string,
  threadId: string,
  text: string,
  meta: PersistAssistantReplyMeta,
): Promise<KairosChatTurnResult> {
  return narrowPlain(await persistReply(userId, threadId, text, meta,
    (payload) => appendChatMessage(userId, threadId, { role: 'assistant', ...payload })))
}

// Exclusive variant for chat thinking jobs: the reply records the turn it
// answers, and nothing is written when that turn (or a later one) already
// has a reply — the routine apply and the watchdog/sweep fallback cannot
// both answer one turn.
export async function persistAssistantReplyOnce(
  userId: string,
  threadId: string,
  text: string,
  meta: PersistAssistantReplyMeta,
): Promise<KairosChatTurnResult | AlreadyAnsweredResult> {
  return persistReply(userId, threadId, text, meta,
    (payload) => appendAssistantReplyOnce(userId, threadId, meta.userSeq, payload))
}

type ReplyPersister = (text: string, meta: PersistAssistantReplyMeta) => Promise<KairosChatTurnResult | AlreadyAnsweredResult>

// Paid path: build → callAssistant → persist.
async function runTurn(
  userId: string,
  threadId: string,
  dominionId: string | null,
  userBody: string,
  userSeq: number,
  opts: ChatTurnOptions,
  persist: ReplyPersister,
): Promise<KairosChatTurnResult | AlreadyAnsweredResult> {
  const built = await buildAssistantTurn(userId, threadId, { ...opts, dominionId, userBody, userSeq })
  if (!built.ok) return { ok: false, reason: built.reason }
  const { turn } = built
  // The voice line defers what nobody hears until after the reply is saved.
  const deferSideWork = opts.channel === 'voice'

  const reply = await callAssistant(
    userId,
    dominionId,
    turn.messages,
    turn.pendingAsk,
    userBody,
    { provider: opts.provider, sideProvider: opts.sideProvider, tools: opts.tools !== false, classifyNow: !deferSideWork },
  )
  opts.onMark?.('answered')
  if ('error' in reply) {
    // The user message is already persisted on `threadId` — surface it so the
    // client recovers to this thread on retry (no duplicate thread).
    if (reply.error === 'no_credential') return { ok: false, reason: 'no_credential', threadId }
    if (reply.error === 'paid_backup_off') return { ok: false, reason: 'paid_backup_off', threadId }
    if (reply.error === 'empty') return { ok: false, reason: 'ai_empty', threadId }
    return { ok: false, reason: 'ai_failed', message: reply.message, threadId }
  }

  const result = await persist(reply.content, {
    userSeq,
    userBody,
    model: reply.model,
    finishReason: reply.finishReason,
    citationsContext: turn.citationsContext,
    pendingAsk: turn.pendingAsk,
    askResolution: reply.askResolution,
    channel: chatTodayChannel(opts.surface, opts.channel),
    deferReinforcement: deferSideWork,
  })
  opts.onMark?.('saved')
  if (result.ok && deferSideWork && turn.pendingAsk) {
    deferAskResolution(userId, opts.sideProvider ?? reply.provider, turn.pendingAsk, userBody)
  }
  return result
}

export async function runAssistantTurn(
  userId: string,
  threadId: string,
  dominionId: string | null,
  userBody: string,
  userSeq: number,
  opts: ChatTurnOptions = {},
): Promise<KairosChatTurnResult> {
  return narrowPlain(await runTurn(userId, threadId, dominionId, userBody, userSeq, opts,
    (text, meta) => persistAssistantReply(userId, threadId, text, meta)))
}

// Paid path for a chat thinking job's fallback: persists through
// persistAssistantReplyOnce, so a reply that landed while the paid model was
// thinking wins and this one is dropped (already_answered, nothing written).
export async function runAssistantTurnOnce(
  userId: string,
  threadId: string,
  dominionId: string | null,
  userBody: string,
  userSeq: number,
  opts: ChatTurnOptions = {},
): Promise<KairosChatTurnResult | AlreadyAnsweredResult> {
  return runTurn(userId, threadId, dominionId, userBody, userSeq, opts,
    (text, meta) => persistAssistantReplyOnce(userId, threadId, text, meta))
}
