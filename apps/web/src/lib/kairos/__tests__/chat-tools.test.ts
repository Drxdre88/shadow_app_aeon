import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  searchMemoriesFts: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({
  findProjects: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-board-context', () => ({
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))

import { searchMemoriesFts } from '@/lib/data/memories'
import { findProjects } from '@/lib/data/projects'
import {
  fetchLiveBoardContext,
  renderLiveBoardSection,
} from '@/lib/kairos/chat-board-context'
import type { AIProvider, AIResponse } from '@/lib/ai/provider'
import {
  MAX_TOOL_ROUNDS,
  boardStateInputSchema,
  buildChatTools,
  listBoardsInputSchema,
  runChatToolLoop,
  searchBrainInputSchema,
} from '../chat-tools'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const providerAsk = vi.fn<AIProvider['ask']>()
const provider: AIProvider = {
  providerId: 'fake',
  modelId: 'fake-model',
  ask: providerAsk,
  stream: async function* stream() {},
}

function textResponse(text: string): AIResponse {
  return { text, providerId: 'fake', modelId: 'fake-model' }
}

function toolCallResponse(toolName: string, input: unknown): AIResponse {
  return {
    text: '',
    providerId: 'fake',
    modelId: 'fake-model',
    toolCalls: [{ toolCallId: 'call-1', toolName, input }],
  }
}

const baseMessages = [
  { role: 'system' as const, content: 'You are Kairos.' },
  { role: 'user' as const, content: 'What is on the board?' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tool input schemas', () => {
  it('search_brain rejects a missing or too-short query', () => {
    expect(searchBrainInputSchema.safeParse({}).success).toBe(false)
    expect(searchBrainInputSchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(searchBrainInputSchema.safeParse({ query: 42 }).success).toBe(false)
    expect(searchBrainInputSchema.safeParse({ query: 'kairos asks' }).success).toBe(true)
  })

  it('board_state rejects a non-uuid projectId', () => {
    expect(boardStateInputSchema.safeParse({}).success).toBe(false)
    expect(boardStateInputSchema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false)
    expect(boardStateInputSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(true)
  })

  it('list_boards accepts an empty object', () => {
    expect(listBoardsInputSchema.safeParse({}).success).toBe(true)
  })
})

describe('userId-bound tool executors', () => {
  it('search_brain searches the brain with the bound userId', async () => {
    vi.mocked(searchMemoriesFts).mockResolvedValue({ hits: [], total: 0 } as never)

    const tools = buildChatTools(USER_ID)
    await tools.search_brain!.execute({ query: 'mobile release' })

    expect(searchMemoriesFts).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ query: 'mobile release' }),
    )
  })

  it('list_boards lists projects for the bound userId', async () => {
    vi.mocked(findProjects).mockResolvedValue([
      { id: PROJECT_ID, name: 'AS Sprint' } as never,
    ])

    const tools = buildChatTools(USER_ID)
    const result = await tools.list_boards!.execute({})

    expect(findProjects).toHaveBeenCalledWith(USER_ID, expect.any(Number))
    expect(JSON.parse(result)).toEqual([{ id: PROJECT_ID, name: 'AS Sprint' }])
  })

  it('board_state fetches live context for the bound userId', async () => {
    vi.mocked(fetchLiveBoardContext).mockResolvedValue({
      projectId: PROJECT_ID,
      projectName: 'AS Sprint',
      total: 3,
      statusCounts: { todo: 3 },
      cards: [],
    })
    vi.mocked(renderLiveBoardSection).mockReturnValue('### AS Sprint')

    const tools = buildChatTools(USER_ID)
    const result = await tools.board_state!.execute({ projectId: PROJECT_ID })

    expect(fetchLiveBoardContext).toHaveBeenCalledWith(USER_ID, PROJECT_ID)
    expect(result).toBe('### AS Sprint')
  })

  it('board_state reports an inaccessible project instead of throwing', async () => {
    vi.mocked(fetchLiveBoardContext).mockResolvedValue(null)

    const tools = buildChatTools(USER_ID)
    const result = await tools.board_state!.execute({ projectId: PROJECT_ID })

    expect(JSON.parse(result)).toEqual({ error: 'project not found or not accessible' })
  })
})

describe('runChatToolLoop', () => {
  it('returns the first response when the model never requests tools', async () => {
    providerAsk.mockResolvedValueOnce(textResponse('Plain answer.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Plain answer.')
    expect(providerAsk).toHaveBeenCalledTimes(1)
    expect(providerAsk.mock.calls[0]![0]!.tools).toBeDefined()
  })

  it('executes a requested tool and feeds the result into the next round', async () => {
    vi.mocked(findProjects).mockResolvedValue([
      { id: PROJECT_ID, name: 'AS Sprint' } as never,
    ])
    providerAsk
      .mockResolvedValueOnce(toolCallResponse('list_boards', {}))
      .mockResolvedValueOnce(textResponse('You have one board: AS Sprint.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('You have one board: AS Sprint.')
    expect(findProjects).toHaveBeenCalledWith(USER_ID, expect.any(Number))
    const secondCallMessages = providerAsk.mock.calls[1]![0]!.messages!
    const transcript = secondCallMessages.map((m) => m.content).join('\n')
    expect(transcript).toContain('[tool_call list_boards]')
    expect(transcript).toContain('[tool_result list_boards]')
    expect(transcript).toContain('AS Sprint')
  })

  it('caps at MAX_TOOL_ROUNDS then forces a tool-less final answer', async () => {
    vi.mocked(findProjects).mockResolvedValue([])
    providerAsk.mockImplementation(async (req) => {
      if (req.tools) return toolCallResponse('list_boards', {})
      return textResponse('Forced final answer.')
    })

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Forced final answer.')
    expect(providerAsk).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1)
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      expect(providerAsk.mock.calls[i]![0]!.tools).toBeDefined()
    }
    expect(providerAsk.mock.calls[MAX_TOOL_ROUNDS]![0]).not.toHaveProperty('tools')
  })

  it('feeds schema rejections and unknown tools back as error results', async () => {
    providerAsk
      .mockResolvedValueOnce(toolCallResponse('board_state', { projectId: 'nope' }))
      .mockResolvedValueOnce(toolCallResponse('delete_everything', {}))
      .mockResolvedValueOnce(textResponse('Understood.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Understood.')
    expect(fetchLiveBoardContext).not.toHaveBeenCalled()
    const secondTranscript = providerAsk.mock.calls[1]![0]!.messages!
      .map((m) => m.content).join('\n')
    expect(secondTranscript).toContain('invalid input')
    const thirdTranscript = providerAsk.mock.calls[2]![0]!.messages!
      .map((m) => m.content).join('\n')
    expect(thirdTranscript).toContain('unknown tool: delete_everything')
  })

  it('feeds executor failures back instead of failing the turn', async () => {
    vi.mocked(searchMemoriesFts).mockRejectedValue(new Error('db unavailable'))
    providerAsk
      .mockResolvedValueOnce(toolCallResponse('search_brain', { query: 'mobile' }))
      .mockResolvedValueOnce(textResponse('Answering from memory instead.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Answering from memory instead.')
    const transcript = providerAsk.mock.calls[1]![0]!.messages!
      .map((m) => m.content).join('\n')
    expect(transcript).toContain('db unavailable')
  })
})
