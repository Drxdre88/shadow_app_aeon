import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/memories', () => ({
  searchMemoriesFts: vi.fn(),
  listRecentMemories: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({
  findProjects: vi.fn(),
}))

vi.mock('@/lib/data/ask', () => ({
  getKairosAskSourceSnippets: vi.fn(),
  getPendingKairosAsk: vi.fn(),
}))

vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  getChatThread: vi.fn(),
  updateChatMessageContent: vi.fn(),
}))

vi.mock('@/lib/kairos/ask', () => ({
  answerKairosAsk: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-retrieval', () => ({
  extractCitationIds: vi.fn(() => []),
  intersectWithRetrieved: vi.fn(() => []),
  retrieveForChatGlobal: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-retrieval-mapping', () => ({
  toPromptRetrieval: vi.fn(),
  toRetrievalMeta: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-board-context', () => ({
  matchProjectsInMessage: vi.fn(),
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-recency-context', () => ({
  fetchRecentActivityContext: vi.fn(),
  renderRecentActivitySection: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

import { getPendingKairosAsk } from '@/lib/data/ask'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import type { AIProvider } from '@/lib/ai/provider'
import { getProviderForTask } from '@/lib/ai/route-task'
import { retrieveForChatGlobal } from '@/lib/kairos/chat-retrieval'
import { matchProjectsInMessage } from '@/lib/kairos/chat-board-context'
import { fetchRecentActivityContext } from '@/lib/kairos/chat-recency-context'
import {
  CHAT_CUT_SHORT_FALLBACK,
  CHAT_CUT_SHORT_MARKER,
  guardChatReply,
  runAssistantTurn,
  trimToCompleteBoundary,
} from '../chat-turn'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const COMPLETE = 'The hydra board has three open cards and nothing blocked right now.'
const SECOND = 'The release card moved to review this morning, so it should land soon.'
const RUNAWAY = `${COMPLETE} ${SECOND} Then there is the matter of the wp-config file which you shou`

describe('guardChatReply', () => {
  it('passes a cleanly finished reply through untouched', () => {
    expect(guardChatReply(RUNAWAY, 'stop')).toBe(RUNAWAY)
  })

  it('passes through when the provider reports no finishReason', () => {
    expect(guardChatReply(RUNAWAY, undefined)).toBe(RUNAWAY)
  })

  it('trims a length-capped reply to the last complete sentence and marks it cut short', () => {
    const guarded = guardChatReply(RUNAWAY, 'length')
    expect(guarded).toBe(`${COMPLETE} ${SECOND}\n\n${CHAT_CUT_SHORT_MARKER}`)
    expect(guarded).not.toContain('wp-config')
  })

  it('treats other non-stop finishes (content-filter) the same way', () => {
    expect(guardChatReply(RUNAWAY, 'content-filter')).toContain(CHAT_CUT_SHORT_MARKER)
  })

  it('falls back to an honest short reply when nothing coherent survives', () => {
    expect(guardChatReply('Well, the thing about that is', 'length')).toBe(CHAT_CUT_SHORT_FALLBACK)
  })
})

describe('trimToCompleteBoundary', () => {
  it('prefers a later paragraph break over an earlier sentence end', () => {
    const text = `${COMPLETE}\n\nA list follows:\n- one\n- two\n\nand then the tail goes on and on`
    expect(trimToCompleteBoundary(text)).toBe(`${COMPLETE}\n\nA list follows:\n- one\n- two`)
  })

  it('closes a code fence left open by the cut', () => {
    const text = `${COMPLETE}\n\n\`\`\`ts\nconst a = 1.\n\nconst b = 2`
    const trimmed = trimToCompleteBoundary(text)!
    expect(trimmed.match(/```/g)).toHaveLength(2)
    expect(trimmed.endsWith('```')).toBe(true)
  })

  it('respects maxChars', () => {
    const head = `${COMPLETE} ${SECOND}`
    const trimmed = trimToCompleteBoundary(`${head} ${COMPLETE}`, head.length + 5)
    expect(trimmed).toBe(head)
  })
})

describe('runAssistantTurn with a runaway reply', () => {
  const providerAsk = vi.fn<AIProvider['ask']>()
  const provider: AIProvider = {
    providerId: 'fake',
    modelId: 'fake-model',
    ask: providerAsk,
    stream: async function* stream() {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getChatThread).mockResolvedValue({
      thread: {
        id: THREAD_ID, dominionId: null, dominionName: null, title: 'Telegram · Kairos',
        status: 'running', createdAt: new Date('2026-07-19T08:00:00.000Z'), lastMessageAt: null, messageCount: 1,
      },
      messages: [],
    })
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'message-2', seq: 2 })
    vi.mocked(retrieveForChatGlobal).mockResolvedValue({ cortex: null, archetypes: [], substrate: [] })
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    vi.mocked(matchProjectsInMessage).mockResolvedValue([])
    vi.mocked(fetchRecentActivityContext).mockResolvedValue(null)
    vi.mocked(getProviderForTask).mockResolvedValue({
      decision: { providerId: 'fake', modelId: 'fake-model', tier: 'standard', source: 'default' },
      provider,
    })
  })

  it('persists and returns the trimmed reply, never the runaway tail', async () => {
    providerAsk.mockResolvedValueOnce({
      text: RUNAWAY, providerId: 'fake', modelId: 'fake-model', finishReason: 'length',
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'status of hydra?', 1, { surface: 'telegram' })

    const expected = `${COMPLETE} ${SECOND}\n\n${CHAT_CUT_SHORT_MARKER}`
    expect(result).toMatchObject({ ok: true, assistantContent: expected })
    expect(appendChatMessage).toHaveBeenCalledWith(USER_ID, THREAD_ID, expect.objectContaining({
      role: 'assistant',
      content: expected,
    }))
  })
})
