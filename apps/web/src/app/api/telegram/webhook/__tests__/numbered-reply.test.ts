import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Owner answers to open Kairos questions over Telegram, end to end through the
// real ask router (lib/kairos/ask + ask-numbered): bare "Q11 text" labels, a
// later label mid-message, and a Telegram reply to one question's message.
// Only the data layer and the chat side are stubbed.

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/aether', () => ({ getLatestAether: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({
  getPriorAethers: vi.fn(),
  getReflectionsSince: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  getOpenKairosAskById: vi.fn(),
  listOpenKairosAsks: vi.fn(),
  markKairosAskDismissed: vi.fn(),
  getNewestKairosAsk: vi.fn(),
  createKairosAskMemory: vi.fn(),
  markKairosAskAnswered: vi.fn(),
  archiveOrphanAnswerMemory: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ captureReflection: vi.fn(), markKairosSpeaksReplied: vi.fn(async () => 0) }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn(), appendTaskDescription: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: vi.fn() }))
vi.mock('@/lib/data/vault', () => ({ updateVaultDescription: vi.fn() }))
vi.mock('@/lib/kairos/reactions', () => ({ reactUsed: vi.fn(async () => undefined), reactOutcome: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptInboxProposal: vi.fn(), dismissInboxMemory: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(async () => ({ ok: false })),
  createChatThread: vi.fn(),
  findOpenChatThreadByTitle: vi.fn(),
  getChatThread: vi.fn(),
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ upsertJob: vi.fn(), listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/kairos/chat-turn', () => ({ buildAssistantTurn: vi.fn(), sendChatMessage: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn-reply', () => ({ appendAssistantReplyOnce: vi.fn() }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ handleProposalCallback: vi.fn(), routeVetoReason: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/flag', () => ({ agendaEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/moment/telegram-routes', () => ({
  routeMomentCallback: vi.fn(async () => false),
  routeMomentMessage: vi.fn(async () => undefined),
  routeMomentText: vi.fn(async () => false),
}))

import { getOpenKairosAskById, listOpenKairosAsks, markKairosAskAnswered, type KairosOpenAsk } from '@/lib/data/ask'
import { findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { captureReflection } from '@/lib/data/memories'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const DOM = '99999999-9999-4999-8999-999999999999'
const OWNER_MESSAGE = 'Q11 i sent answer for Artem catchup in previous telegram chat. '
  + 'Q12 AI Triad Chat system research was research for the triad app, not for Aeon'

function openAsk(seq: number): KairosOpenAsk {
  return {
    id: `ask-${seq}`,
    title: `Question ${seq}`,
    summary: null,
    dominionId: DOM,
    createdAt: new Date('2026-10-06T05:00:00Z'),
    kairosAsk: {
      status: 'pending', seq, aetherMemoryId: 'aether-1', sourceThoughtId: null,
      sourceMemoryIds: [], dominionId: DOM, askedAt: '2026-10-06T05:00:00.000Z',
    },
    seq,
  } as KairosOpenAsk
}

function send(text: string, replyText?: string) {
  const message = {
    message_id: 50,
    text,
    chat: { id: Number(OPERATOR_CHAT) },
    ...(replyText ? { reply_to_message: { message_id: 40, text: replyText } } : {}),
  }
  const req = {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
    json: async () => ({ message }),
  } as unknown as Parameters<typeof POST>[0]
  return POST(req)
}

let fetchMock: ReturnType<typeof vi.fn>
const sentTexts = () => fetchMock.mock.calls
  .filter(([url]) => String(url).endsWith('/sendMessage'))
  .map(([, init]) => JSON.parse(init.body).text as string)
const answeredWith = () => vi.mocked(captureReflection).mock.calls.map(([, input]) => (input as { bodyMd: string }).bodyMd)
const closedAsks = () => vi.mocked(markKairosAskAnswered).mock.calls.map(([, id]) => id)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  const open = [openAsk(11), openAsk(12), openAsk(13)]
  vi.mocked(listOpenKairosAsks).mockResolvedValue(open)
  vi.mocked(getOpenKairosAskById).mockImplementation(async (_u, id) => open.find((a) => a.id === id) ?? null)
  vi.mocked(captureReflection).mockImplementation(async () => ({ ok: true, memory: { id: `reflection-${Math.random()}` } }) as never)
  vi.mocked(markKairosAskAnswered).mockResolvedValue(true as never)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue('t')
  vi.mocked(sendChatMessage).mockResolvedValue({
    ok: true, threadId: 't', userSeq: 1, assistantSeq: 2, assistantContent: 'chat reply', model: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN']) {
    delete process.env[k]
  }
})

describe('telegram webhook — answering open questions', () => {
  it("the owner's real message closes Q11 and Q12, each with its own text, and acks", async () => {
    await send(OWNER_MESSAGE)

    expect(closedAsks()).toEqual(['ask-11', 'ask-12'])
    expect(answeredWith()).toEqual([
      'i sent answer for Artem catchup in previous telegram chat.',
      'AI Triad Chat system research was research for the triad app, not for Aeon',
    ])
    expect(captureReflection).toHaveBeenCalledWith(OPERATOR_USER, expect.anything(), { origin: { kind: 'operator', via: 'ask' } })
    expect(sentTexts()).toEqual(['✓ Q11, Q12 · still open: Q13'])
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('"Q11: x" still answers by the punctuated form', async () => {
    await send('Q11: x')

    expect(closedAsks()).toEqual(['ask-11'])
    expect(answeredWith()).toEqual(['x'])
    expect(sentTexts()).toEqual(['✓ Q11 · still open: Q12, Q13'])
  })

  it('a reply to the Q12 message closes Q12 with the whole body', async () => {
    await send('It was for the triad app.', 'Q12 · 1d · What was the AI Triad Chat research for?')

    expect(closedAsks()).toEqual(['ask-12'])
    expect(answeredWith()).toEqual(['It was for the triad app.'])
    expect(sentTexts()).toEqual(['✓ Q12 · still open: Q11, Q13'])
  })

  it('a reply quoting several open questions is not a single answer (→ chat)', async () => {
    await send('all good', 'Q11 · first\nQ12 · second')

    expect(markKairosAskAnswered).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, 't', 'all good', { surface: 'telegram' })
  })

  it('"Q3 revenue" (not an open number) goes to chat, untouched', async () => {
    await send('Q3 revenue looked flat')

    expect(markKairosAskAnswered).not.toHaveBeenCalled()
    expect(sentTexts()).toEqual(['chat reply'])
  })

  it('a closed number is ignored even in the bare form', async () => {
    vi.mocked(listOpenKairosAsks).mockResolvedValue([openAsk(13)])

    await send(OWNER_MESSAGE)

    expect(markKairosAskAnswered).not.toHaveBeenCalled()
    expect(captureReflection).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })
})
