import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One-tap idea verdicts: a ✅ Keep / ❌ Drop tap on the 06:00 message runs the
// shared inbox triage with OWNER (operator, via telegram) origin, acks in one
// line and collapses only that idea's buttons. Other dismiss: buttons keep the
// old behaviour.

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
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'off' }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ handleProposalCallback: vi.fn(), routeVetoReason: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/decisions/telegram-commands', () => ({ routeDecisionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/flag', () => ({ agendaEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))

import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { acceptInboxProposal, dismissInboxMemory } from '@/lib/kairos/proposal-accept'
import { ideaVerdictKeyboard } from '@/lib/kairos/idea-verdict-keyboard'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const IDEA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OWNER_TELEGRAM = { kind: 'operator', via: 'telegram' }

function tap(data: string, keyboard: unknown, fromId: number = Number(OPERATOR_CHAT)) {
  const update = {
    callback_query: {
      id: 'cbq-1',
      data,
      from: { id: fromId },
      message: { message_id: 42, text: 'Vorath · brief', chat: { id: Number(OPERATOR_CHAT) }, reply_markup: { inline_keyboard: keyboard } },
    },
  }
  return POST({
    headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
    json: async () => update,
  } as unknown as Parameters<typeof POST>[0])
}

let fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split('/').pop(), body: JSON.parse(init.body) }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: true }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN']) delete process.env[k]
})

describe('idea verdict taps', () => {
  const keyboard = ideaVerdictKeyboard([{ id: IDEA_ID, title: 'Cut the PPA scope' }])

  it('❌ Drop dismisses with owner (telegram) origin, acks "✓ dropped" and collapses the row', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: true, id: IDEA_ID })
    expect((await tap(`dismiss:${IDEA_ID}`, keyboard)).status).toBe(200)
    expect(dismissInboxMemory).toHaveBeenCalledWith(OPERATOR_USER, IDEA_ID, OWNER_TELEGRAM)
    expect(acceptInboxProposal).not.toHaveBeenCalled()
    const sent = calls()
    expect(sent.find((c) => c.method === 'answerCallbackQuery')?.body).toMatchObject({ text: '✓ dropped' })
    const edit = sent.find((c) => c.method === 'editMessageReplyMarkup')
    expect(edit?.body).toMatchObject({ chat_id: Number(OPERATOR_CHAT), message_id: 42 })
    expect(edit?.body.reply_markup.inline_keyboard).toEqual([[{ text: '✓ dropped', callback_data: `dismiss:${IDEA_ID}` }]])
    expect(sent.some((c) => c.method === 'editMessageText')).toBe(false)
    expect(markKairosSpeaksReplied).toHaveBeenCalledTimes(1)
  })

  it('✅ Keep accepts with owner (telegram) origin and acks "✓ kept"', async () => {
    vi.mocked(acceptInboxProposal).mockResolvedValue({ ok: true, id: IDEA_ID })
    await tap(`accept:${IDEA_ID}`, keyboard)
    expect(acceptInboxProposal).toHaveBeenCalledWith(OPERATOR_USER, IDEA_ID, OWNER_TELEGRAM)
    expect(calls().find((c) => c.method === 'answerCallbackQuery')?.body).toMatchObject({ text: '✓ kept' })
  })

  it('a repeat tap reports "Already handled" and leaves the buttons alone', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: false, reason: 'already_resolved' })
    await tap(`dismiss:${IDEA_ID}`, keyboard)
    expect(calls().find((c) => c.method === 'answerCallbackQuery')?.body).toMatchObject({ text: 'Already handled' })
    expect(calls().some((c) => c.method === 'editMessageReplyMarkup')).toBe(false)
  })

  it('only the owner may decide: another member of the chat is refused', async () => {
    await tap(`dismiss:${IDEA_ID}`, keyboard, 777)
    expect(dismissInboxMemory).not.toHaveBeenCalled()
    expect(calls().find((c) => c.method === 'answerCallbackQuery')?.body).toMatchObject({ text: 'Not allowed' })
  })

  it('a plain speak Dismiss keeps the old inbox path (no origin, text edit)', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: true, id: IDEA_ID })
    await tap(`dismiss:${IDEA_ID}`, [[{ text: 'Dismiss', callback_data: `dismiss:${IDEA_ID}` }]])
    expect(dismissInboxMemory).toHaveBeenCalledWith(OPERATOR_USER, IDEA_ID)
    expect(calls().some((c) => c.method === 'editMessageText')).toBe(true)
  })
})
