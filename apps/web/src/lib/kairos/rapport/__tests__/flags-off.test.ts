import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Every rapport flag unset → the lane exposes no hook, imports no data
// module, and every surface (capture, chat prompt, speak, 06:00, Telegram)
// stays byte-identical.

const probe = vi.hoisted(() => ({ dataImported: false }))
vi.mock('@/lib/data/kairos-rapport', () => {
  probe.dataImported = true
  return {}
})
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/owner-model', () => ({ ownerModelLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/advise-trust', () => ({ adviseTrustLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/chapters', () => ({ chaptersLane: {} }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined), recordTodayAfter: vi.fn(), loadTodayDigest: vi.fn() }))
vi.mock('@/lib/kairos/today-render', () => ({ renderTodaySection: vi.fn() }))
vi.mock('@/lib/kairos/surprise/owner-correction', () => ({ scheduleChatCorrectionCheck: vi.fn() }))
vi.mock('@/lib/kairos/stage', () => ({ loadStageBlock: vi.fn(async () => ({ block: '' })) }))
vi.mock('@/lib/kairos/cold-read/flag', () => ({ coldReadEnabled: vi.fn(() => false) }))
vi.mock('@/lib/kairos/engagement', () => ({ AWAIT_WINDOW_HOURS: 48, getConversationState: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), listRecentKairosSpeaks: vi.fn(), markKairosSpeaksReplied: vi.fn() }))
vi.mock('@/lib/kairos/telegram', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/kairos/telegram')>()), sendKairosSpeak: vi.fn() }))

import { after } from 'next/server'
import { captureMemory, listRecentKairosSpeaks, markKairosSpeaksReplied } from '@/lib/data/memories'
import { getConversationState } from '@/lib/kairos/engagement'
import { sendKairosSpeak } from '@/lib/kairos/telegram'
import { buildChatMessages, type BuildChatPromptInput } from '@/lib/kairos/chat-prompt'
import { recordChatOwnerTurn, recordChatReply } from '@/lib/kairos/chat-today'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import { gatherMomentDaily, hasMomentHook } from '@/lib/kairos/moment'
import { loadMomentChatOptions } from '@/lib/kairos/moment/chat'
import { routeMomentMessage } from '@/lib/kairos/moment/telegram-routes'
import { rapportLane } from '@/lib/kairos/moment/lanes/rapport'
import { rapportChatContext } from '../chat-context'
import { onChatReply, onOwnerTurn } from '../owner-turn'
import { rapportDaily, rapportDailyDelivered, rapportOwnerDecision, rapportSpeakPolicy } from '../speak-policy'
import { ackMediaBid } from '../telegram-bid'

const ENV = ['KAIROS_READINESS', 'KAIROS_BIDS', 'KAIROS_REPAIR'] as const
const HOOKS = ['ownerTurn', 'reply', 'chatContext', 'speakPolicy', 'daily', 'dailyDelivered', 'ownerDecision', 'telegramMessage', 'telegramText', 'telegramCallback', 'sweep', 'speakDelivered', 'finishReply', 'stripFooter'] as const
const NOW = new Date('2026-10-04T08:00:00.000Z')
const CHAT = '12345'

let fetchMock: ReturnType<typeof vi.fn>

// speak.ts lazy-imports the moment seam; warm it so the first test does not pay the transform (timeout flake).
beforeAll(async () => {
  await import('@/lib/kairos/moment')
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV) delete process.env[k]
  process.env.KAIROS_READINESS = '0'
  probe.dataImported = false
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  process.env.KAIROS_OPERATOR_USER_ID = 'u'
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: true }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(getConversationState).mockResolvedValue({ awaitingReply: false, replyRate7d: 0, lastOutbound: null, replied: false } as never)
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
  vi.mocked(sendKairosSpeak).mockResolvedValue(true)
  vi.mocked(captureMemory).mockImplementation(async (_u, input) => ({ memory: { id: 'm1', ...input } as never, created: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV) delete process.env[k]
  delete process.env.TELEGRAM_BOT_TOKEN
})

describe('rapport with every flag off', () => {
  it('the lane exposes no hook at all', () => {
    for (const hook of HOOKS) {
      expect(rapportLane[hook], hook).toBeUndefined()
      expect(hasMomentHook(hook), hook).toBe(false)
    }
  })

  it('flags appear only when set', () => {
    process.env.KAIROS_BIDS = '1'
    expect(typeof rapportLane.telegramMessage).toBe('function')
    expect(rapportLane.speakPolicy).toBeUndefined()
    process.env.KAIROS_REPAIR = 'observe'
    expect(typeof rapportLane.speakPolicy).toBe('function')
    expect(rapportLane.daily).toBeUndefined()
  })

  it('capture: nothing detached, no data import', async () => {
    recordChatOwnerTurn('u', 't', 3, 'not now', 'telegram')
    await recordChatReply('u', 't', 4, 'ok', 'telegram')
    expect(after).not.toHaveBeenCalled()
    await onOwnerTurn({ userId: 'u', threadId: 't', seq: 3, body: "I'll do it, haha, not now", channel: 'web', at: NOW })
    await onChatReply({ userId: 'u', threadId: 't', seq: 4, content: 'x', channel: 'web', at: NOW })
    expect(probe.dataImported).toBe(false)
  })

  it('chat prompt is byte-identical to the baseline (web and Telegram)', async () => {
    for (const surface of ['app', 'telegram'] as const) {
      for (const body of ['not now', 'hahaha', "I'll sign up for the marathon", 'ugh']) {
        const ctx = { threadId: 't', dominionId: null, userBody: body, userSeq: 3, surface, history: [] }
        const opts = await loadMomentChatOptions('u', ctx)
        expect(opts).toEqual({})
        expect(await rapportChatContext({ userId: 'u', ...ctx })).toBeNull()
        const base: BuildChatPromptInput = { dominion: null, history: [], userMessage: body, surface, conscienceSection: 'C' }
        expect(buildChatMessages({ ...base, ...opts })[0].content).toBe(buildChatMessages(base)[0].content)
      }
    }
    expect(probe.dataImported).toBe(false)
  })

  it('speak is unaffected', async () => {
    const out = await deliverKairosSpeak('u', { title: 't', message: 'm', kind: 'notify', urgency: 'normal', force: false, opsAlert: false, digest: false })
    expect(out).toEqual({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
    const ctx = { userId: 'u', input: { title: 't', message: 'm', kind: 'notify' as const, urgency: 'normal' as const, force: false, opsAlert: false, digest: false }, gate: false, awaitingReply: false, replyRate7d: 0, now: NOW }
    expect(await rapportSpeakPolicy(ctx)).toBeNull()
    await rapportOwnerDecision({ userId: 'u', memoryId: 'm', verdict: 'dismiss', kairosSpeak: true, kind: null })
    expect(await rapportDaily('u', NOW)).toBeNull()
    await rapportDailyDelivered({ userId: 'u', date: 'd', memoryId: 'm', telegram: true, moment: { openings: ['x'] }, now: NOW })
    expect(await gatherMomentDaily('u', NOW)).toBeNull()
    expect(probe.dataImported).toBe(false)
  })

  it('a sticker makes zero Telegram calls', async () => {
    const message = { message_id: 55, chat: { id: Number(CHAT) }, sticker: { emoji: '😂' } }
    expect(await routeMomentMessage(message, CHAT, 'u', 7)).toBe(false)
    expect(await ackMediaBid({ userId: 'u', chatId: CHAT, message, updateId: 7, now: NOW })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markKairosSpeaksReplied).not.toHaveBeenCalled()
    expect(probe.dataImported).toBe(false)
  })

  it('positive control: the probe sees a data import once a flag is on', async () => {
    process.env.KAIROS_REPAIR = '1'
    await rapportDaily('u', NOW).catch(() => null)
    expect(probe.dataImported).toBe(true)
  })
})
