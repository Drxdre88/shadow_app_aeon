import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  hasJobWithKeyLike: vi.fn(async () => false),
  isJobDone: vi.fn(async () => false),
}))
vi.mock('@/lib/data/ask', () => ({ listKairosAsksAnsweredBetween: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({ listChatThreadsWithMessagesOn: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { listKairosAsksAnsweredBetween } from '@/lib/data/ask'
import { listChatThreadsWithMessagesOn } from '@/lib/data/kairos-chat'
import { captureMemory } from '@/lib/data/memories'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { runChatDistillForUser } from '@/lib/kairos/chat-distill'
import { chatDistillHandler } from '../handlers/chat-distill'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-10-01'
const TARGET = '2026-09-30'
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00.000Z`)

function message(threadId: string, seq: number, role: 'user' | 'assistant', content: string) {
  return {
    id: `${threadId}-m${seq}`,
    threadId,
    seq,
    role,
    content,
    citations: [],
    retrieval: null,
    model: null,
    createdAt: at('12:00', TARGET),
  }
}

const operatorThread = {
  id: 'thread-1',
  dominionId: DOM,
  title: 'Telegram · Kairos',
  messages: [
    message('thread-1', 1, 'user', 'I decided to ship the queue on Friday.'),
    message('thread-1', 2, 'assistant', 'Noted.'),
  ],
}
const assistantOnlyThread = {
  id: 'thread-2',
  dominionId: null,
  title: 'Musings',
  messages: [message('thread-2', 1, 'assistant', 'You should move to Lisbon.')],
}

function jobRow(context: Record<string, unknown>, overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: USER,
    kind: 'chat_distill',
    dominionId: DOM,
    externalKey: `chat_distill:thread-1:${TARGET}`,
    status: 'claimed',
    input: { system: 's', prompt: 'p', context },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('01:20'),
    deadlineAt: at('01:58'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('01:10'),
    updatedAt: at('01:10'),
    ...overrides,
  }
}

const context = {
  threadId: 'thread-1',
  dominionId: DOM,
  date: TARGET,
  messageSeqs: [1, 2],
  originKind: 'kairos',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listKairosAsksAnsweredBetween).mockResolvedValue([])
  vi.mocked(listChatThreadsWithMessagesOn).mockResolvedValue([operatorThread, assistantOnlyThread] as never)
  vi.mocked(captureMemory).mockImplementation((async (_userId: string, input: { sourceMetadata: { externalId: string } }) => ({
    memory: { id: `memory-${input.sourceMetadata.externalId}` },
    created: true,
  })) as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('chat_distill plan', () => {
  it('plans nothing outside its window, without touching the DB', async () => {
    for (const t of ['00:59', '01:58', '02:30', '23:00']) {
      expect(await chatDistillHandler.plan(USER, at(t))).toEqual([])
    }
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(listChatThreadsWithMessagesOn).not.toHaveBeenCalled()
  })

  it("plans one job per thread with operator signal, with the cron's exact prompt", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('01:30'))
    const cron = await runChatDistillForUser(USER, { dryRun: true })
    const cronInput = cron.threads.find((t) => t.threadId === 'thread-1')!.modelInput!

    const specs = await chatDistillHandler.plan(USER, at('01:30'))

    expect(listChatThreadsWithMessagesOn).toHaveBeenLastCalledWith(USER, at('00:00', TARGET), at('00:00', DAY), 80)
    expect(specs).toHaveLength(1)
    const [spec] = specs
    expect(spec).toMatchObject({
      kind: 'chat_distill',
      dominionId: DOM,
      externalKey: `chat_distill:thread-1:${TARGET}`,
      deadlineMinutes: 28,
    })
    expect(spec.input.system).toBe(cronInput.system)
    expect(spec.input.prompt).toBe(cronInput.prompt)
    expect(spec.input.maxOutputTokens).toBe(cronInput.maxTokens)
    expect(spec.input.context).toEqual(context)
  })

  it('carries the resolved ask into the prompt and context', async () => {
    vi.mocked(listKairosAsksAnsweredBetween).mockResolvedValue([{ id: 'ask-1', answeredAt: new Date(`${TARGET}T12:00:01.000Z`) }] as never)

    const [spec] = await chatDistillHandler.plan(USER, at('01:30'))

    expect(spec.input.prompt).toContain('Resolved ask memory: ask-1')
    expect(spec.input.context).toMatchObject({ askId: 'ask-1' })
  })

  it("skips the thread read once tonight's jobs exist", async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)

    expect(await chatDistillHandler.plan(USER, at('01:30'))).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'chat_distill', `chat_distill:%:${TARGET}`)
    expect(listChatThreadsWithMessagesOn).not.toHaveBeenCalled()
  })
})

describe('chat_distill apply', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('01:40'))
  })

  it('persists through the cron write path and writes the cron success trace', async () => {
    const text = '```json\n{"reflections":[{"title":"Ship Friday","bodyMd":"I decided to ship the queue on Friday."}]}\n```'

    const out = await chatDistillHandler.apply(jobRow(context), text, 'routine')

    expect(out).toEqual({ ok: true, memoryIds: [`memory-chat-distill:${TARGET}:thread-1:1`] })
    expect(captureMemory).toHaveBeenCalledWith(USER, {
      type: 'reflection',
      streamClass: 'reflection',
      source: 'cron',
      title: 'Ship Friday',
      bodyMd: 'I decided to ship the queue on Friday.',
      dominionId: DOM,
      sourceMetadata: {
        externalId: `chat-distill:${TARGET}:thread-1:1`,
        chatDistill: { threadId: 'thread-1', date: TARGET, messageSeqs: [1, 2] },
      },
    }, { origin: { kind: 'kairos', via: 'cron:chat-distill' } })
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'chat-distill' })
  })

  it('stamps the ask id carried in the job context', async () => {
    const text = '{"reflections":[{"title":"Answer","bodyMd":"I prefer weekly updates."}]}'

    await chatDistillHandler.apply(jobRow({ ...context, askId: 'ask-1' }), text, 'routine')

    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toMatchObject({ askId: 'ask-1' })
  })

  it('accepts a valid answer with zero reflections', async () => {
    const out = await chatDistillHandler.apply(jobRow(context), '```json\n{"reflections":[]}\n```', 'routine')

    expect(out).toEqual({ ok: true, memoryIds: [] })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('rejects an unparseable answer without writing', async () => {
    const out = await chatDistillHandler.apply(jobRow(context), 'Sure! Here are the reflections you asked for.', 'routine')

    expect(out).toMatchObject({ ok: false })
    expect((out as { reason: string }).reason).toMatch(/^parse_failed: .*no JSON object found/)
    expect(captureMemory).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('rejects a job planned for another day', async () => {
    const out = await chatDistillHandler.apply(jobRow({ ...context, date: '2026-09-29' }), '{"reflections":[]}', 'routine')

    expect(out).toEqual({ ok: false, reason: 'stale_job: planned for 2026-09-29' })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('rejects a job without thread context', async () => {
    const out = await chatDistillHandler.apply(jobRow({ date: TARGET }), '{"reflections":[]}', 'routine')

    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
  })

  it('falls back to the cron', async () => {
    expect(await chatDistillHandler.fallback(jobRow(context))).toEqual({
      ok: false,
      reason: 'deferred to the 02:00 UTC chat-distill cron',
    })
  })
})
