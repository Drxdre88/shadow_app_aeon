import { beforeEach, describe, expect, it, vi } from 'vitest'

const afterTasks: Array<() => Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => { afterTasks.push(task) },
}))

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn', () => ({
  isTurnAnswered: vi.fn(),
  persistAssistantReplyOnce: vi.fn(),
  resolvePendingAskForTurn: vi.fn(),
  runAssistantTurnOnce: vi.fn(),
}))

import { findJobById } from '@/lib/data/thinking-jobs'
import {
  isTurnAnswered,
  persistAssistantReplyOnce,
  resolvePendingAskForTurn,
  runAssistantTurnOnce,
} from '@/lib/kairos/chat-turn'
import type { BuiltAssistantTurn } from '@/lib/kairos/chat-turn'
import { turnCoveredBy, type ChatReplyMark } from '@/lib/kairos/chat-turn-reply'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import {
  buildChatJobSpec,
  CHAT_ROUTINE_MODEL,
  chatHandler,
  renderChatJobInput,
  turnAlreadyAnswered,
} from '../handlers/chat'

const USER = 'user-1'
const THREAD = 'thread-1'
const CHAT_ID = 12345
const MEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

// In-memory thread with the reply ledger's real attribution rule: the mocks
// below persist exclusively exactly like appendAssistantReplyOnce (check +
// insert are one synchronous step here, as they are one locked transaction
// there).
type Msg = ChatReplyMark & { content: string }
let messages: Msg[]

function appendOnce(userSeq: number, content: string) {
  if (turnCoveredBy(messages, userSeq)) return { ok: false as const, reason: 'already_answered' as const, threadId: THREAD }
  const seq = messages.length + 1
  messages.push({ seq, role: 'assistant', content, answersSeq: userSeq })
  return { ok: true as const, threadId: THREAD, userSeq, assistantSeq: seq, assistantContent: content, model: null }
}

// Optional pauses inside the persist / paid-model steps to interleave the
// routine apply with the watchdog fallback.
let beforeRoutinePersist: (() => Promise<void>) | null
let paidModelThinking: (() => Promise<void>) | null

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const built: BuiltAssistantTurn = {
  system: 'You are Kairos.',
  messages: [
    { role: 'system', content: 'You are Kairos.' },
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'status of hydra?' },
  ],
  citationsContext: {
    retrieved: { cortex: { id: MEM }, archetypes: [], substrate: [] },
    retrievalMeta: { cortex: { id: MEM, title: 'Hydra cortex' } },
  },
  pendingAsk: { id: 'ask-1' } as BuiltAssistantTurn['pendingAsk'],
}

function jobFor(seq: number, status: ThinkingJobRow['status'] = 'claimed', id = 'job-1'): ThinkingJobRow {
  const spec = buildChatJobSpec(built, {
    threadId: THREAD, userSeq: seq, userMessageId: `m${seq}`, chatId: CHAT_ID, dominionId: null, userBody: 'status of hydra?',
  }, 60_000)
  return {
    id, userId: USER, kind: spec.kind, dominionId: null, externalKey: spec.externalKey, status,
    input: spec.input, output: null, claimedBy: 'routine', claimToken: 'tok', claimedAt: new Date(),
    deadlineAt: new Date(Date.now() + 90_000), completedAt: null, attempts: 1, error: null,
    createdAt: new Date(), updatedAt: new Date(),
  }
}

let fetchMock: ReturnType<typeof vi.fn>
const sentTexts = () => fetchMock.mock.calls
  .filter(([url]) => String(url).endsWith('/sendMessage'))
  .map(([, init]) => JSON.parse(init.body).text as string)
const assistantMessages = () => messages.filter((m) => m.role === 'assistant')

beforeEach(() => {
  vi.clearAllMocks()
  afterTasks.length = 0
  beforeRoutinePersist = null
  paidModelThinking = null
  process.env.TELEGRAM_BOT_TOKEN = 'bot'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  messages = [{ seq: 1, role: 'user', content: 'status of hydra?', answersSeq: null }]
  vi.mocked(isTurnAnswered).mockImplementation(async (_u, _t, userSeq) => turnCoveredBy(messages, userSeq))
  vi.mocked(persistAssistantReplyOnce).mockImplementation(async (_u, _t, text, meta) => {
    await beforeRoutinePersist?.()
    return text.trim() ? appendOnce(meta.userSeq, text.trim()) : { ok: false, reason: 'ai_empty', threadId: THREAD }
  })
  vi.mocked(runAssistantTurnOnce).mockImplementation(async (_u, _t, _d, _b, userSeq) => {
    await paidModelThinking?.()
    return appendOnce(userSeq, 'Paid answer.')
  })
  vi.mocked(findJobById).mockImplementation(async () => jobFor(1))
})

describe('chat job spec', () => {
  it('keys the job by thread + user message, carries the prompt as system + transcript, and no tools', () => {
    const spec = buildChatJobSpec(built, {
      threadId: THREAD, userSeq: 3, userMessageId: 'msg-3', chatId: CHAT_ID, dominionId: null, userBody: 'status of hydra?',
    }, 60_000)
    expect(spec).toMatchObject({ kind: 'chat', externalKey: `chat:${THREAD}:msg-3`, deadlineMinutes: 1.5 })
    expect(spec.input.validMemoryIds).toEqual([MEM])
    expect(spec.input.system.startsWith('You are Kairos.')).toBe(true)
    expect(spec.input.system).toContain('not a JSON task')
    expect(spec.input).not.toHaveProperty('tools')
    expect(spec.input.context).toMatchObject({ pendingAskId: 'ask-1', userSeq: 3, chatId: CHAT_ID })
  })

  it('renders history oldest first and ends on the new operator message', () => {
    const { prompt } = renderChatJobInput(built)
    expect(prompt.indexOf('earlier question')).toBeLessThan(prompt.indexOf('earlier answer'))
    expect(prompt.trimEnd().endsWith('status of hydra?')).toBe(true)
    expect(prompt).toContain('[Kairos]')
  })

  it('is never planned by the queue', async () => {
    expect(await chatHandler.plan(USER, new Date())).toEqual([])
  })
})

describe('chat apply (routine answer)', () => {
  it('persists exclusively through the shared reply path and sends it to Telegram without citation markers', async () => {
    const out = await chatHandler.apply(jobFor(1), `Hydra is green. [[${MEM}]]`, 'routine')

    expect(out).toEqual({ ok: true, memoryIds: [] })
    expect(persistAssistantReplyOnce).toHaveBeenCalledWith(USER, THREAD, `Hydra is green. [[${MEM}]]`, expect.objectContaining({
      userSeq: 1,
      model: CHAT_ROUTINE_MODEL,
      citationsContext: {
        retrieved: { cortex: { id: MEM }, archetypes: [], substrate: [] },
        retrievalMeta: { cortex: { id: MEM, title: 'Hydra cortex' } },
      },
    }))
    expect(assistantMessages()).toEqual([expect.objectContaining({ answersSeq: 1 })])
    expect(sentTexts()).toEqual(['Hydra is green.'])
  })

  it('defers the ask-resolution model call past the response (after completeJob)', async () => {
    await chatHandler.apply(jobFor(1), 'Hydra is green.', 'routine')
    // Not inside the claimed window…
    expect(resolvePendingAskForTurn).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(1)
    // …but once the response (and the queue's completeJob) is done.
    await afterTasks[0]()
    expect(resolvePendingAskForTurn).toHaveBeenCalledWith(USER, null, 'ask-1', 'status of hydra?')
  })

  it('refuses to write once the watchdog took the job over', async () => {
    vi.mocked(findJobById).mockResolvedValue(jobFor(1, 'failed'))
    const out = await chatHandler.apply(jobFor(1), 'late answer', 'routine')
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^superseded/) })
    expect(persistAssistantReplyOnce).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty routine reply so the watchdog covers the turn', async () => {
    expect(await chatHandler.apply(jobFor(1), '   ', 'routine')).toEqual({ ok: false, reason: 'empty_reply' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('chat fallback (paid key)', () => {
  it('answers on the paid path (exclusive persist) and sends the reply', async () => {
    expect(await chatHandler.fallback(jobFor(1, 'failed'))).toEqual({ ok: true, memoryIds: [] })
    expect(runAssistantTurnOnce).toHaveBeenCalledWith(USER, THREAD, null, 'status of hydra?', 1, { surface: 'telegram' })
    expect(sentTexts()).toEqual(['Paid answer.'])
  })

  it('tells the operator when the paid path has no key', async () => {
    vi.mocked(runAssistantTurnOnce).mockResolvedValueOnce({ ok: false, reason: 'no_credential', threadId: THREAD })
    const out = await chatHandler.fallback(jobFor(1, 'failed'))
    expect(out).toMatchObject({ ok: false })
    expect(sentTexts()[0]).toContain('offline')
  })
})

describe('exactly one reply per turn', () => {
  it('routine first, then fallback → one reply', async () => {
    await chatHandler.apply(jobFor(1), 'Routine answer.', 'routine')
    await chatHandler.fallback(jobFor(1, 'failed'))
    expect(assistantMessages()).toHaveLength(1)
    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
    expect(sentTexts()).toEqual(['Routine answer.'])
  })

  it('fallback first, then a straggling routine apply → one reply', async () => {
    await chatHandler.fallback(jobFor(1, 'failed'))
    // Overlap window: the routine passed the queue's claimed check earlier.
    await chatHandler.apply(jobFor(1), 'Routine answer.', 'routine')
    expect(assistantMessages()).toHaveLength(1)
    expect(persistAssistantReplyOnce).not.toHaveBeenCalled()
    expect(sentTexts()).toEqual(['Paid answer.'])
  })

  describe('superseding thread [u1, u2]', () => {
    beforeEach(() => {
      messages = [
        { seq: 1, role: 'user', content: 'first', answersSeq: null },
        { seq: 2, role: 'user', content: 'second', answersSeq: null },
      ]
      vi.mocked(findJobById).mockImplementation(async () => jobFor(2, 'claimed', 'job-2'))
    })

    it('routine apply for u2 overruns the deadline, watchdog takes over mid-apply → one message, one send', async () => {
      // The routine has persisted u2's reply and is still sending it when the
      // watchdog/sweep runs the fallback for the same job.
      const sending = deferred()
      const fetchReal = fetchMock.getMockImplementation()!
      fetchMock.mockImplementationOnce(async (...args: unknown[]) => {
        await sending.promise
        return fetchReal(...args)
      })

      const applying = chatHandler.apply(jobFor(2, 'claimed', 'job-2'), 'Routine answer to both.', 'routine')
      await vi.waitFor(() => expect(assistantMessages()).toHaveLength(1))
      // Takeover mid-apply: fallback for u2's job.
      const fb = await chatHandler.fallback(jobFor(2, 'failed', 'job-2'))
      sending.resolve()
      await applying

      expect(fb).toEqual({ ok: true, memoryIds: [] })
      expect(runAssistantTurnOnce).not.toHaveBeenCalled()
      expect(assistantMessages()).toEqual([expect.objectContaining({ answersSeq: 2, content: 'Routine answer to both.' })])
      expect(sentTexts()).toEqual(['Routine answer to both.'])
    })

    it('both pass the pre-check, the routine persists while the paid model thinks → paid reply dropped unsent', async () => {
      const thinking = deferred()
      paidModelThinking = () => thinking.promise

      const fb = chatHandler.fallback(jobFor(2, 'failed', 'job-2'))
      await vi.waitFor(() => expect(runAssistantTurnOnce).toHaveBeenCalled())
      await chatHandler.apply(jobFor(2, 'claimed', 'job-2'), 'Routine answer.', 'routine')
      thinking.resolve()

      expect(await fb).toEqual({ ok: true, memoryIds: [] })
      expect(assistantMessages()).toHaveLength(1)
      expect(sentTexts()).toEqual(['Routine answer.'])
    })

    it('the paid fallback persists first while the routine apply is mid-flight → routine reply dropped unsent', async () => {
      const gate = deferred()
      beforeRoutinePersist = () => gate.promise

      const applying = chatHandler.apply(jobFor(2, 'claimed', 'job-2'), 'Routine answer.', 'routine')
      await vi.waitFor(() => expect(persistAssistantReplyOnce).toHaveBeenCalled())
      await chatHandler.fallback(jobFor(2, 'failed', 'job-2'))
      gate.resolve()

      expect(await applying).toEqual({ ok: true, memoryIds: [] })
      expect(assistantMessages()).toEqual([expect.objectContaining({ answersSeq: 2, content: 'Paid answer.' })])
      expect(sentTexts()).toEqual(['Paid answer.'])
      expect(afterTasks).toHaveLength(0)
    })

    it('a late fallback for the superseded u1 after u2 was answered is dropped', async () => {
      await chatHandler.apply(jobFor(2, 'claimed', 'job-2'), 'Routine answer to both.', 'routine')
      await chatHandler.fallback(jobFor(1, 'failed', 'job-1'))
      expect(assistantMessages()).toHaveLength(1)
      expect(sentTexts()).toEqual(['Routine answer to both.'])
    })
  })
})

describe('turnAlreadyAnswered (reply ledger attribution)', () => {
  it('a late reply to an earlier turn does not answer the newer one', async () => {
    messages = [
      { seq: 1, role: 'user', content: 'first', answersSeq: null },
      { seq: 2, role: 'user', content: 'second', answersSeq: null },
      { seq: 3, role: 'assistant', content: 'reply to first', answersSeq: 1 },
    ]
    expect(await turnAlreadyAnswered(USER, THREAD, 1)).toBe(true)
    expect(await turnAlreadyAnswered(USER, THREAD, 2)).toBe(false)
  })

  it('a reply to the newer turn covers every earlier turn (it superseded them)', async () => {
    messages = [
      { seq: 1, role: 'user', content: 'first', answersSeq: null },
      { seq: 2, role: 'user', content: 'second', answersSeq: null },
      { seq: 3, role: 'assistant', content: 'reply to both', answersSeq: 2 },
    ]
    expect(await turnAlreadyAnswered(USER, THREAD, 2)).toBe(true)
    expect(await turnAlreadyAnswered(USER, THREAD, 1)).toBe(true)
  })

  it('earlier history never counts; an unattributed (paid-path) reply after the turn does', async () => {
    messages = [
      { seq: 1, role: 'user', content: 'orphan from last week', answersSeq: null },
      { seq: 2, role: 'user', content: 'q', answersSeq: null },
      { seq: 3, role: 'assistant', content: 'a', answersSeq: null },
      { seq: 4, role: 'user', content: 'now', answersSeq: null },
    ]
    expect(await turnAlreadyAnswered(USER, THREAD, 4)).toBe(false)
    messages.push({ seq: 5, role: 'assistant', content: 'reply', answersSeq: null })
    expect(await turnAlreadyAnswered(USER, THREAD, 4)).toBe(true)
  })
})