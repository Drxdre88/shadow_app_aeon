import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Telegram webhook × the real owner-model lane: with KAIROS_OWNER_MODEL off an
// om1 tap still answers "Unknown action" and "C1 over" still goes to chat; on,
// both are handled by the lane.

const h = vi.hoisted(() => ({ model: null as unknown }))
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/advise-trust', () => ({ adviseTrustLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/chapters', () => ({ chaptersLane: {} }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptInboxProposal: vi.fn(), dismissInboxMemory: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(), createChatThread: vi.fn(), findOpenChatThreadByTitle: vi.fn(), getChatThread: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ markKairosSpeaksReplied: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/memory-candidates', () => ({}))
vi.mock('@/lib/data/thinking-jobs', () => ({ failJob: vi.fn(), findJobById: vi.fn(), listJobs: vi.fn(), mergeJobOutput: vi.fn(), upsertJob: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn', () => ({ buildAssistantTurn: vi.fn(), sendChatMessage: vi.fn() }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn(), answerNumberedKairosAsks: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn-reply', () => ({ appendAssistantReplyOnce: vi.fn() }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ handleProposalCallback: vi.fn(), routeVetoReason: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn() }))
vi.mock('@/lib/data/kairos-owner-model', () => ({
  readKairosOwnerModel: vi.fn(async () => h.model),
  mutateKairosOwnerModel: vi.fn(async (_u: string, mutate: (m: unknown) => { state: unknown; result: unknown }) => {
    const { state, result } = mutate(h.model)
    if (state) h.model = state
    return result
  }),
}))

import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { emptyOwnerModel } from '@/lib/kairos/owner-model/status'
import { POST } from '@/app/api/telegram/webhook/route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'

function makeReq(update: unknown) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
    json: async () => update,
  } as unknown as Parameters<typeof POST>[0]
}

const callback = (data: string) => ({
  callback_query: { id: 'cbq-1', data, from: { id: Number(OPERATOR_CHAT) }, message: { message_id: 42, text: 'Card', chat: { id: Number(OPERATOR_CHAT) } } },
})
let nextUpdate = 100
const text = (body: string) => ({ update_id: nextUpdate++, message: { message_id: 3, text: body, chat: { id: Number(OPERATOR_CHAT) } } })

let fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split('/').pop(), body: JSON.parse(init.body) }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  h.model = {
    ...emptyOwnerModel(),
    nextSeq: 2,
    items: [{
      id: 'i1', seq: 1, kind: 'state', text: 'stressed about the launch', domain: 'general', status: 'held',
      firstSeenAt: new Date(Date.now() - 86_400_000).toISOString(), lastConfirmedAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), supportDays: [], confirmations: [],
    }],
  }
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue('thread-1')
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
  vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: false })
  vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, assistantContent: 'hello' } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN', 'KAIROS_OWNER_MODEL']) delete process.env[k]
})

describe('webhook with KAIROS_OWNER_MODEL off', () => {
  it('an om1 tap answers "Unknown action" exactly as before', async () => {
    await POST(makeReq(callback('om1:k:1')))
    expect(calls()).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'cbq-1', text: 'Unknown action' } }])
    expect(markKairosSpeaksReplied).toHaveBeenCalledOnce()
  })

  it('"C1 over" goes to chat', async () => {
    await POST(makeReq(text('C1 over')))
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })
})

describe('webhook with KAIROS_OWNER_MODEL=1', () => {
  beforeEach(() => { process.env.KAIROS_OWNER_MODEL = '1' })

  it('an om1 tap is answered by the lane and the card edited', async () => {
    await POST(makeReq(callback('om1:x:1')))
    const methods = calls().map((c) => c.method)
    expect(methods).toEqual(['answerCallbackQuery', 'editMessageText'])
    expect(calls()[0]!.body).toEqual({ callback_query_id: 'cbq-1', text: 'C1 over ✓' })
  })

  it('"C1 over" is a command (acked), not chat; ordinary text still goes to chat', async () => {
    await POST(makeReq(text('C1 over')))
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(calls()).toEqual([{ method: 'sendMessage', body: { chat_id: Number(OPERATOR_CHAT), text: 'C1 over ✓' } }])
    await POST(makeReq(text('how was your day?')))
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })
})
