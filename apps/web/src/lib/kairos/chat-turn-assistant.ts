import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import {
  getKairosAskSourceSnippets,
  getPendingKairosAsk,
  type KairosAskRow,
} from '@/lib/data/ask'
import { getChatThread, appendChatMessage, type ChatMessagePayload } from '@/lib/data/kairos-chat'
import type { ChatRetrievalMeta } from '@/lib/data/kairos-chat-payload'
import { buildChatMessages, type ChatPromptPendingAsk } from '@/lib/kairos/chat-prompt'
import {
  retrieveForChatGlobal,
  extractCitationIds,
  intersectWithRetrieved,
  type ChatRetrieval,
} from '@/lib/kairos/chat-retrieval'
import { toPromptRetrieval, toRetrievalMeta } from '@/lib/kairos/chat-retrieval-mapping'
import {
  matchProjectsInMessage,
  fetchLiveBoardContext,
  renderLiveBoardSection,
  type LiveBoardContext,
} from '@/lib/kairos/chat-board-context'
import {
  fetchRecentActivityContext,
  renderRecentActivitySection,
} from '@/lib/kairos/chat-recency-context'
import { buildChatTools, runChatToolLoop } from '@/lib/kairos/chat-tools'
import type { CitationRetrievalShape } from '@/lib/kairos/chat-retrieval-citations'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import type { AIMessage } from '@/lib/ai/provider'
import { reactUsed } from '@/lib/kairos/reactions'
import {
  appendAssistantReplyOnce,
  applyAskResolution,
  classifyAskResolution,
  guardChatReply,
  pendingAskRationale,
  type AlreadyAnsweredResult,
  type AskResolution,
  type ChatTurnOptions,
  type KairosChatTurnResult,
  type ReplyOnceOutcome,
} from '@/lib/kairos/chat-turn-reply'

// Assistant half of a chat turn (split out of chat-turn.ts): build the
// context, call the paid model, persist the reply. Shared by the paid path
// and the Telegram chat routine job (lib/kairos/thinking/handlers/chat.ts).

// Model output before the P0 cut-short guard — persistAssistantReply guards it.
interface RawAssistantReply {
  content: string
  model: string | null
  finishReason?: string
  askResolution?: AskResolution
}

async function loadPendingAskContext(
  userId: string,
): Promise<{ pending: KairosAskRow; prompt: ChatPromptPendingAsk } | null> {
  try {
    const pending = await getPendingKairosAsk(userId)
    if (!pending) return null
    const sourceSnippets = await getKairosAskSourceSnippets(
      userId,
      pending.askMine?.sourceMemoryIds ?? pending.kairosAsk.sourceMemoryIds,
    ).catch((error) => {
      console.error('[kairos-chat] ask source lookup failed', {
        askId: pending.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    })
    return {
      pending,
      prompt: {
        question: pending.title,
        kind: pending.askMine?.kind ?? 'aether',
        rationale: pendingAskRationale(pending),
        sourceSnippets,
      },
    }
  } catch (error) {
    console.error('[kairos-chat] pending ask lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// Deterministic live-board grounding: if the operator names one of their
// projects in-message, fetch its current state straight from the data layer
// and render it into a prompt block. Retrieval-derived memories are always
// somewhat stale; this leg gives Kairos ground truth for the boards named.
// Non-fatal by design — mirrors the retrieval fallback above.
async function loadBoardSection(userId: string, threadId: string, userBody: string): Promise<string | undefined> {
  try {
    const matches = await matchProjectsInMessage(userId, userBody)
    if (matches.length === 0) return undefined

    const contexts = await Promise.all(
      matches.map((m) => fetchLiveBoardContext(userId, m.id)),
    )
    const found = contexts.filter((c): c is LiveBoardContext => c !== null)
    if (found.length === 0) return undefined

    return renderLiveBoardSection(found)
  } catch (err) {
    console.warn('[kairos-chat] live board context failed, proceeding without it', {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

// Deterministic recency grounding: last-24h coding sessions, reflections,
// introspection proposals, asks, and board activity — fresher than any
// synthesised memory (see chat-recency-context.ts header). Non-fatal by
// design: fetchRecentActivityContext already catches internally and returns
// null on error or on a genuinely quiet window, so there is nothing to log
// here beyond that call.
async function loadRecencySection(userId: string): Promise<string | undefined> {
  const ctx = await fetchRecentActivityContext(userId)
  return ctx ? renderRecentActivitySection(ctx) : undefined
}

// Default ON: the agentic tool loop is the standard chat path now. Only an
// explicit '0' or 'false' (any case) opts back out — the kill switch from the
// original opt-in flag, inverted.
function agenticToolsEnabled(): boolean {
  const raw = process.env.KAIROS_CHAT_AGENTIC_TOOLS?.trim().toLowerCase()
  return raw !== '0' && raw !== 'false'
}

async function callAssistant(
  userId: string,
  dominionId: string | null,
  systemMessages: ReturnType<typeof buildChatMessages>,
  pendingAsk: KairosAskRow | null,
  userBody: string,
): Promise<RawAssistantReply | { error: 'no_credential' } | { error: 'empty' } | { error: 'failed'; message: string }> {
  try {
    const { provider } = await getProviderForTask(userId, {
      taskType: 'chat',
      dominionId,
    })
    // No temperature: current-gen Claude models 400 on non-default values
    // (same reason PR #84 stripped it from the synthesis call sites).
    // Agentic tools default ON as of the live-mind work: only an explicit
    // '0'/'false' opts back out to the plain (no tools key) call — the kill
    // switch stays, but the WP2 lookup loop is now the default path. The
    // deterministic board/recency sections are already baked into
    // systemMessages in both modes.
    const response = agenticToolsEnabled()
      ? await runChatToolLoop(provider, systemMessages, buildChatTools(userId), {
          maxOutputTokens: 2000,
        })
      : await provider.ask({
          messages: systemMessages,
          maxOutputTokens: 2000,
        })
    const raw = response.text.trim()
    if (!raw) return { error: 'empty' }
    const askResolution = pendingAsk
      ? await classifyAskResolution(provider, pendingAsk, userBody)
      : undefined
    return { content: raw, model: response.modelId, finishReason: response.finishReason, askResolution }
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { error: 'no_credential' }
    if (err instanceof AiCredentialDecryptError) return { error: 'no_credential' }
    return { error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

// What a persisted reply needs to keep citations honest, serialisable so a
// chat thinking job can carry it to whichever reasoner answers: the ids that
// were retrieved this turn (citations are intersected with them) and the
// retrieval meta stored on the assistant message.
export interface ChatCitationsContext {
  retrieved: CitationRetrievalShape | null
  retrievalMeta?: ChatRetrievalMeta
}

export interface AssistantTurnOptions extends ChatTurnOptions {
  dominionId: string | null
  userBody: string
  userSeq: number
}

export interface BuiltAssistantTurn {
  // The system prompt alone, and the full message list (system first, then
  // trimmed history, then the user turn) exactly as the paid model sees it.
  system: string
  messages: AIMessage[]
  citationsContext: ChatCitationsContext
  pendingAsk: KairosAskRow | null
}

// Context half of an assistant turn: Dominion frame, history, pending ask,
// whole-brain retrieval, live board + recency sections → chat messages.
// Shared by the paid path (runAssistantTurn) and the chat routine job.
export async function buildAssistantTurn(
  userId: string,
  threadId: string,
  opts: AssistantTurnOptions,
): Promise<{ ok: true; turn: BuiltAssistantTurn } | { ok: false; reason: 'dominion_not_found' | 'thread_not_found' }> {
  const { dominionId, userBody, userSeq } = opts
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

  const pendingAskContext = await loadPendingAskContext(userId)

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
  const [boardSection, recencySection] = await Promise.all([
    loadBoardSection(userId, threadId, userBody),
    loadRecencySection(userId),
  ])

  const messages = buildChatMessages({
    dominion,
    history: priorHistory,
    userMessage: userBody,
    retrieval: promptRetrieval,
    surface: opts.surface,
    pendingAsk: pendingAskContext?.prompt,
    boardSection,
    recencySection,
  })

  return {
    ok: true,
    turn: {
      system: messages[0]?.role === 'system' ? messages[0].content : '',
      messages,
      citationsContext: {
        retrieved: retrieval ? toCitationShape(retrieval) : null,
        ...(retrieval ? { retrievalMeta: toRetrievalMeta(retrieval) } : {}),
      },
      pendingAsk: pendingAskContext?.pending ?? null,
    },
  }
}

function toCitationShape(r: ChatRetrieval): CitationRetrievalShape {
  return {
    cortex: r.cortex ? { id: r.cortex.id } : null,
    archetypes: r.archetypes.map((a) => ({ id: a.id })),
    substrate: r.substrate.map((s) => ({ id: s.id })),
  }
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
  const raw = text.trim()
  if (!raw) return { ok: false, reason: 'ai_empty', threadId }
  const content = guardChatReply(raw, meta.finishReason)
  if (content !== raw) {
    console.warn('[kairos-chat] reply did not finish cleanly, trimmed', {
      finishReason: meta.finishReason,
      rawChars: raw.length,
      keptChars: content.length,
    })
  }

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

  // Memory engine reaction (docs/kairos/32 §2): memories actually cited in the
  // persisted reply (hallucinated ids already stripped) → Usage + 'feedback'
  // op. reactUsed swallows its own errors, so this never fails the turn.
  if (citedIds.length > 0) await reactUsed(userId, citedIds, 'cited in kairos chat reply')

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

  const reply = await callAssistant(
    userId,
    dominionId,
    turn.messages,
    turn.pendingAsk,
    userBody,
  )
  if ('error' in reply) {
    // The user message is already persisted on `threadId` — surface it so the
    // client recovers to this thread on retry (no duplicate thread).
    if (reply.error === 'no_credential') return { ok: false, reason: 'no_credential', threadId }
    if (reply.error === 'empty') return { ok: false, reason: 'ai_empty', threadId }
    return { ok: false, reason: 'ai_failed', message: reply.message, threadId }
  }

  return persist(reply.content, {
    userSeq,
    userBody,
    model: reply.model,
    finishReason: reply.finishReason,
    citationsContext: turn.citationsContext,
    pendingAsk: turn.pendingAsk,
    askResolution: reply.askResolution,
  })
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
