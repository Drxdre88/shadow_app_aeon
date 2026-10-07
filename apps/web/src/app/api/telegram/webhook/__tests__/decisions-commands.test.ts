import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The decision journal's settle commands ("D3 right" / "void D3") in the
// operator chat: routed after the prediction router, before chat.

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
vi.mock('@/lib/kairos/decisions/telegram-commands', () => ({ routeDecisionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/flag', () => ({ agendaEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))

import { findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { routeDecisionCommands } from '@/lib/kairos/decisions/telegram-commands'
import { routePredictionCommands } from '@/lib/kairos/predictions/telegram-commands'
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
  vi.mocked(routePredictionCommands).mockResolvedValue(false)
  vi.mocked(routeDecisionCommands).mockResolvedValue(false)
  vi.mocked(sendChatMessage).mockResolvedValue({
    ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Ok.', model: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN']) delete process.env[k]
})

describe('telegram webhook — decision settle commands', () => {
  it('"D3 right" settles through the decision router, acks and skips chat', async () => {
    vi.mocked(routeDecisionCommands).mockImplementation(async (_u, _b, reply) => { await reply('✓ D3 right'); return true })

    await send('D3 right')

    expect(routePredictionCommands).toHaveBeenCalledTimes(1)
    expect(routeDecisionCommands).toHaveBeenCalledWith(OPERATOR_USER, 'D3 right', expect.any(Function))
    expect(sentTexts()).toEqual(['✓ D3 right'])
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('a handled prediction command never reaches the decision router', async () => {
    vi.mocked(routePredictionCommands).mockResolvedValue(true)

    await send('R3 right')

    expect(routeDecisionCommands).not.toHaveBeenCalled()
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('plain text passes through to chat', async () => {
    await send('ship hydra friday')

    expect(routeDecisionCommands).toHaveBeenCalledTimes(1)
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, 'ship hydra friday', { surface: 'telegram' })
  })

  it('a decision router failure hands the text to chat', async () => {
    vi.mocked(routeDecisionCommands).mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await send('D3 right')

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
