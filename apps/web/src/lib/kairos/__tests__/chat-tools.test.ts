import { beforeEach, describe, expect, it, vi } from 'vitest'

// Several tools now route through real data-layer modules (sessions.ts,
// recipes.ts, retrieve.ts) that import '@/lib/db' at module scope — none of
// those modules are exercised for real here (their functions are mocked
// below), but the import chain still needs a stand-in so db/index.ts's
// DATABASE_URL guard never fires in tests.
vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/memories', () => ({
  listRecentMemories: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({
  findProjects: vi.fn(),
}))

vi.mock('@/lib/data/sessions', () => ({
  listAgentSessions: vi.fn(),
}))

vi.mock('@/lib/data/recipes', () => ({
  listTraceHistory: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-board-context', () => ({
  fetchLiveBoardContext: vi.fn(),
  renderLiveBoardSection: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-recency-context', () => ({
  fetchRecentActivityContext: vi.fn(),
}))

vi.mock('@/lib/kairos/retrieve', () => ({
  searchSubstrateForChat: vi.fn(),
}))

import { listRecentMemories } from '@/lib/data/memories'
import { findProjects } from '@/lib/data/projects'
import { listAgentSessions } from '@/lib/data/sessions'
import { listTraceHistory } from '@/lib/data/recipes'
import {
  fetchLiveBoardContext,
  renderLiveBoardSection,
} from '@/lib/kairos/chat-board-context'
import { fetchRecentActivityContext } from '@/lib/kairos/chat-recency-context'
import { searchSubstrateForChat } from '@/lib/kairos/retrieve'
import type { AIProvider, AIResponse } from '@/lib/ai/provider'
import {
  MAX_TOOL_ROUNDS,
  boardStateInputSchema,
  buildChatTools,
  listBoardsInputSchema,
  recentActivityInputSchema,
  runChatToolLoop,
  searchBrainInputSchema,
  synthesisStatusInputSchema,
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

  it('recent_activity accepts an empty object and clamps hours to 1-168', () => {
    expect(recentActivityInputSchema.safeParse({}).success).toBe(true)
    expect(recentActivityInputSchema.safeParse({ hours: 12 }).success).toBe(true)
    expect(recentActivityInputSchema.safeParse({ hours: 0 }).success).toBe(false)
    expect(recentActivityInputSchema.safeParse({ hours: 169 }).success).toBe(false)
    expect(recentActivityInputSchema.safeParse({ hours: 1.5 }).success).toBe(false)
  })

  it('synthesis_status accepts an empty object', () => {
    expect(synthesisStatusInputSchema.safeParse({}).success).toBe(true)
  })
})

describe('userId-bound tool executors', () => {
  it('search_brain routes through the recency/confidence-aware substrate search, not raw FTS', async () => {
    vi.mocked(searchSubstrateForChat).mockResolvedValue([
      { id: 'mem-1', title: 'Mobile release plan', body: 'Revive after web beta.', streamClass: 'reflection', createdAt: new Date('2026-07-20T00:00:00Z') },
    ])

    const tools = buildChatTools(USER_ID)
    const result = await tools.search_brain!.execute({ query: 'mobile release' })

    expect(searchSubstrateForChat).toHaveBeenCalledWith(USER_ID, 'mobile release', 8)
    expect(JSON.parse(result)).toEqual([{
      id: 'mem-1',
      title: 'Mobile release plan',
      streamClass: 'reflection',
      snippet: 'Revive after web beta.',
      createdAt: '2026-07-20T00:00:00.000Z',
    }])
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

  it('recent_activity reuses chat-recency-context and adds a per-repo agent session breakdown', async () => {
    vi.mocked(fetchRecentActivityContext).mockResolvedValue({
      windowHours: 24,
      since: new Date('2026-07-23T00:00:00Z'),
      sessionSummaries: { label: 'Coding sessions', count: 2, items: [] },
      reflections: { label: 'Reflections', count: 1, items: [] },
      introspectionProposals: { label: 'Introspection proposals', count: 0, items: [] },
      asks: { label: 'Asks dispatched', count: 0, items: [] },
      boardTasksCompleted: 3,
      boardTasksCreated: 1,
    })
    vi.mocked(listAgentSessions).mockResolvedValue([
      { repo: 'aeon' } as never,
      { repo: 'aeon' } as never,
      { repo: 'kairos' } as never,
      { repo: null } as never,
    ])

    const tools = buildChatTools(USER_ID)
    const result = await tools.recent_activity!.execute({})

    expect(fetchRecentActivityContext).toHaveBeenCalledWith(USER_ID, { hours: 24 })
    expect(listAgentSessions).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ liveOnly: false, since: expect.any(Date) }),
    )
    const parsed = JSON.parse(result)
    expect(parsed.windowHours).toBe(24)
    expect(parsed.sessionSummaries.count).toBe(2)
    expect(parsed.boardTasksCompleted).toBe(3)
    expect(parsed.agentSessionsByRepo).toEqual({ aeon: 2, kairos: 1, unknown: 1 })
  })

  it('recent_activity degrades to empty categories when the recency fetch returns null', async () => {
    vi.mocked(fetchRecentActivityContext).mockResolvedValue(null)
    vi.mocked(listAgentSessions).mockResolvedValue([])

    const tools = buildChatTools(USER_ID)
    const result = await tools.recent_activity!.execute({ hours: 6 })

    expect(fetchRecentActivityContext).toHaveBeenCalledWith(USER_ID, { hours: 6 })
    const parsed = JSON.parse(result)
    expect(parsed.sessionSummaries).toEqual({ count: 0, items: [] })
    expect(parsed.boardTasksCompleted).toBe(0)
    expect(parsed.agentSessionsByRepo).toEqual({})
  })

  it('synthesis_status returns the latest rollup plus today cortex/aether existence', async () => {
    vi.mocked(listTraceHistory).mockResolvedValue([
      { id: 't1', title: 'SYNTHESIS_HEALTH', summary: null, dominionId: null, sourceMetadata: { byStage: { cortex: { '2026-07-24': 'ok' } } }, createdAt: new Date('2026-07-24T08:00:00Z') },
    ])
    vi.mocked(listRecentMemories)
      .mockResolvedValueOnce([{ id: 'c1', title: 'AEON cortex', createdAt: new Date(), streamClass: 'cortex' }])
      .mockResolvedValueOnce([])

    const tools = buildChatTools(USER_ID)
    const result = await tools.synthesis_status!.execute({})

    expect(listTraceHistory).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ recipe: 'SYNTHESIS_HEALTH', limit: 1 }))
    const parsed = JSON.parse(result)
    expect(parsed.rollup.sourceMetadata).toEqual({ byStage: { cortex: { '2026-07-24': 'ok' } } })
    expect(parsed.cortexDocToday).toBe(true)
    expect(parsed.aetherDocToday).toBe(false)
  })

  it('synthesis_status reports a null rollup when no SYNTHESIS_HEALTH trace exists yet', async () => {
    vi.mocked(listTraceHistory).mockResolvedValue([])
    vi.mocked(listRecentMemories).mockResolvedValue([])

    const tools = buildChatTools(USER_ID)
    const result = await tools.synthesis_status!.execute({})

    expect(JSON.parse(result)).toEqual({ rollup: null, cortexDocToday: false, aetherDocToday: false })
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
    vi.mocked(searchSubstrateForChat).mockRejectedValue(new Error('db unavailable'))
    providerAsk
      .mockResolvedValueOnce(toolCallResponse('search_brain', { query: 'mobile' }))
      .mockResolvedValueOnce(textResponse('Answering from memory instead.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Answering from memory instead.')
    const transcript = providerAsk.mock.calls[1]![0]!.messages!
      .map((m) => m.content).join('\n')
    expect(transcript).toContain('db unavailable')
  })

  it('stops firing new rounds once the wall-clock budget is exceeded, then forces a final answer', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)      // startedAt
      .mockReturnValueOnce(0)      // round 0 elapsed check (0ms — proceeds)
      .mockReturnValueOnce(35_000) // round 1 elapsed check (35s — over budget)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(findProjects).mockResolvedValue([])
    providerAsk
      .mockResolvedValueOnce(toolCallResponse('list_boards', {}))
      .mockResolvedValueOnce(textResponse('Answering with what I have.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Answering with what I have.')
    // One tool round + one forced final call — round 1 never fired.
    expect(providerAsk).toHaveBeenCalledTimes(2)
    expect(providerAsk.mock.calls[1]![0]).not.toHaveProperty('tools')
    expect(warnSpy).toHaveBeenCalledWith(
      '[kairos-chat] tool loop budget exceeded, forcing final answer',
      expect.objectContaining({ round: 1 }),
    )

    nowSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('proceeds with a new round when elapsed exactly equals the budget boundary (30_000ms is not > 30_000ms)', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)      // startedAt
      .mockReturnValueOnce(30_000) // round 0 elapsed check — exactly at the boundary
    vi.mocked(findProjects).mockResolvedValue([])
    providerAsk.mockResolvedValueOnce(textResponse('Still on time.'))

    const result = await runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))

    expect(result.text).toBe('Still on time.')
    expect(providerAsk).toHaveBeenCalledTimes(1)
    expect(providerAsk.mock.calls[0]![0]!.tools).toBeDefined()

    nowSpy.mockRestore()
  })

  it('races an in-flight provider.ask against the hard deadline and forces a final answer when it loses', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(findProjects).mockResolvedValue([])

    const hanging = new Promise<AIResponse>(() => {}) // never resolves
    providerAsk
      .mockReturnValueOnce(hanging)
      .mockResolvedValueOnce(textResponse('Answering with what I have.'))

    const resultPromise = runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))
    await vi.advanceTimersByTimeAsync(45_000)
    const result = await resultPromise

    expect(result.text).toBe('Answering with what I have.')
    expect(providerAsk).toHaveBeenCalledTimes(2)
    expect(providerAsk.mock.calls[1]![0]).not.toHaveProperty('tools')
    expect(warnSpy).toHaveBeenCalledWith(
      '[kairos-chat] tool loop hard deadline exceeded mid-round, forcing final answer',
      expect.objectContaining({ round: 0 }),
    )

    vi.useRealTimers()
    warnSpy.mockRestore()
  })

  it('returns a never-throw fallback when even the forced final answer loses the hard deadline race', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Every round's provider.ask hangs, including the trailing tool-less call.
    providerAsk.mockReturnValue(new Promise<AIResponse>(() => {}))

    const resultPromise = runChatToolLoop(provider, baseMessages, buildChatTools(USER_ID))
    // Two separate deadline windows fire in sequence: round 0's mid-round
    // race, then the trailing call's own race — each needs its own advance.
    await vi.advanceTimersByTimeAsync(45_000)
    await vi.advanceTimersByTimeAsync(45_000)
    const result = await resultPromise

    expect(result.providerId).toBe('kairos-chat-tool-loop')
    expect(result.text.length).toBeGreaterThan(0)
    expect(warnSpy).toHaveBeenCalledWith(
      '[kairos-chat] tool loop hard deadline exceeded on final answer, returning fallback',
      expect.any(Object),
    )

    vi.useRealTimers()
    warnSpy.mockRestore()
  })
})
