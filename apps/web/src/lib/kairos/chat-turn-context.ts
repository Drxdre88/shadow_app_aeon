import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import {
  getKairosAskSourceSnippets,
  getPendingKairosAsk,
  type KairosAskRow,
} from '@/lib/data/ask'
import { getChatThread } from '@/lib/data/kairos-chat'
import type { ChatRetrievalMeta } from '@/lib/data/kairos-chat-payload'
import { buildChatMessages, type ChatPromptMessage, type ChatPromptPendingAsk } from '@/lib/kairos/chat-prompt'
import { retrieveForChatGlobal, type ChatRetrieval } from '@/lib/kairos/chat-retrieval'
import { toPromptRetrieval, toRetrievalMeta } from '@/lib/kairos/chat-retrieval-mapping'
import type { CitationRetrievalShape } from '@/lib/kairos/chat-retrieval-citations'
import { loadConscienceBlock } from '@/lib/kairos/conscience-context'
import { loadMomentChatOptions, stripMomentFooters } from '@/lib/kairos/moment/chat'
import type { MomentChatOptions } from '@/lib/kairos/moment/types'
import { loadBoardSection, loadRecencySection } from '@/lib/kairos/chat-grounding'
import { loadChatTodaySection } from '@/lib/kairos/chat-today'
import { pendingAskRationale, type ChatTurnOptions } from '@/lib/kairos/chat-turn-reply'
import { trimRetrievalForVoice, VOICE_GROUNDING, VOICE_RETRIEVAL } from '@/lib/kairos/voice/grounding'
import type { AIMessage } from '@/lib/ai/provider'

// Context half of an assistant turn (split out of chat-turn-assistant.ts):
// Dominion frame, history, pending ask, whole-brain retrieval, live board,
// recency, conscience, today and moment sections → chat messages. Every
// independent read starts at once; only the moment lanes wait for history.
// The voice channel gets the voice-sized bundle (voice/grounding.ts) and no
// moment lanes, so its first token comes sooner.

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

type DominionFrame = { name: string; vision: string | null; missionLong: string | null }

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

// An anchored thread's Dominion frames the prompt (persona + vision/mission).
// Unanchored (null) threads get the whole-brain persona. 'missing' = the id
// names no Dominion of this user.
async function loadDominion(userId: string, dominionId: string | null): Promise<DominionFrame | null | 'missing'> {
  if (!dominionId) return null
  const [row] = await db
    .select({ name: dominions.name, vision: dominions.vision, missionLong: dominions.missionLong })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  return row ?? 'missing'
}

// JARVIS-level recall — whole-brain, no Dominion scope. Failure here must NOT
// block the reply (a warming brain has no Aether yet): fall back to bare chat,
// logged so a silently-bare reply is debuggable.
async function loadRetrieval(userId: string, threadId: string, opts: AssistantTurnOptions): Promise<ChatRetrieval | null> {
  const started = Date.now()
  try {
    if (opts.channel !== 'voice') return await retrieveForChatGlobal(userId, opts.userBody)
    const retrieval = await retrieveForChatGlobal(userId, opts.userBody, { ...VOICE_RETRIEVAL, ...(opts.onSpan ? { onTiming: opts.onSpan } : {}) })
    return trimRetrievalForVoice(retrieval)
  } catch (err) {
    console.error('[kairos-chat] retrieval failed, falling back to bare chat', {
      threadId,
      dominionId: opts.dominionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  } finally {
    opts.onSpan?.('retrieval', Date.now() - started)
    opts.onMark?.('retrieved')
  }
}

// Times one grounding read for the voice timing; a no-op wrapper otherwise.
function timed<T>(opts: AssistantTurnOptions, name: string, read: Promise<T>): Promise<T> {
  const onSpan = opts.onSpan
  if (!onSpan) return read
  const started = Date.now()
  return read.finally(() => onSpan(`section:${name}`, Date.now() - started))
}

function toCitationShape(r: ChatRetrieval): CitationRetrievalShape {
  return {
    cortex: r.cortex ? { id: r.cortex.id } : null,
    archetypes: r.archetypes.map((a) => ({ id: a.id })),
    substrate: r.substrate.map((s) => ({ id: s.id })),
  }
}

// Shared by the paid path (runAssistantTurn) and the chat routine job.
export async function buildAssistantTurn(
  userId: string,
  threadId: string,
  opts: AssistantTurnOptions,
): Promise<{ ok: true; turn: BuiltAssistantTurn } | { ok: false; reason: 'dominion_not_found' | 'thread_not_found' }> {
  const { dominionId, userBody, userSeq } = opts
  const voice = opts.channel === 'voice'

  const threadP = opts.loadedThread ? Promise.resolve(opts.loadedThread) : getChatThread(userId, threadId)
  const historyOf = (loaded: Awaited<typeof threadP>): ChatPromptMessage[] => (loaded?.messages ?? [])
    .filter((m) => m.seq < userSeq)
    .map((m) => ({ role: m.role, content: stripMomentFooters(m.content) }))
  // Stage, cold read and the wave 4 moment lanes (lib/kairos/moment); they
  // need the history. Voice skips them: owner-model, stage and style blocks
  // are web-chat weight that delays the first spoken word.
  const momentP: Promise<MomentChatOptions> = voice
    ? Promise.resolve({})
    : threadP.then((loaded) => (loaded
      ? loadMomentChatOptions(userId, { threadId, dominionId, userBody, userSeq, surface: opts.surface, history: historyOf(loaded) })
      : {}))

  const [dominion, thread, pendingAskContext, retrieval, boardSection, recencySection, conscienceSection, todaySection, moment] = await Promise.all([
    timed(opts, 'dominion', loadDominion(userId, dominionId)),
    timed(opts, 'history', threadP),
    timed(opts, 'pendingAsk', loadPendingAskContext(userId)),
    loadRetrieval(userId, threadId, opts),
    timed(opts, 'board', loadBoardSection(userId, threadId, userBody)),
    timed(opts, 'recency', loadRecencySection(userId)),
    // Constitution + held beliefs (P2.5 G4). Never throws — '' on failure.
    timed(opts, 'conscience', loadConscienceBlock(userId, { dominionId })),
    // Today across channels, minus this thread (one mind). '' on failure.
    timed(opts, 'today', voice ? loadChatTodaySection(userId, threadId, VOICE_GROUNDING.todayChars) : loadChatTodaySection(userId, threadId)),
    momentP,
  ])
  if (dominion === 'missing') return { ok: false, reason: 'dominion_not_found' }
  if (!thread) return { ok: false, reason: 'thread_not_found' }

  const history = historyOf(thread)
  const messages = buildChatMessages({
    dominion,
    history: voice ? history.slice(-VOICE_GROUNDING.historyMessages) : history,
    userMessage: userBody,
    retrieval: retrieval ? toPromptRetrieval(retrieval) : undefined,
    surface: opts.surface,
    channel: opts.channel,
    pendingAsk: pendingAskContext?.prompt,
    boardSection,
    recencySection,
    todaySection: todaySection || undefined,
    conscienceSection: conscienceSection || undefined,
    ...moment,
  })
  opts.onMark?.('grounded')

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
