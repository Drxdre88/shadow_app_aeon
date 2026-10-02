import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const afterTasks: Array<() => Promise<unknown>> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => { afterTasks.push(task) },
}))

vi.mock('@/lib/kairos/proposal-accept', () => ({
  acceptInboxProposal: vi.fn(),
  dismissInboxMemory: vi.fn(),
}))

vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  createChatThread: vi.fn(),
  findOpenChatThreadByTitle: vi.fn(),
  getChatThread: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  markKairosSpeaksReplied: vi.fn(),
}))

vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(),
  upsertJob: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn', () => ({
  buildAssistantTurn: vi.fn(),
  isTurnAnswered: vi.fn(async () => false),
  persistAssistantReplyOnce: vi.fn(),
  resolvePendingAskForTurn: vi.fn(),
  runAssistantTurnOnce: vi.fn(),
  sendChatMessage: vi.fn(),
}))

vi.mock('@/lib/kairos/ask', () => ({
  answerKairosAsk: vi.fn(),
  answerNumberedKairosAsks: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn-reply', () => ({
  appendAssistantReplyOnce: vi.fn(),
}))

vi.mock('@/lib/kairos/paid-backup', () => ({
  isPaidBackupEnabled: vi.fn(async () => true),
  PAID_BACKUP_OFF_NOTE: 'paid backup off',
}))

import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'
import { CHAT_PAID_BACKUP_OFF_MESSAGE } from '@/lib/kairos/chat-routine'
import { acceptInboxProposal, dismissInboxMemory } from '@/lib/kairos/proposal-accept'
import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { appendAssistantReplyOnce } from '@/lib/kairos/chat-turn-reply'
import { appendChatMessage, createChatThread, findOpenChatThreadByTitle, getChatThread } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { failJob, findJobById, listJobs, upsertJob } from '@/lib/data/thinking-jobs'
import { buildAssistantTurn, runAssistantTurnOnce, sendChatMessage } from '@/lib/kairos/chat-turn'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const MEMORY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function makeReq(update: unknown, secretHeader?: string) {
  const headers = new Map<string, string>()
  if (secretHeader) headers.set('x-telegram-bot-api-secret-token', secretHeader)
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => update,
  } as unknown as Parameters<typeof POST>[0]
}

function callbackUpdate(data: string, chatId: number | string = Number(OPERATOR_CHAT)) {
  return {
    callback_query: {
      id: 'cbq-1',
      data,
      message: { message_id: 42, text: 'Heads up!', chat: { id: chatId } },
    },
  }
}

function textUpdate(text: string, chatId: number | string = Number(OPERATOR_CHAT), updateId?: number) {
  return { update_id: updateId, message: { text, chat: { id: chatId } } }
}

function fetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  })
}

function telegramCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    method: String(url).split('/').pop(),
    body: JSON.parse(init.body),
  }))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  afterTasks.length = 0
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = fetchOk()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue(THREAD_ID)
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
  vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: false })
  vi.mocked(isPaidBackupEnabled).mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
  delete process.env.KAIROS_OPERATOR_USER_ID
  delete process.env.TELEGRAM_BOT_TOKEN
})

describe('telegram webhook — auth', () => {
  it('rejects a missing or wrong secret header with 401', async () => {
    expect((await POST(makeReq(textUpdate('hi')))).status).toBe(401)
    expect((await POST(makeReq(textUpdate('hi'), 'wrong'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects everything when TELEGRAM_WEBHOOK_SECRET is unset', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    expect((await POST(makeReq(textUpdate('hi'), 'hook-secret'))).status).toBe(401)
  })
})

describe('telegram webhook — foreign chats', () => {
  it('ignores callbacks from any other chat id', async () => {
    const res = await POST(makeReq(callbackUpdate(`dismiss:${MEMORY_ID}`, 999), 'hook-secret'))
    expect(res.status).toBe(200)
    expect(dismissInboxMemory).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores text messages from any other chat id', async () => {
    const res = await POST(makeReq(textUpdate('hello', '999'), 'hook-secret'))
    expect(res.status).toBe(200)
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('telegram webhook — callback triage', () => {
  it('dismisses via the shared inbox helper, answers and edits the message', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: true, id: MEMORY_ID })

    const res = await POST(makeReq(callbackUpdate(`dismiss:${MEMORY_ID}`), 'hook-secret'))
    expect(res.status).toBe(200)
    expect(dismissInboxMemory).toHaveBeenCalledWith(OPERATOR_USER, MEMORY_ID)
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(OPERATOR_USER, expect.any(Date))

    const calls = telegramCalls(fetchMock)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      body: { callback_query_id: 'cbq-1', text: 'Dismissed' },
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      body: { chat_id: Number(OPERATOR_CHAT), message_id: 42 },
    })
    expect(calls[1].body.text).toContain('Dismissed')
  })

  it('answers a duplicate dismiss gracefully without editing (idempotent)', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: false, reason: 'already_resolved' })

    const res = await POST(makeReq(callbackUpdate(`dismiss:${MEMORY_ID}`), 'hook-secret'))
    expect(res.status).toBe(200)

    const calls = telegramCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      body: { text: 'Already handled' },
    })
  })

  it('still dismisses and answers when the reply marker fails', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: true, id: MEMORY_ID })
    vi.mocked(markKairosSpeaksReplied).mockRejectedValue(new Error('marker down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeReq(callbackUpdate(`dismiss:${MEMORY_ID}`), 'hook-secret'))

    expect(res.status).toBe(200)
    expect(dismissInboxMemory).toHaveBeenCalledWith(OPERATOR_USER, MEMORY_ID)
    const calls = telegramCalls(fetchMock)
    expect(calls[0].body.text).toBe('Dismissed')
    expect(calls[1].body.text).toContain('Dismissed')
    expect(consoleError).toHaveBeenCalledWith(
      '[telegram-webhook] reply marker failed',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('accepts via the shared inbox helper', async () => {
    vi.mocked(acceptInboxProposal).mockResolvedValue({ ok: true, id: MEMORY_ID })

    await POST(makeReq(callbackUpdate(`accept:${MEMORY_ID}`), 'hook-secret'))
    expect(acceptInboxProposal).toHaveBeenCalledWith(OPERATOR_USER, MEMORY_ID)
    expect(telegramCalls(fetchMock)[0].body.text).toBe('Accepted')
  })

  it('answers unknown callback data without touching the data layer', async () => {
    await POST(makeReq(callbackUpdate('detonate:everything'), 'hook-secret'))
    expect(dismissInboxMemory).not.toHaveBeenCalled()
    expect(acceptInboxProposal).not.toHaveBeenCalled()
    expect(telegramCalls(fetchMock)[0].body.text).toBe('Unknown action')
  })

  it('still returns 200 when the data layer throws', async () => {
    vi.mocked(dismissInboxMemory).mockRejectedValue(new Error('db down'))
    const res = await POST(makeReq(callbackUpdate(`dismiss:${MEMORY_ID}`), 'hook-secret'))
    expect(res.status).toBe(200)
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(OPERATOR_USER, expect.any(Date))
  })
})

describe('telegram webhook — numbered answers to open questions', () => {
  it('routes "Q12: … Q14: …" to the asks, acks once, keeps the exchange in the thread and skips chat', async () => {
    vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: true, answered: [12, 14], skipped: [], failed: [], stillOpen: [15, 16] })
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'msg-1', seq: 5 })
    vi.mocked(appendAssistantReplyOnce).mockResolvedValue({ ok: true, messageId: 'msg-2', seq: 6 })
    const body = 'Q12: yes, ship it\nQ14: the deploy broke'

    const res = await POST(makeReq(textUpdate(body), 'hook-secret'))

    expect(res.status).toBe(200)
    expect(answerNumberedKairosAsks).toHaveBeenCalledWith(OPERATOR_USER, body)
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(OPERATOR_USER, expect.any(Date))
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(buildAssistantTurn).not.toHaveBeenCalled()
    const ack = '✓ Q12, Q14 · still open: Q15, Q16'
    expect(appendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, { role: 'user', content: body })
    expect(appendAssistantReplyOnce).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 5, { content: ack })
    const calls = telegramCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'sendMessage', body: { text: ack } })
  })

  it('acks a skip the same way', async () => {
    vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: true, answered: [], skipped: [13], failed: [], stillOpen: [] })
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'msg-1', seq: 1 })

    await POST(makeReq(textUpdate('skip Q13'), 'hook-secret'))

    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(telegramCalls(fetchMock)[0].body.text).toBe('skipped Q13 · nothing else open')
  })

  it('still acks when writing the exchange into the thread fails', async () => {
    vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: true, answered: [12], skipped: [], failed: [], stillOpen: [] })
    vi.mocked(appendChatMessage).mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(makeReq(textUpdate('Q12: yes'), 'hook-secret'))

    expect(telegramCalls(fetchMock)[0].body.text).toBe('✓ Q12 · nothing else open')
    expect(sendChatMessage).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('plain prose (no open Q label) goes to chat exactly as before', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Morning.', model: 'fake-model',
    })

    await POST(makeReq(textUpdate('morning, Q3 numbers look flat'), 'hook-secret'))

    expect(answerNumberedKairosAsks).toHaveBeenCalledWith(OPERATOR_USER, 'morning, Q3 numbers look flat')
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'morning, Q3 numbers look flat', { surface: 'telegram' })
    expect(appendAssistantReplyOnce).not.toHaveBeenCalled()
  })

  it('falls through to chat when the backlog cannot be read', async () => {
    vi.mocked(answerNumberedKairosAsks).mockRejectedValue(new Error('db down'))
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: 'fake-model',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(makeReq(textUpdate('Q12: yes'), 'hook-secret'))

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})

describe('telegram webhook — chat with Kairos', () => {
  it('pipes text into the persistent whole-brain thread and replies', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true,
      threadId: THREAD_ID,
      userSeq: 1,
      assistantSeq: 2,
      assistantContent: `On it. [[${MEMORY_ID}]]`,
      model: 'fake-model',
    })

    const res = await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    expect(res.status).toBe(200)
    expect(findOpenChatThreadByTitle).toHaveBeenCalledWith(OPERATOR_USER, 'Telegram · Kairos')
    expect(createChatThread).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'status of hydra?', { surface: 'telegram' })
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(OPERATOR_USER, expect.any(Date))

    const calls = telegramCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('sendMessage')
    // Citation markers are stripped for Telegram; reply goes out as HTML.
    expect(calls[0].body.text).toBe('On it.')
    expect(calls[0].body.parse_mode).toBe('HTML')
  })

  it('still replies when marking earlier speaks as replied fails', async () => {
    vi.mocked(markKairosSpeaksReplied).mockRejectedValue(new Error('db down'))
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true,
      threadId: THREAD_ID,
      userSeq: 1,
      assistantSeq: 2,
      assistantContent: 'Still here.',
      model: 'fake-model',
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeReq(textUpdate('hello'), 'hook-secret'))

    expect(res.status).toBe(200)
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'hello', { surface: 'telegram' })
    expect(telegramCalls(fetchMock)[0].body.text).toBe('Still here.')
    expect(consoleError).toHaveBeenCalledWith(
      '[telegram-webhook] reply marker failed',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('falls back to a plain-text send when Telegram rejects the HTML', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2,
      assistantContent: '**broken markup', model: null,
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }),
      })

    const res = await POST(makeReq(textUpdate('hi'), 'hook-secret'))
    expect(res.status).toBe(200)
    const calls = telegramCalls(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls[1].body.parse_mode).toBeUndefined()
    expect(calls[1].body.text).toBe('**broken markup')
  })

  it('creates the persistent thread on first contact', async () => {
    vi.mocked(findOpenChatThreadByTitle).mockResolvedValue(null)
    vi.mocked(createChatThread).mockResolvedValue({ ok: true, threadId: THREAD_ID })
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hello.', model: null,
    })

    await POST(makeReq(textUpdate('hi'), 'hook-secret'))
    expect(createChatThread).toHaveBeenCalledWith(OPERATOR_USER, {
      dominionId: null,
      title: 'Telegram · Kairos',
    })
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'hi', { surface: 'telegram' })
  })

  it('replies "brain offline" when no BYOK credential is configured', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: false, reason: 'no_credential', threadId: THREAD_ID })

    const res = await POST(makeReq(textUpdate('hi'), 'hook-secret'))
    expect(res.status).toBe(200)
    const calls = telegramCalls(fetchMock)
    expect(calls[0].body.text).toContain('offline')
  })

  it('splits long assistant replies into multiple messages', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true,
      threadId: THREAD_ID,
      userSeq: 1,
      assistantSeq: 2,
      assistantContent: Array.from({ length: 80 }, (_, i) => `line ${i} ${'x'.repeat(90)}`).join('\n'),
      model: null,
    })

    await POST(makeReq(textUpdate('long one'), 'hook-secret'))
    const calls = telegramCalls(fetchMock)
    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) {
      expect(call.method).toBe('sendMessage')
      expect(call.body.text.length).toBeLessThanOrEqual(4096)
    }
  })

  it('caps a runaway reply at two Telegram messages and points at Aeon for the rest', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true,
      threadId: THREAD_ID,
      userSeq: 1,
      assistantSeq: 2,
      assistantContent: Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(90)}`).join('\n'),
      model: null,
    })

    await POST(makeReq(textUpdate('long one'), 'hook-secret'))
    const calls = telegramCalls(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls[1].body.text).toContain('cut short — the full reply is in Aeon')
    for (const call of calls) expect(call.body.text.length).toBeLessThanOrEqual(4096)
  })
})

describe('telegram webhook — redelivery dedup (best-effort, warm-instance only)', () => {
  it('answers ok without re-processing a text message redelivered with the same update_id', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: null,
    })

    const first = await POST(makeReq(textUpdate('hello', undefined, 555_001), 'hook-secret'))
    expect(first.status).toBe(200)
    expect(sendChatMessage).toHaveBeenCalledTimes(1)

    const second = await POST(makeReq(textUpdate('hello', undefined, 555_001), 'hook-secret'))
    expect(second.status).toBe(200)
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('processes two text messages with different update_ids normally', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: null,
    })

    await POST(makeReq(textUpdate('hello', undefined, 555_002), 'hook-secret'))
    await POST(makeReq(textUpdate('hello again', undefined, 555_003), 'hook-secret'))

    expect(sendChatMessage).toHaveBeenCalledTimes(2)
  })

  it('processes normally when update_id is absent (best-effort only, never blocks delivery)', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: null,
    })

    await POST(makeReq(textUpdate('no id one'), 'hook-secret'))
    await POST(makeReq(textUpdate('no id two'), 'hook-secret'))

    expect(sendChatMessage).toHaveBeenCalledTimes(2)
  })
})

describe('telegram webhook — chat routine flag off (default)', () => {
  it('answers on the paid path and never touches the job queue or the routine', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: null,
    })
    process.env.ROUTINE_CHAT_ID = 'trig_x'
    process.env.ROUTINE_CHAT_TOKEN = 'routine-token'
    try {
      await POST(makeReq(textUpdate('hello'), 'hook-secret'))
    } finally {
      delete process.env.ROUTINE_CHAT_ID
      delete process.env.ROUTINE_CHAT_TOKEN
    }
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(upsertJob).not.toHaveBeenCalled()
    expect(listJobs).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
    expect(telegramCalls(fetchMock).map((c) => c.method)).toEqual(['sendMessage'])
  })
})

describe('telegram webhook — chat routine (KAIROS_TELEGRAM_ROUTINE=1, legacy flag name)', () => {
  const USER_MSG_ID = 'msg-1'
  const JOB_ID = 'job-1'
  const ROUTINE_ENV = {
    KAIROS_TELEGRAM_ROUTINE: '1',
    ROUTINE_CHAT_ID: 'trig_chat',
    ROUTINE_CHAT_TOKEN: 'routine-token',
    KAIROS_CHAT_ROUTINE_TIMEOUT_MS: '40',
    KAIROS_CHAT_ROUTINE_POLL_MS: '5',
  }

  function thread(messages: Array<{ id: string; seq: number; role: 'user' | 'assistant'; content: string }>) {
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

  let lastJob: ThinkingJobRow
  function job(status: ThinkingJobRow['status'], error: string | null = null): ThinkingJobRow {
    return { ...lastJob, status, error }
  }

  function fireCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.anthropic.com/'))
  }

  async function drainAfter() {
    while (afterTasks.length) await afterTasks.shift()!()
  }

  beforeEach(() => {
    Object.assign(process.env, ROUTINE_ENV)
    vi.mocked(getChatThread)
      .mockResolvedValueOnce(thread([]))
      .mockResolvedValue(thread([{ id: USER_MSG_ID, seq: 1, role: 'user', content: 'status of hydra?' }]))
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: USER_MSG_ID, seq: 1 })
    vi.mocked(listJobs).mockResolvedValue([])
    vi.mocked(buildAssistantTurn).mockResolvedValue({
      ok: true,
      turn: {
        system: 'You are Kairos.',
        messages: [
          { role: 'system', content: 'You are Kairos.' },
          { role: 'user', content: 'status of hydra?' },
        ],
        citationsContext: { retrieved: null },
        pendingAsk: null,
      },
    })
    vi.mocked(upsertJob).mockImplementation(async (userId, spec) => {
      lastJob = {
        id: JOB_ID, userId, kind: spec.kind, dominionId: null, externalKey: spec.externalKey,
        status: 'queued', input: spec.input, output: null, claimedBy: null, claimToken: null,
        claimedAt: null, deadlineAt: new Date(Date.now() + spec.deadlineMinutes * 60_000),
        completedAt: null, attempts: 0, error: null, createdAt: new Date(), updatedAt: new Date(),
      }
      return lastJob
    })
    vi.mocked(runAssistantTurnOnce).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Paid answer.', model: 'paid',
    })
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.anthropic.com/')
      ? { ok: true, status: 200, text: async () => JSON.stringify({ type: 'routine_fire' }) }
      : { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }))
  })

  afterEach(() => {
    for (const k of Object.keys(ROUTINE_ENV)) delete process.env[k]
  })

  it('persists the turn, queues a chat job and returns before the routine answers', async () => {
    const res = await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))

    expect(res.status).toBe(200)
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(appendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, { role: 'user', content: 'status of hydra?' })
    expect(upsertJob).toHaveBeenCalledWith(OPERATOR_USER, expect.objectContaining({
      kind: 'chat',
      externalKey: `chat:${THREAD_ID}:${USER_MSG_ID}`,
      deadlineMinutes: (40 + 30_000) / 60_000,
    }))
    expect(lastJob.input.prompt).toContain('status of hydra?')
    expect(lastJob.input.context).toMatchObject({ threadId: THREAD_ID, userSeq: 1, chatId: Number(OPERATOR_CHAT) })
    expect(telegramCalls(fetchMock)[0].method).toBe('sendChatAction')
    // Fire + watchdog are deferred to after().
    expect(fireCalls()).toHaveLength(0)
    expect(afterTasks).toHaveLength(1)
  })

  it('fires the routine, then answers on the paid key once the timeout passes', async () => {
    vi.mocked(findJobById).mockImplementation(async () => job('queued'))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _token, error) => job('failed', error))

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    await drainAfter()

    const [fireUrl, fireInit] = fireCalls()[0]
    expect(fireUrl).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_chat/fire')
    expect(fireInit.headers).toMatchObject({
      Authorization: 'Bearer routine-token',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
    })
    expect(JSON.parse(fireInit.body)).toEqual({ text: 'claim chat jobs' })

    expect(failJob).toHaveBeenCalledTimes(1)
    expect(failJob).toHaveBeenCalledWith(OPERATOR_USER, JOB_ID, null, expect.stringContaining('chat-watchdog:'))
    expect(runAssistantTurnOnce).toHaveBeenCalledTimes(1)
    expect(runAssistantTurnOnce).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, null, 'status of hydra?', 1, { surface: 'telegram' })
    const replies = telegramCalls(fetchMock).filter((c) => c.method === 'sendMessage')
    expect(replies).toHaveLength(1)
    expect(replies[0].body.text).toBe('Paid answer.')
  })

  it('does not fall back when the routine answers before the timeout', async () => {
    vi.mocked(findJobById)
      .mockImplementationOnce(async () => job('queued'))
      .mockImplementation(async () => job('done'))

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    await drainAfter()

    expect(fireCalls()).toHaveLength(1)
    expect(failJob).not.toHaveBeenCalled()
    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
  })

  it('exactly once: a routine that wins the race at the timeout keeps the turn', async () => {
    let routineDone = false
    vi.mocked(findJobById).mockImplementation(async () => job(routineDone ? 'done' : 'queued'))
    // The routine completes between the watchdog's read and its takeover.
    vi.mocked(failJob).mockImplementation(async () => {
      routineDone = true
      return null
    })

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    await drainAfter()

    expect(failJob).toHaveBeenCalledTimes(1)
    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
  })

  it('a failed fire answers on the paid key immediately', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.anthropic.com/')
      ? { ok: false, status: 401, text: async () => 'bad token' }
      : { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _token, error) => job('failed', error))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    await drainAfter()
    consoleError.mockRestore()

    expect(findJobById).not.toHaveBeenCalled()
    expect(failJob).toHaveBeenCalledWith(OPERATOR_USER, JOB_ID, null, expect.stringContaining('fire failed (401)'))
    expect(runAssistantTurnOnce).toHaveBeenCalledTimes(1)
  })

  it('a redelivered in-flight turn is not persisted, queued or answered again', async () => {
    vi.mocked(getChatThread).mockReset()
      .mockResolvedValue(thread([{ id: USER_MSG_ID, seq: 1, role: 'user', content: 'status of hydra?' }]))
    vi.mocked(listJobs).mockImplementation(async (_u, filter) => (filter?.status === 'queued'
      ? [{ externalKey: `chat:${THREAD_ID}:${USER_MSG_ID}` } as ThinkingJobRow]
      : []))

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))

    expect(appendChatMessage).not.toHaveBeenCalled()
    expect(upsertJob).not.toHaveBeenCalled()
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('an identical resend while the watchdog paid fallback is in flight starts no second paid turn', async () => {
    let created = false
    let current: ThinkingJobRow | null = null
    vi.mocked(upsertJob).mockImplementationOnce(async (userId, spec) => {
      lastJob = {
        id: JOB_ID, userId, kind: spec.kind, dominionId: null, externalKey: spec.externalKey,
        status: 'queued', input: spec.input, output: null, claimedBy: null, claimToken: null,
        claimedAt: null, deadlineAt: new Date(Date.now() + spec.deadlineMinutes * 60_000),
        completedAt: null, attempts: 0, error: null, createdAt: new Date(), updatedAt: new Date(),
      }
      created = true
      current = lastJob
      return lastJob
    })
    vi.mocked(findJobById).mockImplementation(async () => current)
    vi.mocked(failJob).mockImplementation(async (_u, _id, _token, error) => {
      current = job('failed', error)
      return current
    })
    vi.mocked(listJobs).mockImplementation(async (_u, filter) => {
      if (!created || !current) return []
      if (filter?.status) return current.status === filter.status ? [current] : []
      return filter?.since && current.createdAt >= filter.since ? [current] : []
    })
    let releasePaid!: () => void
    const paidThinking = new Promise<void>((resolve) => { releasePaid = resolve })
    vi.mocked(runAssistantTurnOnce).mockImplementation(async () => {
      await paidThinking
      return { ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Paid answer.', model: 'paid' }
    })

    await POST(makeReq(textUpdate('status of hydra?', Number(OPERATOR_CHAT), 9001), 'hook-secret'))
    const watchdog = drainAfter()
    await vi.waitFor(() => expect(runAssistantTurnOnce).toHaveBeenCalledTimes(1))
    expect(current!.status).toBe('failed')
    expect(current!.error).toMatch(/^chat-watchdog:/)

    // Telegram resends the same text (new update id) while the paid model thinks.
    await POST(makeReq(textUpdate('status of hydra?', Number(OPERATOR_CHAT), 9002), 'hook-secret'))
    releasePaid()
    await watchdog

    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(runAssistantTurnOnce).toHaveBeenCalledTimes(1)
    expect(upsertJob).toHaveBeenCalledTimes(1)
    expect(appendChatMessage).toHaveBeenCalledTimes(1)
    const replies = telegramCalls(fetchMock).filter((c) => c.method === 'sendMessage')
    expect(replies.map((r) => r.body.text)).toEqual(['Paid answer.'])
  })

  it('an identical resend after the job settled outside the window retries on the paid path', async () => {
    vi.mocked(getChatThread).mockReset()
      .mockResolvedValue(thread([{ id: USER_MSG_ID, seq: 1, role: 'user', content: 'status of hydra?' }]))
    // The job failed long ago; the recent-jobs lookup (bounded by the window) no longer sees it.
    vi.mocked(listJobs).mockResolvedValue([])
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Retried.', model: null,
    })

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))

    expect(vi.mocked(listJobs).mock.calls.some(([, f]) => f?.since instanceof Date)).toBe(true)
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(upsertJob).not.toHaveBeenCalled()
  })

  it('a newer message supersedes the open chat job on the thread', async () => {
    vi.mocked(listJobs).mockImplementation(async (_u, filter) => (filter?.status === 'claimed'
      ? [{ id: 'job-old', externalKey: `chat:${THREAD_ID}:msg-0` } as ThinkingJobRow]
      : []))
    vi.mocked(failJob).mockResolvedValue({} as ThinkingJobRow)

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))

    expect(failJob).toHaveBeenCalledWith(OPERATOR_USER, 'job-old', null, expect.stringMatching(/^superseded:/))
    expect(upsertJob).toHaveBeenCalledTimes(1)
  })

  it('stays on the paid path when the routine is not configured', async () => {
    delete process.env.ROUTINE_CHAT_TOKEN
    vi.mocked(sendChatMessage).mockResolvedValue({
      ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Hi.', model: null,
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await POST(makeReq(textUpdate('hello'), 'hook-secret'))
    consoleWarn.mockRestore()

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(upsertJob).not.toHaveBeenCalled()
  })

  it('an identical resend outside the window gets the Max-plan notice, not a paid answer, when the paid backup is off', async () => {
    vi.mocked(isPaidBackupEnabled).mockResolvedValue(false)
    vi.mocked(getChatThread).mockReset()
      .mockResolvedValue(thread([{ id: USER_MSG_ID, seq: 1, role: 'user', content: 'status of hydra?' }]))
    vi.mocked(listJobs).mockResolvedValue([])

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))

    expect(sendChatMessage).not.toHaveBeenCalled()
    const replies = telegramCalls(fetchMock).filter((c) => c.method === 'sendMessage')
    expect(replies.map((r) => r.body.text)).toEqual([CHAT_PAID_BACKUP_OFF_MESSAGE])
  })

  it('the watchdog sends the Max-plan notice instead of a paid answer when the paid backup is off', async () => {
    vi.mocked(isPaidBackupEnabled).mockResolvedValue(false)
    vi.mocked(findJobById).mockImplementation(async () => job('queued'))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _token, error) => job('failed', error))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    await drainAfter()
    consoleError.mockRestore()

    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
    const replies = telegramCalls(fetchMock).filter((c) => c.method === 'sendMessage')
    expect(replies.map((r) => r.body.text)).toEqual([CHAT_PAID_BACKUP_OFF_MESSAGE])
  })

  it('KAIROS_CHAT_ROUTINE=1 turns the routine on just like the legacy name', async () => {
    delete process.env.KAIROS_TELEGRAM_ROUTINE
    process.env.KAIROS_CHAT_ROUTINE = '1'
    try {
      await POST(makeReq(textUpdate('status of hydra?'), 'hook-secret'))
    } finally {
      delete process.env.KAIROS_CHAT_ROUTINE
    }
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(upsertJob).toHaveBeenCalledTimes(1)
    expect(lastJob.input.context).toMatchObject({ channel: 'telegram', chatId: Number(OPERATOR_CHAT) })
  })
})
