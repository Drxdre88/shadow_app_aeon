import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

// Leaf data mocks for the agentic chat tools (chat-tools.ts closures).
vi.mock('@/lib/data/memories', () => ({
  searchMemoriesFts: vi.fn(),
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

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

import { getKairosAskSourceSnippets, getPendingKairosAsk } from '@/lib/data/ask'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import { findProjects } from '@/lib/data/projects'
import type { AIProvider } from '@/lib/ai/provider'
import { getProviderForTask } from '@/lib/ai/route-task'
import { answerKairosAsk } from '@/lib/kairos/ask'
import { retrieveForChatGlobal } from '@/lib/kairos/chat-retrieval'
import {
  matchProjectsInMessage,
  fetchLiveBoardContext,
  renderLiveBoardSection,
} from '@/lib/kairos/chat-board-context'
import {
  askResolutionSchema,
  parseAskResolutionResponse,
  runAssistantTurn,
} from '../chat-turn'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const pendingAsk = {
  id: ASK_ID,
  title: 'Should the dormant mobile release be revived this month?',
  summary: null,
  dominionId: null,
  createdAt: new Date('2026-07-19T08:00:00.000Z'),
  kairosAsk: {
    status: 'pending' as const,
    aetherMemoryId: '',
    sourceThoughtId: null,
    sourceMemoryIds: [SOURCE_ID],
    dominionId: null,
    askedAt: '2026-07-19T08:00:00.000Z',
  },
  askMine: {
    date: '2026-07-19',
    kind: 'revival' as const,
    sourceMemoryIds: [SOURCE_ID],
    leverage: 0.91,
    rationale: 'The release card has not moved for 31 days.',
  },
}

const providerAsk = vi.fn<AIProvider['ask']>()
const provider: AIProvider = {
  providerId: 'fake',
  modelId: 'fake-model',
  ask: providerAsk,
  stream: async function* stream() {},
}

function aiResponse(text: string) {
  return {
    text,
    providerId: 'fake',
    modelId: 'fake-model',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getChatThread).mockResolvedValue({
    thread: {
      id: THREAD_ID,
      dominionId: null,
      dominionName: null,
      title: 'Telegram · Kairos',
      status: 'running',
      createdAt: new Date('2026-07-19T08:00:00.000Z'),
      lastMessageAt: null,
      messageCount: 1,
    },
    messages: [],
  })
  vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'message-2', seq: 2 })
  vi.mocked(retrieveForChatGlobal).mockResolvedValue({
    cortex: null,
    archetypes: [],
    substrate: [],
  })
  vi.mocked(getKairosAskSourceSnippets).mockResolvedValue([{
    id: SOURCE_ID,
    title: 'Ship mobile release',
    body: 'Aeon · todo · high · updated 31 days ago',
  }])
  vi.mocked(answerKairosAsk).mockResolvedValue({ reflectionId: 'reflection-1' })
  vi.mocked(matchProjectsInMessage).mockResolvedValue([])
  vi.mocked(fetchLiveBoardContext).mockResolvedValue(null)
  vi.mocked(renderLiveBoardSection).mockReturnValue('')
  vi.mocked(getProviderForTask).mockResolvedValue({
    decision: {
      providerId: 'fake',
      modelId: 'fake-model',
      tier: 'standard',
      source: 'default',
    },
    provider,
  })
})

describe('ask resolution schema', () => {
  it('round-trips a validated resolution envelope', () => {
    const resolution = {
      answersPending: true,
      distilledAnswer: 'I will revive mobile only after the web beta exits.',
    }

    const validated = askResolutionSchema.parse(resolution)
    expect(parseAskResolutionResponse(JSON.stringify(validated))).toEqual(validated)
  })
})

describe('ask-aware assistant turns', () => {
  it('resolves an answered ask exactly once across a retry', async () => {
    vi.mocked(getPendingKairosAsk)
      .mockResolvedValueOnce(pendingAsk)
      .mockResolvedValueOnce(null)
    providerAsk
      .mockResolvedValueOnce(aiResponse('That makes the dependency clear.'))
      .mockResolvedValueOnce(aiResponse(JSON.stringify({
        answersPending: true,
        distilledAnswer: 'I will revive mobile only after the web beta exits.',
      })))
      .mockResolvedValueOnce(aiResponse('The answer is already recorded.'))

    await runAssistantTurn(USER_ID, THREAD_ID, null, 'Only after web beta exits.', 1, {
      surface: 'telegram',
    })
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'Only after web beta exits.', 1, {
      surface: 'telegram',
    })

    expect(answerKairosAsk).toHaveBeenCalledTimes(1)
    expect(answerKairosAsk).toHaveBeenCalledWith(
      USER_ID,
      ASK_ID,
      'I will revive mobile only after the web beta exits.',
    )
    expect(providerAsk).toHaveBeenCalledTimes(3)
    expect(providerAsk.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 2000 })
    expect(providerAsk.mock.calls[0][0]).not.toHaveProperty('temperature')
    expect(providerAsk.mock.calls[1][0]).toMatchObject({ maxOutputTokens: 240 })
    expect(providerAsk.mock.calls[1][0]).not.toHaveProperty('temperature')
  })

  it('does not classify or resolve when there is no pending ask', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    providerAsk.mockResolvedValueOnce(aiResponse('Nothing is waiting on you.'))

    await runAssistantTurn(USER_ID, THREAD_ID, null, 'What is open?', 1)

    expect(getKairosAskSourceSnippets).not.toHaveBeenCalled()
    expect(answerKairosAsk).not.toHaveBeenCalled()
    expect(providerAsk).toHaveBeenCalledTimes(1)
  })
})

describe('agentic tools flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flag unset: provider is asked exactly as before, with no tools key', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    providerAsk.mockResolvedValueOnce(aiResponse('Plain reply.'))

    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'hello', 1)

    expect(result.ok).toBe(true)
    expect(providerAsk).toHaveBeenCalledTimes(1)
    const request = providerAsk.mock.calls[0]![0]!
    expect(Object.keys(request).sort()).toEqual(['maxOutputTokens', 'messages'])
    expect(request.maxOutputTokens).toBe(2000)
  })

  it('flag on: runs the tool loop, userId-scoped, then persists the final answer', async () => {
    vi.stubEnv('KAIROS_CHAT_AGENTIC_TOOLS', '1')
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    vi.mocked(findProjects).mockResolvedValue([
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'AS Sprint' } as never,
    ])
    providerAsk
      .mockResolvedValueOnce({
        ...aiResponse(''),
        toolCalls: [{ toolCallId: 'call-1', toolName: 'list_boards', input: {} }],
      })
      .mockResolvedValueOnce(aiResponse('One board: AS Sprint.'))

    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'what boards do I have?', 1)

    expect(result.ok).toBe(true)
    expect(providerAsk).toHaveBeenCalledTimes(2)
    const firstRequest = providerAsk.mock.calls[0]![0]!
    expect(Object.keys(firstRequest.tools ?? {}).sort()).toEqual([
      'board_state', 'list_boards', 'search_brain',
    ])
    expect(findProjects).toHaveBeenCalledWith(USER_ID, expect.any(Number))
    expect(appendChatMessage).toHaveBeenCalledWith(
      USER_ID,
      THREAD_ID,
      expect.objectContaining({ role: 'assistant', content: 'One board: AS Sprint.' }),
    )
  })
})

describe('live board grounding', () => {
  const PROJECT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const boardSection = '## LIVE BOARD STATE (authoritative — fetched now, fresher than any memory)\n\n### AS Sprint\n26 tasks total (10 todo, 8 in-progress, 8 done)'

  it('lands the live board section in the prompt when a project name is matched', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    vi.mocked(matchProjectsInMessage).mockResolvedValue([{ id: PROJECT_ID, name: 'AS Sprint' }])
    vi.mocked(fetchLiveBoardContext).mockResolvedValue({
      projectId: PROJECT_ID,
      projectName: 'AS Sprint',
      total: 26,
      statusCounts: { todo: 10, 'in-progress': 8, done: 8 },
      cards: [],
    })
    vi.mocked(renderLiveBoardSection).mockReturnValue(boardSection)
    providerAsk.mockResolvedValueOnce(aiResponse('AS Sprint has 26 tasks in flight.'))

    await runAssistantTurn(USER_ID, THREAD_ID, null, 'how is AS Sprint looking?', 1)

    expect(fetchLiveBoardContext).toHaveBeenCalledWith(USER_ID, PROJECT_ID)
    const systemMessage = providerAsk.mock.calls[0]![0]!.messages![0]!
    expect(systemMessage.role).toBe('system')
    expect(systemMessage.content).toContain('LIVE BOARD STATE')
    expect(systemMessage.content).toContain('AS Sprint')
  })

  it('skips the section without failing the turn when the board fetch throws', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    vi.mocked(matchProjectsInMessage).mockResolvedValue([{ id: PROJECT_ID, name: 'AS Sprint' }])
    vi.mocked(fetchLiveBoardContext).mockRejectedValue(new Error('db unavailable'))
    providerAsk.mockResolvedValueOnce(aiResponse('Here is what I remember about AS Sprint.'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'how is AS Sprint looking?', 1)

    expect(result.ok).toBe(true)
    const systemMessage = providerAsk.mock.calls[0]![0]!.messages![0]!
    expect(systemMessage.content).not.toContain('LIVE BOARD STATE')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
