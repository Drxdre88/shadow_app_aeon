import { beforeEach, describe, expect, it, vi } from 'vitest'

// One mind on the chat path: the owner turn and Kairos's reply are logged to
// "today" with the channel the turn came from, and the system prompt carries
// what was said on other channels (real chat-today + today-render; the today
// store itself is mocked).

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/memories', () => ({ searchMemoriesFts: vi.fn(), listRecentMemories: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjects: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({ getKairosAskSourceSnippets: vi.fn(), getPendingKairosAsk: vi.fn(async () => null) }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  getChatThread: vi.fn(),
  updateChatMessageContent: vi.fn(),
}))
vi.mock('@/lib/kairos/reactions', () => ({ reactUsed: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/thinking-jobs', () => ({ failJob: vi.fn(), findJobById: vi.fn(), listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn() }))
vi.mock('@/lib/kairos/chat-retrieval', async () => ({
  ...(await vi.importActual<typeof import('@/lib/kairos/chat-retrieval-citations')>('@/lib/kairos/chat-retrieval-citations')),
  retrieveForChatGlobal: vi.fn(async () => null),
}))
vi.mock('@/lib/kairos/chat-board-context', () => ({
  matchProjectsInMessage: vi.fn(async () => []),
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))
vi.mock('@/lib/kairos/chat-recency-context', () => ({
  fetchRecentActivityContext: vi.fn(async () => ({})),
  renderRecentActivitySection: vi.fn(() => '## LAST 24H recency'),
}))
vi.mock('@/lib/kairos/conscience-context', () => ({ loadConscienceBlock: vi.fn(async () => '') }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))
vi.mock('@/lib/kairos/chat-turn-reply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kairos/chat-turn-reply')>()),
  appendAssistantReplyOnce: vi.fn(),
}))
vi.mock('@/lib/kairos/today', () => ({
  loadTodayDigest: vi.fn(async () => null),
  recordToday: vi.fn(async () => undefined),
  recordTodayAfter: vi.fn(),
}))

import type { AIProvider } from '@/lib/ai/provider'
import { getProviderForTask } from '@/lib/ai/route-task'
import { appendChatMessage, getChatThread, updateChatMessageContent } from '@/lib/data/kairos-chat'
import { appendAssistantReplyOnce } from '@/lib/kairos/chat-turn-reply'
import { loadTodayDigest, recordToday, recordTodayAfter } from '@/lib/kairos/today'
import { buildAssistantTurn, persistAssistantReplyOnce, sendChatMessage } from '../chat-turn'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const providerAsk = vi.fn<AIProvider['ask']>()
const provider: AIProvider = { providerId: 'fake', modelId: 'fake-model', ask: providerAsk, stream: async function* stream() {} }

function threadWith(messages: Array<{ id: string; seq: number; role: 'user' | 'assistant'; content: string }>) {
  return {
    thread: {
      id: THREAD, dominionId: null, dominionName: null, title: 't', status: 'running',
      createdAt: new Date(), lastMessageAt: null, messageCount: messages.length,
    },
    messages: messages.map((m) => ({ ...m, threadId: THREAD, citations: [], retrieval: null, model: null, createdAt: new Date() })),
  }
}

const ownerCalls = () => vi.mocked(recordTodayAfter).mock.calls
const replyCalls = () => vi.mocked(recordToday).mock.calls

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_CHAT_AGENTIC_TOOLS = '0'
  vi.mocked(getChatThread).mockResolvedValue(threadWith([]))
  vi.mocked(appendChatMessage)
    .mockResolvedValueOnce({ ok: true, messageId: 'u2', seq: 2 })
    .mockResolvedValueOnce({ ok: true, messageId: 'a3', seq: 3 })
  vi.mocked(getProviderForTask).mockResolvedValue({
    decision: { providerId: 'fake', modelId: 'fake-model', tier: 'standard', source: 'default' },
    provider,
  })
  providerAsk.mockResolvedValue({ text: 'Friday it is.', providerId: 'fake', modelId: 'fake-model', finishReason: 'stop' })
})

describe('chat turn → today (writes)', () => {
  it('Telegram paid turn: owner statement (operator/telegram) and one reply gist (kairos/chat)', async () => {
    const out = await sendChatMessage(USER, THREAD, 'ship hydra friday', { surface: 'telegram' })
    expect(out).toMatchObject({ ok: true, userSeq: 2, assistantSeq: 3 })

    expect(ownerCalls()).toEqual([[USER, {
      key: `chat:${THREAD}:2`, channel: 'telegram', type: 'said', text: 'ship hydra friday',
      ref: { threadId: THREAD, seq: 2 }, covered: 'chat-distill',
    }, { kind: 'operator', via: 'telegram' }]])
    expect(replyCalls()).toEqual([[USER, {
      key: `chat:${THREAD}:3`, channel: 'telegram', type: 'replied', text: 'Friday it is.',
      ref: { threadId: THREAD, seq: 3 }, covered: 'chat-distill',
    }, { kind: 'kairos', via: 'chat' }]])
  })

  it('web (default surface) turn is logged on the web channel', async () => {
    await sendChatMessage(USER, THREAD, 'hello')
    expect(ownerCalls()[0][1]).toMatchObject({ channel: 'web' })
    expect(ownerCalls()[0][2]).toEqual({ kind: 'operator', via: 'web' })
    expect(replyCalls()[0][1]).toMatchObject({ channel: 'web', type: 'replied' })
  })

  it('an edited retry re-records the orphan under the same key with the new text', async () => {
    vi.mocked(getChatThread).mockResolvedValue(threadWith([{ id: 'u1', seq: 1, role: 'user', content: 'old' }]))
    vi.mocked(updateChatMessageContent).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof updateChatMessageContent>>)
    vi.mocked(appendChatMessage).mockReset().mockResolvedValue({ ok: true, messageId: 'a2', seq: 2 })

    await sendChatMessage(USER, THREAD, 'new', { surface: 'telegram' })

    expect(ownerCalls()).toHaveLength(1)
    expect(ownerCalls()[0][1]).toMatchObject({ key: `chat:${THREAD}:1`, text: 'new', channel: 'telegram' })
  })

  it('a failed model call logs the owner turn but no reply', async () => {
    providerAsk.mockRejectedValueOnce(new Error('boom'))
    const out = await sendChatMessage(USER, THREAD, 'hello', { surface: 'telegram' })
    expect(out).toMatchObject({ ok: false, reason: 'ai_failed' })
    expect(ownerCalls()).toHaveLength(1)
    expect(replyCalls()).toHaveLength(0)
  })

  it('reply-once: records the reply once with the job channel; an already-answered turn records nothing', async () => {
    vi.mocked(appendAssistantReplyOnce)
      .mockResolvedValueOnce({ ok: true, messageId: 'a3', seq: 3 })
      .mockResolvedValueOnce({ ok: false, reason: 'already_answered' })
    const meta = { userSeq: 2, userBody: 'q', model: null, citationsContext: { retrieved: null }, channel: 'telegram' as const }

    expect(await persistAssistantReplyOnce(USER, THREAD, 'Green.', meta)).toMatchObject({ ok: true })
    expect(await persistAssistantReplyOnce(USER, THREAD, 'Green again.', meta)).toMatchObject({ reason: 'already_answered' })

    expect(replyCalls()).toHaveLength(1)
    expect(replyCalls()[0][1]).toMatchObject({ key: `chat:${THREAD}:3`, channel: 'telegram', type: 'replied', text: 'Green.' })
  })
})

describe('chat turn ← today (read)', () => {
  it('a Telegram owner statement from 10:00 lands in the 10:05 web prompt, before recency', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValue({
      from: '2026-10-02T10:05:00.000Z',
      to: '2026-10-03T10:05:00.000Z',
      entries: [{
        at: '2026-10-03T10:00:00.000Z', channel: 'telegram', type: 'said', speaker: 'owner', relayed: false,
        text: 'Hydra export before Friday',
      }],
    })

    const built = await buildAssistantTurn(USER, THREAD, { dominionId: null, userBody: 'what did I say?', userSeq: 1, surface: 'app' })
    if (!built.ok) throw new Error('build failed')

    expect(loadTodayDigest).toHaveBeenCalledWith(USER, { excludeThreadId: THREAD, excludeTypes: ['captured'] })
    const sys = built.turn.system
    const line = sys.indexOf('10:00 owner·telegram said: "Hydra export before Friday"')
    expect(line).toBeGreaterThan(sys.indexOf('BEGIN TODAY DATA'))
    expect(line).toBeLessThan(sys.indexOf('END TODAY DATA'))
    expect(sys.indexOf('## Today across channels')).toBeLessThan(sys.indexOf('## LAST 24H recency'))
  })

  it('no digest (flag off / quiet) leaves the prompt without a today section', async () => {
    vi.mocked(loadTodayDigest).mockResolvedValue(null)
    const built = await buildAssistantTurn(USER, THREAD, { dominionId: null, userBody: 'hi', userSeq: 1 })
    if (!built.ok) throw new Error('build failed')
    expect(built.turn.system).not.toContain('Today across channels')
  })
})
