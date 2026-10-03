import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Owner command routing (promises → predictions → agenda) and the one-mind
// owner-turn write on the Telegram routine path. Split from route.test.ts,
// which is past the file-size limit.

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptInboxProposal: vi.fn(), dismissInboxMemory: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  createChatThread: vi.fn(),
  findOpenChatThreadByTitle: vi.fn(),
  getChatThread: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ markKairosSpeaksReplied: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(async () => []),
  mergeJobOutput: vi.fn(async () => true),
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
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn(), answerNumberedKairosAsks: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn-reply', () => ({ appendAssistantReplyOnce: vi.fn() }))
vi.mock('@/lib/kairos/paid-backup', () => ({
  isPaidBackupEnabled: vi.fn(async () => true),
  PAID_BACKUP_OFF_NOTE: 'paid backup off',
}))
vi.mock('@/lib/kairos/proposal-telegram', () => ({
  handleProposalCallback: vi.fn(),
  routeVetoReason: vi.fn(async () => false),
}))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/flag', () => ({ agendaEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))

import { appendChatMessage, findOpenChatThreadByTitle, getChatThread } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { upsertJob } from '@/lib/data/thinking-jobs'
import { agendaEnabled } from '@/lib/kairos/agenda/flag'
import { routeAgendaCommands } from '@/lib/kairos/agenda/telegram-commands'
import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { recordChatOwnerTurn } from '@/lib/kairos/chat-today'
import { buildAssistantTurn, sendChatMessage } from '@/lib/kairos/chat-turn'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { routePredictionCommands } from '@/lib/kairos/predictions/telegram-commands'
import { routePromiseCommands } from '@/lib/kairos/promises/telegram-commands'
import { routeVetoReason } from '@/lib/kairos/proposal-telegram'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function send(text: string) {
  const req = {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
    json: async () => ({ message: { text, chat: { id: Number(OPERATOR_CHAT) } } }),
  } as unknown as Parameters<typeof POST>[0]
  return POST(req)
}

let fetchMock: ReturnType<typeof vi.fn>
const sentTexts = () => fetchMock.mock.calls
  .filter(([url]) => String(url).endsWith('/sendMessage'))
  .map(([, init]) => JSON.parse(init.body).text as string)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue(THREAD_ID)
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
  vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: false })
  vi.mocked(initiativeEnabled).mockReturnValue(false)
  vi.mocked(agendaEnabled).mockReturnValue(false)
  vi.mocked(routePromiseCommands).mockResolvedValue(false)
  vi.mocked(routePredictionCommands).mockResolvedValue(false)
  vi.mocked(routeAgendaCommands).mockResolvedValue(false)
  vi.mocked(routeVetoReason).mockResolvedValue(false)
  vi.mocked(sendChatMessage).mockResolvedValue({
    ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Ok.', model: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN',
    'KAIROS_CHAT_ROUTINE', 'ROUTINE_CHAT_ID', 'ROUTINE_CHAT_TOKEN']) delete process.env[k]
})

describe('telegram webhook — owner command routers', () => {
  it('"R3 right" goes to the prediction router, acks through Telegram and skips chat', async () => {
    vi.mocked(routePredictionCommands).mockImplementation(async (_u, _b, reply) => { await reply('✓ R3 right'); return true })

    await send('R3 right')

    expect(routePredictionCommands).toHaveBeenCalledWith(OPERATOR_USER, 'R3 right', expect.any(Function))
    expect(sentTexts()).toEqual(['✓ R3 right'])
    expect(routeAgendaCommands).not.toHaveBeenCalled()
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('"cancel A3" goes to the agenda router when Horae is on', async () => {
    vi.mocked(agendaEnabled).mockReturnValue(true)
    vi.mocked(routeAgendaCommands).mockResolvedValue(true)

    await send('cancel A3')

    expect(routePredictionCommands).toHaveBeenCalledTimes(1)
    expect(routeAgendaCommands).toHaveBeenCalledWith(OPERATOR_USER, 'cancel A3', expect.any(Function))
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('flags off: commands fall through to chat (agenda router never consulted)', async () => {
    await send('cancel A3')
    await send('R3 right')

    expect(routeAgendaCommands).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledTimes(2)
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'R3 right', { surface: 'telegram' })
  })

  it('a router failure hands the text to chat', async () => {
    vi.mocked(routePredictionCommands).mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await send('R3 right')

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('Q-router first: a matched Q answer reaches no command router and is not logged here', async () => {
    vi.mocked(initiativeEnabled).mockReturnValue(true)
    vi.mocked(agendaEnabled).mockReturnValue(true)
    vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: true, answered: [12], skipped: [], failed: [], stillOpen: [] })
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'm', seq: 1 })

    await send('Q12: yes')

    expect(routePromiseCommands).not.toHaveBeenCalled()
    expect(routePredictionCommands).not.toHaveBeenCalled()
    expect(routeAgendaCommands).not.toHaveBeenCalled()
    expect(recordChatOwnerTurn).not.toHaveBeenCalled()
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('promise commands still come first', async () => {
    vi.mocked(initiativeEnabled).mockReturnValue(true)
    vi.mocked(agendaEnabled).mockReturnValue(true)
    vi.mocked(routePromiseCommands).mockResolvedValue(true)

    await send('P3 kept')

    expect(routePredictionCommands).not.toHaveBeenCalled()
    expect(routeAgendaCommands).not.toHaveBeenCalled()
    expect(routeVetoReason).not.toHaveBeenCalled()
  })
})

describe('telegram webhook — owner turn in today', () => {
  it('paid path: the webhook leaves recording to the chat turn (no double write)', async () => {
    await send('ship hydra friday')
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(recordChatOwnerTurn).not.toHaveBeenCalled()
  })

  it('routine path: the persisted turn is recorded once on the telegram channel', async () => {
    process.env.KAIROS_CHAT_ROUTINE = '1'
    process.env.ROUTINE_CHAT_ID = 'trig_chat'
    process.env.ROUTINE_CHAT_TOKEN = 'routine-token'
    vi.mocked(getChatThread).mockResolvedValue({
      thread: {
        id: THREAD_ID, dominionId: null, dominionName: null, title: 'Telegram · Kairos',
        status: 'running', createdAt: new Date(), lastMessageAt: null, messageCount: 0,
      },
      messages: [],
    })
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'msg-7', seq: 7 })
    vi.mocked(buildAssistantTurn).mockResolvedValue({
      ok: true,
      turn: { system: 'S', messages: [{ role: 'user', content: 'ship hydra friday' }], citationsContext: { retrieved: null }, pendingAsk: null },
    })
    vi.mocked(upsertJob).mockResolvedValue(null)

    await send('ship hydra friday')

    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(recordChatOwnerTurn).toHaveBeenCalledTimes(1)
    expect(recordChatOwnerTurn).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 7, 'ship hydra friday', 'telegram')
  })
})
