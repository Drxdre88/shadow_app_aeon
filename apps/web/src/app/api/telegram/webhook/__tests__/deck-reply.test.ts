import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Sunday verdict deck reply ("1y 2n 3 skip") in the operator chat: routed
// first, before the Q / R / D / P / A routers and chat, but only for text that
// is nothing but bare numbered verdicts aimed at the stored deck.

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
vi.mock('@/lib/data/thinking-jobs', () => ({ failJob: vi.fn(), findJobById: vi.fn(), listJobs: vi.fn(async () => []), mergeJobOutput: vi.fn(), upsertJob: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn', () => ({ buildAssistantTurn: vi.fn(), sendChatMessage: vi.fn() }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn(), answerNumberedKairosAsks: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn-reply', () => ({ appendAssistantReplyOnce: vi.fn() }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'off' }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ handleProposalCallback: vi.fn(), routeVetoReason: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/decisions/telegram-commands', () => ({ routeDecisionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/flag', () => ({ agendaEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))
vi.mock('@/lib/data/kairos-verdict-deck', () => ({ readVerdictDeck: vi.fn() }))
vi.mock('@/lib/kairos/verdict-deck/apply', () => ({ applyDeckTokens: vi.fn() }))

import { findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { readVerdictDeck } from '@/lib/data/kairos-verdict-deck'
import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { routePredictionCommands } from '@/lib/kairos/predictions/telegram-commands'
import { londonDate } from '@/lib/kairos/daily-message-time'
import { applyDeckTokens } from '@/lib/kairos/verdict-deck/apply'
import type { VerdictDeck } from '@/lib/kairos/verdict-deck/types'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const deck = (date: string): VerdictDeck => ({
  v: 1, date, messageIds: [777],
  items: [{ n: 1, kind: 'idea', id: 'idea-1', label: null, title: 'Idea' }, { n: 2, kind: 'ask', id: 'ask-1', label: 'Q4', title: 'Ship?' }],
})

function send(text: string, replyTo?: number) {
  const message = {
    message_id: 900, text, chat: { id: Number(OPERATOR_CHAT) }, from: { id: Number(OPERATOR_CHAT) },
    ...(replyTo ? { reply_to_message: { message_id: replyTo, text: 'Vorath · deck\n\n1. 💡 Idea\n2. Q4 · Ship?\n\nReply e.g. "1y 2n 3 skip"' } } : {}),
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
  vi.mocked(readVerdictDeck).mockResolvedValue(deck(londonDate(new Date())))
  vi.mocked(applyDeckTokens).mockResolvedValue([
    { n: 1, status: 'done', word: 'kept' }, { n: 2, status: 'done', word: 'set aside' }, { n: 3, status: 'unknown' },
  ])
  vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, threadId: THREAD_ID, userSeq: 1, assistantSeq: 2, assistantContent: 'Ok.', model: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN']) delete process.env[k]
})

describe('telegram webhook — Sunday verdict deck replies', () => {
  it('a reply to the deck is applied, acked in one line, and never reaches the Q router or chat', async () => {
    await send('1y 2n 3 yes', 777)
    expect(applyDeckTokens).toHaveBeenCalledWith(OPERATOR_USER, deck(londonDate(new Date())).items, [
      { n: 1, verdict: 'yes' }, { n: 2, verdict: 'no' }, { n: 3, verdict: 'yes' },
    ], expect.any(Date))
    expect(sentTexts()).toEqual(['✓ 1 kept · ✓ 2 set aside · 3 unknown'])
    expect(answerNumberedKairosAsks).not.toHaveBeenCalled()
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('R / Q commands on the deck day keep their own routers', async () => {
    await send('R3 right')
    await send('Q4: yes', 777)
    expect(readVerdictDeck).not.toHaveBeenCalled()
    expect(routePredictionCommands).toHaveBeenCalledTimes(2)
    expect(answerNumberedKairosAsks).toHaveBeenCalledTimes(2)
  })

  it('non-deck numeric chat goes to chat', async () => {
    await send('3')
    await send('2 more days, then ship')
    expect(applyDeckTokens).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledTimes(2)
  })

  it('bare verdicts on another day (no reply) go to chat', async () => {
    vi.mocked(readVerdictDeck).mockResolvedValue(deck('2000-01-02'))
    await send('1y 2n')
    expect(applyDeckTokens).not.toHaveBeenCalled()
    expect(sendChatMessage).toHaveBeenCalledWith(OPERATOR_USER, THREAD_ID, '1y 2n', { surface: 'telegram' })
  })
})
