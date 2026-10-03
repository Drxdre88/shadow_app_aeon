import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/memories', () => ({ searchMemoriesFts: vi.fn(), listRecentMemories: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjects: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({ getKairosAskSourceSnippets: vi.fn(), getPendingKairosAsk: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({ appendChatMessage: vi.fn(), getChatThread: vi.fn(), updateChatMessageContent: vi.fn() }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn() }))
vi.mock('@/lib/kairos/chat-retrieval', () => ({
  extractCitationIds: vi.fn(() => []),
  intersectWithRetrieved: vi.fn(() => []),
  retrieveForChatGlobal: vi.fn(),
}))
vi.mock('@/lib/kairos/chat-retrieval-mapping', () => ({ toPromptRetrieval: vi.fn(), toRetrievalMeta: vi.fn() }))
vi.mock('@/lib/kairos/chat-board-context', () => ({
  matchProjectsInMessage: vi.fn(),
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))
vi.mock('@/lib/kairos/chat-recency-context', () => ({ fetchRecentActivityContext: vi.fn(), renderRecentActivitySection: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

import { getPendingKairosAsk } from '@/lib/data/ask'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import type { AIProvider } from '@/lib/ai/provider'
import { getProviderForTask } from '@/lib/ai/route-task'
import { buildChatSystemPrompt } from '@/lib/kairos/chat-prompt'
import { retrieveForChatGlobal } from '@/lib/kairos/chat-retrieval'
import { matchProjectsInMessage } from '@/lib/kairos/chat-board-context'
import { fetchRecentActivityContext } from '@/lib/kairos/chat-recency-context'
import { buildAssistantTurn, runAssistantTurn } from '@/lib/kairos/chat-turn'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const providerAsk = vi.fn<AIProvider['ask']>()
const provider: AIProvider = { providerId: 'fake', modelId: 'fake-model', ask: providerAsk, stream: async function* stream() {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_CHAT_AGENTIC_TOOLS', '0')
  vi.mocked(getChatThread).mockResolvedValue({
    thread: {
      id: THREAD_ID, dominionId: null, dominionName: null, title: 'Kairos',
      status: 'running', createdAt: new Date('2026-10-01T08:00:00.000Z'), lastMessageAt: null, messageCount: 1,
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

afterEach(() => vi.unstubAllEnvs())

async function systemPrompt(): Promise<string> {
  const built = await buildAssistantTurn(USER_ID, THREAD_ID, { dominionId: null, userBody: 'Should I quit?', userSeq: 1 })
  if (!built.ok) throw new Error(built.reason)
  return built.turn.system
}

describe('assistant turn with KAIROS_COLD_READ', () => {
  it('flag off: the system prompt is exactly the plain chat prompt', async () => {
    vi.stubEnv('KAIROS_COLD_READ', '')
    expect(await systemPrompt()).toBe(buildChatSystemPrompt(null))
  })

  it.each(['audit', '1'])('flag %s: the system prompt asks for the stance tag', async (flag) => {
    vi.stubEnv('KAIROS_COLD_READ', flag)
    expect(await systemPrompt()).toBe(buildChatSystemPrompt(null, { coldRead: true }))
  })

  it('the paid path strips the tag before it is persisted or returned', async () => {
    providerAsk.mockResolvedValueOnce({
      text: 'Not yet — save six months first.\n<stance>lean_against — quit after building runway</stance>',
      providerId: 'fake', modelId: 'fake-model', finishReason: 'stop',
    })
    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'Should I quit?', 1, { surface: 'telegram' })
    expect(result).toMatchObject({ ok: true, assistantContent: 'Not yet — save six months first.' })
    expect(appendChatMessage).toHaveBeenCalledWith(USER_ID, THREAD_ID, expect.objectContaining({
      role: 'assistant',
      content: 'Not yet — save six months first.',
    }))
  })
})
