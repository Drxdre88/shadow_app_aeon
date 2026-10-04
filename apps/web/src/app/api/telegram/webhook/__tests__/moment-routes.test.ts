import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Telegram webhook × moment seam: with empty lanes non-text updates are still
// ignored and unknown callbacks still answer "Unknown action"; lane routers
// slot in before chat / before dismiss-accept parsing.

const lanes = vi.hoisted(() => ({ rapport: {} as Record<string, unknown>, ownerModel: {} as Record<string, unknown> }))
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('@/lib/kairos/moment/lanes/owner-model', () => ({ ownerModelLane: lanes.ownerModel }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptInboxProposal: vi.fn(), dismissInboxMemory: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(), createChatThread: vi.fn(), findOpenChatThreadByTitle: vi.fn(), getChatThread: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ markKairosSpeaksReplied: vi.fn() }))
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

import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { findOpenChatThreadByTitle } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { setMessageReaction } from '@/lib/kairos/moment/telegram-routes'
import { POST } from '../route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'

function makeReq(update: unknown) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
    json: async () => update,
  } as unknown as Parameters<typeof POST>[0]
}

const sticker = (chatId: number | string = Number(OPERATOR_CHAT)) => ({
  update_id: 7, message: { message_id: 55, chat: { id: chatId }, sticker: { emoji: '😂', file_unique_id: 'f1' } },
})
const callback = (data: string) => ({
  callback_query: { id: 'cbq-1', data, from: { id: Number(OPERATOR_CHAT) }, message: { message_id: 42, text: 'Card', chat: { id: Number(OPERATOR_CHAT) } } },
})

let fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split('/').pop(), body: JSON.parse(init.body) }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR_USER
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue('thread-1')
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
  vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: false })
  vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, assistantContent: 'hello' } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const lane of Object.values(lanes)) for (const key of Object.keys(lane)) delete lane[key]
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
  delete process.env.KAIROS_OPERATOR_USER_ID
  delete process.env.TELEGRAM_BOT_TOKEN
})

describe('webhook with empty moment lanes', () => {
  it('a sticker is ignored: no Telegram call, no reply marker', async () => {
    const res = await POST(makeReq(sticker()))
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markKairosSpeaksReplied).not.toHaveBeenCalled()
  })

  it('an unknown callback still answers "Unknown action" and marks speaks replied once', async () => {
    await POST(makeReq(callback('om1:k:1')))
    expect(calls()).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'cbq-1', text: 'Unknown action' } }])
    expect(markKairosSpeaksReplied).toHaveBeenCalledOnce()
  })

  it('plain text still goes to chat', async () => {
    await POST(makeReq({ update_id: 8, message: { text: 'C1 over', chat: { id: Number(OPERATOR_CHAT) } } }))
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })
})

describe('webhook with lane routers', () => {
  it('a lane callback route claims its data before dismiss/accept parsing', async () => {
    const route = vi.fn(async () => true)
    lanes.ownerModel.telegramCallback = route
    await POST(makeReq(callback('om1:k:1')))
    expect(route).toHaveBeenCalledWith(expect.objectContaining({
      userId: OPERATOR_USER, callbackId: 'cbq-1', data: 'om1:k:1', fromId: OPERATOR_CHAT, chatId: Number(OPERATOR_CHAT), messageId: 42, originalText: 'Card',
    }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markKairosSpeaksReplied).not.toHaveBeenCalled()
  })

  it('a lane text router runs before chat and can reply', async () => {
    lanes.ownerModel.telegramText = vi.fn(async (ctx: { body: string; send: (t: string) => Promise<unknown> }) => {
      await ctx.send(`noted: ${ctx.body}`)
      return true
    })
    await POST(makeReq({ update_id: 9, message: { text: 'C1 over', chat: { id: Number(OPERATOR_CHAT) } } }))
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(calls()).toEqual([{ method: 'sendMessage', body: { chat_id: Number(OPERATOR_CHAT), text: 'noted: C1 over' } }])
  })

  it('a throwing text router hands the text to chat', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lanes.rapport.telegramText = () => { throw new Error('boom') }
    await POST(makeReq({ update_id: 10, message: { text: 'hello', chat: { id: Number(OPERATOR_CHAT) } } }))
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })

  it('non-text messages reach the lane only from the operator chat', async () => {
    const onMessage = vi.fn(async () => true)
    lanes.rapport.telegramMessage = onMessage
    await POST(makeReq(sticker('999')))
    expect(onMessage).not.toHaveBeenCalled()
    await POST(makeReq(sticker()))
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ userId: OPERATOR_USER, updateId: 7, message: expect.objectContaining({ message_id: 55 }) }))
  })
})

describe('setMessageReaction', () => {
  it('sends one emoji reaction', async () => {
    await setMessageReaction(OPERATOR_CHAT, 55, '❤')
    expect(calls()).toEqual([{ method: 'setMessageReaction', body: { chat_id: OPERATOR_CHAT, message_id: 55, reaction: [{ type: 'emoji', emoji: '❤' }] } }])
  })
})
