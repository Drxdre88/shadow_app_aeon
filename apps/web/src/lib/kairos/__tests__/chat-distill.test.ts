import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-chat', () => ({
  listChatThreadsWithMessagesOn: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))

import { listChatThreadsWithMessagesOn } from '@/lib/data/kairos-chat'
import { captureMemory } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'
import { parseChatDistillResponse, runChatDistillForUser } from '../chat-distill'

const USER_ID = 'user-1'
const DATE = '2026-07-16'

function message(seq: number, role: 'user' | 'assistant', content: string) {
  return {
    id: `message-${seq}`,
    threadId: 'thread-1',
    seq,
    role,
    content,
    citations: [],
    retrieval: null,
    model: null,
    createdAt: new Date(`${DATE}T12:00:00.000Z`),
  }
}

function thread(messages = [message(1, 'user', 'I prefer weekly written updates.')]) {
  return {
    id: 'thread-1',
    dominionId: null,
    title: 'Telegram · Kairos',
    messages,
  }
}

function modelResponse(count: number) {
  return {
    text: JSON.stringify({
      reflections: Array.from({ length: count }, (_, index) => ({
        title: `Preference ${index + 1}`,
        bodyMd: `I prefer durable choice ${index + 1}.`,
      })),
    }),
    providerId: 'byok',
    modelId: 'standard-model',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(listChatThreadsWithMessagesOn as ReturnType<typeof vi.fn>).mockResolvedValue([thread()])
  ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({
    provider: { ask: vi.fn().mockResolvedValue(modelResponse(1)) },
  })
  ;(captureMemory as ReturnType<typeof vi.fn>).mockImplementation(
    async (_userId: string, input: { sourceMetadata: { externalId: string } }) => ({
      memory: { id: `memory-${input.sourceMetadata.externalId}` },
      created: true,
    }),
  )
})

describe('chat distillation', () => {
  it('parses fenced JSON and accepts a quiet-day empty result', () => {
    expect(parseChatDistillResponse('```json\n{"reflections":[]}\n```')).toEqual([])
    expect(parseChatDistillResponse(
      '```json\n{"reflections":[{"title":"Decision","bodyMd":"I decided to ship Friday."}]}\n```',
    )).toEqual([{ title: 'Decision', bodyMd: 'I decided to ship Friday.' }])
  })

  it('caps model output at five reflections', async () => {
    const ask = vi.fn().mockResolvedValue(modelResponse(7))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const result = await runChatDistillForUser(USER_ID, { date: DATE })

    expect(captureMemory).toHaveBeenCalledTimes(5)
    expect(getProviderForTask).toHaveBeenCalledWith(USER_ID, {
      taskType: 'reflect',
      dominionId: null,
    })
    expect(result.reflectionsCreated).toBe(5)
    expect(result.threads[0]).toMatchObject({ status: 'created', reflectionsCreated: 5 })
  })

  it('uses stable external IDs and captureMemory dedup on re-runs', async () => {
    const ask = vi.fn().mockResolvedValue(modelResponse(2))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'memory-1' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'memory-2' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'memory-1' }, created: false })
      .mockResolvedValueOnce({ memory: { id: 'memory-2' }, created: false })

    const first = await runChatDistillForUser(USER_ID, { date: DATE })
    const second = await runChatDistillForUser(USER_ID, { date: DATE })
    const inputs = (captureMemory as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])

    expect(inputs.map((input) => input.sourceMetadata.externalId)).toEqual([
      `chat-distill:${DATE}:thread-1:1`,
      `chat-distill:${DATE}:thread-1:2`,
      `chat-distill:${DATE}:thread-1:1`,
      `chat-distill:${DATE}:thread-1:2`,
    ])
    expect(inputs[0]).toMatchObject({
      type: 'reflection',
      streamClass: 'reflection',
      source: 'cron',
      sourceMetadata: {
        chatDistill: { threadId: 'thread-1', date: DATE, messageSeqs: [1] },
      },
    })
    expect(first.threads[0].status).toBe('created')
    expect(second.threads[0].status).toBe('existing')
  })

  it('returns the exact model input in dry-run mode without calling or writing', async () => {
    const result = await runChatDistillForUser(USER_ID, { date: DATE, dryRun: true })

    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
    expect(result.threads[0].status).toBe('dry_run')
    expect(result.threads[0].modelInput?.system).toContain('durable operator memories')
    expect(result.threads[0].modelInput?.prompt).toContain('I prefer weekly written updates.')
  })

  it('skips threads with no messages', async () => {
    ;(listChatThreadsWithMessagesOn as ReturnType<typeof vi.fn>).mockResolvedValue([thread([])])

    const result = await runChatDistillForUser(USER_ID, { date: DATE })

    expect(result.threads[0]).toMatchObject({ status: 'skipped', reason: 'no messages' })
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('never derives operator memories from assistant-only content', async () => {
    ;(listChatThreadsWithMessagesOn as ReturnType<typeof vi.fn>).mockResolvedValue([
      thread([message(1, 'assistant', 'You should move to Lisbon and prioritise writing.')]),
    ])

    const result = await runChatDistillForUser(USER_ID, { date: DATE })

    expect(result.reflectionsCreated).toBe(0)
    expect(result.threads[0]).toMatchObject({ status: 'skipped', reason: 'no operator messages' })
    expect(getProviderForTask).not.toHaveBeenCalled()
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('skips gracefully when no BYOK credential can be resolved', async () => {
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockRejectedValue(new AiCredentialMissingError('anthropic'))

    const result = await runChatDistillForUser(USER_ID, { date: DATE })

    expect(result.threads[0]).toMatchObject({ status: 'skipped', reason: 'no BYOK credential' })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('contains a model failure to its thread and continues the run', async () => {
    ;(listChatThreadsWithMessagesOn as ReturnType<typeof vi.fn>).mockResolvedValue([
      thread(),
      { ...thread(), id: 'thread-2', title: 'Second thread' },
    ])
    const ask = vi.fn()
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce(modelResponse(1))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const result = await runChatDistillForUser(USER_ID, { date: DATE })

    expect(result.threads[0]).toMatchObject({ status: 'error', reason: 'provider timeout' })
    expect(result.threads[1]).toMatchObject({ status: 'created', reflectionsCreated: 1 })
    expect(captureMemory).toHaveBeenCalledTimes(1)
  })
})
