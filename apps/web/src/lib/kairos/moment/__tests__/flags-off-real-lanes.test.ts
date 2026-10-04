import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 4 with the REAL lanes (no lane mocks) and every wave-4 flag unset: the
// chat prompt, the 06:00 parts, the sweep and the Telegram webhook behave as
// before, and only the allow-listed hooks are present.

const WAVE4_FLAGS = [
  'KAIROS_GATE', 'KAIROS_GATE_RECEPTIVITY', 'KAIROS_GATE_MAX_HOLD_MIN', 'KAIROS_GATE_QUIET_MIN', 'KAIROS_GATE_CHAT_QUIET_MIN', 'KAIROS_GATE_AWAY_MIN',
  'KAIROS_OWNER_MODEL', 'KAIROS_OWNER_STATE_TTL_DAYS',
  'KAIROS_READINESS', 'KAIROS_BIDS', 'KAIROS_REPAIR',
  'KAIROS_TRUST', 'KAIROS_ASK_FIRST',
  'KAIROS_LIFE_CHAPTERS', 'KAIROS_LIFE_CHAPTER_LINE',
  'KAIROS_STAGE', 'KAIROS_COLD_READ', 'DATABASE_URL',
]

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptInboxProposal: vi.fn(), dismissInboxMemory: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(), createChatThread: vi.fn(), findOpenChatThreadByTitle: vi.fn(), getChatThread: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ markKairosSpeaksReplied: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ failJob: vi.fn(), findJobById: vi.fn(), listJobs: vi.fn(), mergeJobOutput: vi.fn(), upsertJob: vi.fn() }))
vi.mock('@/lib/kairos/chat-turn', () => ({ buildAssistantTurn: vi.fn(), sendChatMessage: vi.fn() }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn(), answerNumberedKairosAsks: vi.fn() }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/kairos/proposal-telegram', () => ({ handleProposalCallback: vi.fn(), routeVetoReason: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/promises/telegram-commands', () => ({ routePromiseCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/initiative', () => ({ initiativeEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/predictions/telegram-commands', () => ({ routePredictionCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/agenda/telegram-commands', () => ({ routeAgendaCommands: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/chat-today', () => ({ recordChatOwnerTurn: vi.fn() }))

import { answerNumberedKairosAsks } from '@/lib/kairos/ask'
import { findOpenChatThreadByTitle, getChatThread } from '@/lib/data/kairos-chat'
import { markKairosSpeaksReplied } from '@/lib/data/memories'
import { sendChatMessage } from '@/lib/kairos/chat-turn'
import { buildChatMessages, type BuildChatPromptInput } from '@/lib/kairos/chat-prompt'
import { MOMENT_LANES, gatherMomentDaily, runSweepHooks, type MomentLane } from '@/lib/kairos/moment'
import { finishChatReply, loadMomentChatOptions, stripMomentFooters } from '../chat'
import { POST } from '@/app/api/telegram/webhook/route'

const OPERATOR_USER = 'operator-user-1'
const OPERATOR_CHAT = '12345'
const MONDAY = new Date('2026-10-05T05:00:00.000Z')
const saved: Record<string, string | undefined> = {}
let fetchMock: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split('/').pop(), body: JSON.parse(init.body) }))
const makeReq = (update: unknown) => ({
  headers: { get: (k: string) => (k.toLowerCase() === 'x-telegram-bot-api-secret-token' ? 'hook-secret' : null) },
  json: async () => update,
}) as unknown as Parameters<typeof POST>[0]

beforeAll(() => {
  for (const key of WAVE4_FLAGS) saved[key] = process.env[key]
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of WAVE4_FLAGS) delete process.env[key]
  Object.assign(process.env, {
    TELEGRAM_WEBHOOK_SECRET: 'hook-secret', TELEGRAM_OPERATOR_CHAT_ID: OPERATOR_CHAT, KAIROS_OPERATOR_USER_ID: OPERATOR_USER, TELEGRAM_BOT_TOKEN: 'bot-token',
  })
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(findOpenChatThreadByTitle).mockResolvedValue('thread-1')
  vi.mocked(markKairosSpeaksReplied).mockResolvedValue(0)
  vi.mocked(answerNumberedKairosAsks).mockResolvedValue({ matched: false })
  vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, assistantContent: 'hello' } as never)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  // No lane hook may have failed (a failing hook logs through console.warn).
  expect(warn.mock.calls.filter(([first]) => String(first).includes('[kairos:moment]'))).toEqual([])
  warn.mockRestore()
  vi.unstubAllGlobals()
  for (const key of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN']) delete process.env[key]
  for (const key of WAVE4_FLAGS) if (saved[key] !== undefined) process.env[key] = saved[key]
})

const presentHooks = (lane: MomentLane): string[] =>
  Object.getOwnPropertyNames(lane).filter((k) => typeof (lane as Record<string, unknown>)[k] === 'function').sort()

describe('wave 4 flags off, real lanes', () => {
  it('only the allow-listed hooks are present', () => {
    expect(Object.fromEntries(MOMENT_LANES.map(({ name, lane }) => [name, presentHooks(lane)]))).toEqual({
      rapport: [],
      'advise-trust': ['chatContext', 'daily', 'finishReply', 'stripFooter'],
      'owner-model': ['chatContext', 'daily', 'sweep', 'telegramCallback', 'telegramText'],
      gate: ['speakDelivered', 'speakPolicy', 'sweep'],
      chapters: [],
    })
  })

  it('the chat system prompt equals the baseline on web and Telegram', async () => {
    const history = [{ role: 'user' as const, content: 'earlier' }, { role: 'assistant' as const, content: 'a reply' }]
    for (const surface of ['app', 'telegram'] as const) {
      const ctx = { threadId: 't', dominionId: null, userBody: 'should I ship it?', userSeq: 3, surface, history }
      const opts = await loadMomentChatOptions('u', ctx)
      expect(opts).toEqual({})
      const base: BuildChatPromptInput = { dominion: null, history, userMessage: 'now', surface }
      const replayed = history.map((m) => ({ ...m, content: stripMomentFooters(m.content) }))
      expect(buildChatMessages({ ...base, ...opts, history: replayed })).toEqual(buildChatMessages(base))
    }
    expect(await finishChatReply('u', 't', 'Ship it.', { userSeq: 3, userBody: 'should I ship it?', channel: 'telegram', finishReason: 'stop' })).toBe('Ship it.')
    expect(getChatThread).not.toHaveBeenCalled()
  })

  it('the 06:00 message gets no moment parts and the sweep adds no keys', async () => {
    expect(await gatherMomentDaily('u', MONDAY)).toBeNull()
    expect(await runSweepHooks('u', MONDAY)).toBeNull()
  })

  it('webhook: a sticker makes no Telegram call', async () => {
    const res = await POST(makeReq({ update_id: 7, message: { message_id: 55, chat: { id: Number(OPERATOR_CHAT) }, sticker: { emoji: '😂', file_unique_id: 'f1' } } }))
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('webhook: an om1 callback answers "Unknown action"', async () => {
    await POST(makeReq({
      callback_query: { id: 'cbq-1', data: 'om1:k:1', from: { id: Number(OPERATOR_CHAT) }, message: { message_id: 42, text: 'Card', chat: { id: Number(OPERATOR_CHAT) } } },
    }))
    expect(calls()).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'cbq-1', text: 'Unknown action' } }])
  })

  it('webhook: "C1 over" goes to chat', async () => {
    await POST(makeReq({ update_id: 8, message: { text: 'C1 over', chat: { id: Number(OPERATOR_CHAT) } } }))
    expect(sendChatMessage).toHaveBeenCalledOnce()
  })
})
