import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/memories', () => ({
  searchMemoriesFts: vi.fn(),
  listRecentMemories: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({ findProjects: vi.fn() }))

vi.mock('@/lib/data/ask', () => ({
  getKairosAskSourceSnippets: vi.fn(),
  getPendingKairosAsk: vi.fn(),
}))

vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  getChatThread: vi.fn(),
  updateChatMessageContent: vi.fn(),
}))

vi.mock('@/lib/kairos/reactions', () => ({ reactUsed: vi.fn(async () => undefined) }))

vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(),
}))

vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn() }))

vi.mock('@/lib/kairos/chat-retrieval', async () => {
  const citations = await vi.importActual<typeof import('@/lib/kairos/chat-retrieval-citations')>(
    '@/lib/kairos/chat-retrieval-citations',
  )
  return { ...citations, retrieveForChatGlobal: vi.fn() }
})

vi.mock('@/lib/kairos/chat-board-context', () => ({
  matchProjectsInMessage: vi.fn(),
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-recency-context', () => ({
  fetchRecentActivityContext: vi.fn(),
  renderRecentActivitySection: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

vi.mock('@/lib/kairos/chat-turn-reply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kairos/chat-turn-reply')>()),
  appendAssistantReplyOnce: vi.fn(),
}))

import { appendAssistantReplyOnce } from '@/lib/kairos/chat-turn-reply'
import { getPendingKairosAsk } from '@/lib/data/ask'
import { appendChatMessage, getChatThread, updateChatMessageContent } from '@/lib/data/kairos-chat'
import { reactUsed } from '@/lib/kairos/reactions'
import { listJobs } from '@/lib/data/thinking-jobs'
import type { AIProvider } from '@/lib/ai/provider'
import { getProviderForTask } from '@/lib/ai/route-task'
import { retrieveForChatGlobal } from '@/lib/kairos/chat-retrieval'
import { matchProjectsInMessage } from '@/lib/kairos/chat-board-context'
import { fetchRecentActivityContext } from '@/lib/kairos/chat-recency-context'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import {
  buildAssistantTurn,
  CHAT_CUT_SHORT_MARKER,
  persistAssistantReply,
  persistAssistantReplyOnce,
  runAssistantTurn,
  runAssistantTurnOnce,
  sendChatMessage,
  turnCoveredBy,
} from '../chat-turn'
import { CHAT_REPLY_PENDING_MESSAGE } from '../chat-routine'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CORTEX_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FAKE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const retrieval = {
  cortex: { id: CORTEX_ID, title: 'Hydra cortex', body: 'Hydra ships Friday.' },
  archetypes: [],
  substrate: [],
} as unknown as Awaited<ReturnType<typeof retrieveForChatGlobal>>

const providerAsk = vi.fn<AIProvider['ask']>()
const provider: AIProvider = {
  providerId: 'fake',
  modelId: 'fake-model',
  ask: providerAsk,
  stream: async function* stream() {},
}

function threadWith(messages: Array<{ id: string; seq: number; role: 'user' | 'assistant'; content: string }>) {
  return {
    thread: {
      id: THREAD_ID, dominionId: null, dominionName: null, title: 'Telegram · Kairos',
      status: 'running', createdAt: new Date(), lastMessageAt: null, messageCount: messages.length,
    },
    messages: messages.map((m) => ({
      ...m, threadId: THREAD_ID, citations: [], retrieval: null, model: null, createdAt: new Date(),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_CHAT_AGENTIC_TOOLS = '0'
  vi.mocked(getChatThread).mockResolvedValue(threadWith([
    { id: 'm1', seq: 1, role: 'user', content: 'status of hydra?' },
  ]))
  vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'm2', seq: 2 })
  vi.mocked(retrieveForChatGlobal).mockResolvedValue(retrieval)
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
  vi.mocked(matchProjectsInMessage).mockResolvedValue([])
  vi.mocked(fetchRecentActivityContext).mockResolvedValue(null)
  vi.mocked(getProviderForTask).mockResolvedValue({
    decision: { providerId: 'fake', modelId: 'fake-model', tier: 'standard', source: 'default' },
    provider,
  })
})

afterEach(() => {
  delete process.env.KAIROS_CHAT_AGENTIC_TOOLS
  delete process.env.KAIROS_TELEGRAM_ROUTINE
})

describe('buildAssistantTurn', () => {
  it('returns the system prompt, the full message list and serialisable citation context', async () => {
    const built = await buildAssistantTurn(USER_ID, THREAD_ID, {
      dominionId: null, userBody: 'status of hydra?', userSeq: 1, surface: 'telegram',
    })
    if (!built.ok) throw new Error('build failed')
    const { turn } = built
    expect(turn.messages[0]).toEqual({ role: 'system', content: turn.system })
    expect(turn.messages[turn.messages.length - 1]).toEqual({ role: 'user', content: 'status of hydra?' })
    expect(turn.system).toContain('Hydra cortex')
    expect(turn.citationsContext).toEqual({
      retrieved: { cortex: { id: CORTEX_ID }, archetypes: [], substrate: [] },
      retrievalMeta: { cortex: { id: CORTEX_ID, title: 'Hydra cortex' } },
    })
    expect(JSON.parse(JSON.stringify(turn.citationsContext))).toEqual(turn.citationsContext)
  })
})

describe('paid path = build → callAssistant → persist', () => {
  it('sends the built messages and persists exactly what persistAssistantReply would', async () => {
    const raw = `Hydra ships Friday [[${CORTEX_ID}]] and [[${FAKE_ID}]].`
    providerAsk.mockResolvedValueOnce({ text: raw, providerId: 'fake', modelId: 'fake-model', finishReason: 'stop' })

    const paid = await runAssistantTurn(USER_ID, THREAD_ID, null, 'status of hydra?', 1, { surface: 'telegram' })
    const built = await buildAssistantTurn(USER_ID, THREAD_ID, {
      dominionId: null, userBody: 'status of hydra?', userSeq: 1, surface: 'telegram',
    })
    if (!built.ok) throw new Error('build failed')
    expect(providerAsk.mock.calls[0][0].messages).toEqual(built.turn.messages)

    const split = await persistAssistantReply(USER_ID, THREAD_ID, raw, {
      userSeq: 1, userBody: 'status of hydra?', model: 'fake-model', finishReason: 'stop',
      citationsContext: built.turn.citationsContext,
    })
    expect(split).toEqual(paid)
    const [paidAppend, splitAppend] = vi.mocked(appendChatMessage).mock.calls
    expect(splitAppend).toEqual(paidAppend)
    // Hallucinated id stripped; the retrieved one kept and reacted to.
    expect(paidAppend[2]).toMatchObject({ role: 'assistant', citations: [CORTEX_ID], model: 'fake-model' })
    expect(reactUsed).toHaveBeenCalledWith(USER_ID, [CORTEX_ID], expect.any(String))
  })
})

describe('persistAssistantReply', () => {
  it('applies the P0 cut-short guard', async () => {
    const text = 'The hydra board has three open cards and nothing blocked right now. The release card moved to review. Then the tail goes on and o'
    const result = await persistAssistantReply(USER_ID, THREAD_ID, text, {
      userSeq: 1, userBody: 'q', model: null, finishReason: 'length', citationsContext: { retrieved: null },
    })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.assistantContent).toBe(
      `The hydra board has three open cards and nothing blocked right now. The release card moved to review.\n\n${CHAT_CUT_SHORT_MARKER}`,
    )
  })

  it('rejects an empty reply without persisting', async () => {
    const result = await persistAssistantReply(USER_ID, THREAD_ID, '  ', {
      userSeq: 1, userBody: 'q', model: null, citationsContext: { retrieved: null },
    })
    expect(result).toEqual({ ok: false, reason: 'ai_empty', threadId: THREAD_ID })
    expect(appendChatMessage).not.toHaveBeenCalled()
  })
})

describe('exclusive persist (chat thinking jobs)', () => {
  it('records the answered turn and returns the persisted reply', async () => {
    vi.mocked(appendAssistantReplyOnce).mockResolvedValueOnce({ ok: true, messageId: 'm3', seq: 3 })
    const result = await persistAssistantReplyOnce(USER_ID, THREAD_ID, `Green [[${CORTEX_ID}]].`, {
      userSeq: 2, userBody: 'q', model: 'claude-code-routine',
      citationsContext: { retrieved: { cortex: { id: CORTEX_ID }, archetypes: [], substrate: [] } },
    })
    expect(result).toEqual({
      ok: true, threadId: THREAD_ID, userSeq: 2, assistantSeq: 3,
      assistantContent: `Green [[${CORTEX_ID}]].`, model: 'claude-code-routine',
    })
    expect(appendAssistantReplyOnce).toHaveBeenCalledWith(USER_ID, THREAD_ID, 2, expect.objectContaining({
      content: `Green [[${CORTEX_ID}]].`, citations: [CORTEX_ID],
    }))
    expect(appendChatMessage).not.toHaveBeenCalled()
  })

  it('writes nothing else when the turn is already answered', async () => {
    vi.mocked(appendAssistantReplyOnce).mockResolvedValueOnce({ ok: false, reason: 'already_answered' })
    const result = await persistAssistantReplyOnce(USER_ID, THREAD_ID, `Green [[${CORTEX_ID}]].`, {
      userSeq: 2, userBody: 'q', model: null,
      citationsContext: { retrieved: { cortex: { id: CORTEX_ID }, archetypes: [], substrate: [] } },
    })
    expect(result).toEqual({ ok: false, reason: 'already_answered', threadId: THREAD_ID })
    expect(reactUsed).not.toHaveBeenCalled()
  })

  it('the paid fallback path drops its reply when a routine reply landed while it was thinking', async () => {
    providerAsk.mockResolvedValueOnce({ text: 'Paid.', providerId: 'fake', modelId: 'fake-model', finishReason: 'stop' })
    vi.mocked(appendAssistantReplyOnce).mockResolvedValueOnce({ ok: false, reason: 'already_answered' })
    const result = await runAssistantTurnOnce(USER_ID, THREAD_ID, null, 'status of hydra?', 1, { surface: 'telegram' })
    expect(result).toEqual({ ok: false, reason: 'already_answered', threadId: THREAD_ID })
    expect(appendChatMessage).not.toHaveBeenCalled()
  })
})

describe('reply ledger attribution (turnCoveredBy)', () => {
  const u = (seq: number) => ({ seq, role: 'user' as const, answersSeq: null })
  const a = (seq: number, answersSeq: number | null) => ({ seq, role: 'assistant' as const, answersSeq })

  it('a reply covers its own turn and every earlier one, never a later one', () => {
    const thread = [u(1), u(2), a(3, 2)]
    expect(turnCoveredBy(thread, 1)).toBe(true)
    expect(turnCoveredBy(thread, 2)).toBe(true)
    expect(turnCoveredBy([u(1), u(2), a(3, 1)], 2)).toBe(false)
  })

  it('an unattributed reply counts for turns before it only', () => {
    expect(turnCoveredBy([u(1), a(2, null), u(3)], 1)).toBe(true)
    expect(turnCoveredBy([u(1), a(2, null), u(3)], 3)).toBe(false)
  })
})

describe('sendChatMessage orphan retry vs a pending chat job', () => {
  it('flag on: does not answer or rewrite a turn the chat routine owns', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    vi.mocked(listJobs).mockImplementation(async (_u, f) => (f?.status === 'queued'
      ? [{ externalKey: `chat:${THREAD_ID}:m1` } as ThinkingJobRow]
      : []))

    const result = await sendChatMessage(USER_ID, THREAD_ID, 'edited text')

    expect(result).toEqual({ ok: false, reason: 'ai_failed', message: CHAT_REPLY_PENDING_MESSAGE, threadId: THREAD_ID })
    expect(updateChatMessageContent).not.toHaveBeenCalled()
    expect(providerAsk).not.toHaveBeenCalled()
    expect(appendChatMessage).not.toHaveBeenCalled()
  })

  it('flag on: a job the watchdog took over still owns the turn while its paid fallback may be running', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    vi.mocked(listJobs).mockImplementation(async (_u, f) => (f?.status === undefined && f?.since
      ? [{ externalKey: `chat:${THREAD_ID}:m1`, status: 'failed', error: 'chat-watchdog: x' } as ThinkingJobRow]
      : []))

    const result = await sendChatMessage(USER_ID, THREAD_ID, 'status of hydra?')

    expect(result).toEqual({ ok: false, reason: 'ai_failed', message: CHAT_REPLY_PENDING_MESSAGE, threadId: THREAD_ID })
    expect(providerAsk).not.toHaveBeenCalled()
    expect(appendChatMessage).not.toHaveBeenCalled()
  })

  it('flag off: retries the orphan exactly as before, with no job lookup', async () => {
    providerAsk.mockResolvedValueOnce({ text: 'Answer.', providerId: 'fake', modelId: 'fake-model', finishReason: 'stop' })

    const result = await sendChatMessage(USER_ID, THREAD_ID, 'status of hydra?')

    expect(result).toMatchObject({ ok: true, assistantContent: 'Answer.', userSeq: 1 })
    expect(listJobs).not.toHaveBeenCalled()
  })
})
