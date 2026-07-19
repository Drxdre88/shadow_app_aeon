import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/inbox', () => ({
  acceptInboxProposal: vi.fn(),
  dismissInboxMemory: vi.fn(),
}))

vi.mock('@/lib/data/kairos-chat', () => ({
  createChatThread: vi.fn(),
  findOpenChatThreadByTitle: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  markKairosSpeaksReplied: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn', () => ({
  sendChatMessage: vi.fn(),
}))

import { acceptInboxProposal, dismissInboxMemory } from '@/lib/data/inbox'
import { createChatThread, findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
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

function textUpdate(text: string, chatId: number | string = Number(OPERATOR_CHAT)) {
  return { message: { text, chat: { id: chatId } } }
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
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = fetchOk()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue(THREAD_ID)
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
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
})
