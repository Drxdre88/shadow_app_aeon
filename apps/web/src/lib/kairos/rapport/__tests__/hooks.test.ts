import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosRapport } from '@/lib/data/validators/kairos-rapport'

// Lane C hooks through the moment seam with an in-memory rapport store.

const store = vi.hoisted(() => ({ state: null as KairosRapport | null, objectives: [] as Array<{ id: string; title: string }>, ignored: [] as string[] }))

vi.mock('@/lib/data/kairos-rapport', async () => {
  const { emptyRapport, pruneRapport } = await import('../state')
  const current = (now: Date) => pruneRapport(store.state ?? emptyRapport(now), now)
  return {
    readKairosRapport: vi.fn(async (_u: string, now: Date = new Date()) => current(now)),
    mutateKairosRapport: vi.fn(async (_u: string, fn: (s: KairosRapport) => { state: KairosRapport | null; result: unknown }, now: Date = new Date()) => {
      const { state, result } = fn(current(now))
      if (state) store.state = pruneRapport(state, now)
      return result
    }),
    listObjectiveRefs: vi.fn(async () => store.objectives),
    listIgnoredKairosSpeakIds: vi.fn(async () => store.ignored),
  }
})
vi.mock('@/lib/data/memories', () => ({ markKairosSpeaksReplied: vi.fn(async () => 0), captureMemory: vi.fn(), listRecentKairosSpeaks: vi.fn() }))
vi.mock('@/lib/kairos/engagement', () => ({ AWAIT_WINDOW_HOURS: 48, getConversationState: vi.fn() }))
vi.mock('@/lib/kairos/telegram', () => ({ sendKairosSpeak: vi.fn(), sendMessage: vi.fn() }))
vi.mock('@/lib/kairos/telegram-api', () => ({ callTelegram: vi.fn(), setMessageReaction: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/owner-model', () => ({ ownerModelLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/advise-trust', () => ({ adviseTrustLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/chapters', () => ({ chaptersLane: {} }))

import { listObjectiveRefs, mutateKairosRapport } from '@/lib/data/kairos-rapport'
import { captureMemory, listRecentKairosSpeaks, markKairosSpeaksReplied } from '@/lib/data/memories'
import { getConversationState } from '@/lib/kairos/engagement'
import { sendKairosSpeak, sendMessage } from '@/lib/kairos/telegram'
import { setMessageReaction } from '@/lib/kairos/telegram-api'
import { deliverKairosSpeak, type SpeakInput } from '@/lib/kairos/speak'
import { gatherMomentDaily, runDailyDelivered, runOwnerDecisionHooks, runOwnerTurnHooks, runReplyHooks, runChatContext } from '@/lib/kairos/moment'
import { routeMomentMessage } from '@/lib/kairos/moment/telegram-routes'
import { emptyRapport } from '../state'
import { recordNotNow } from '../repair'
import { BID_STYLE, NOT_NOW_STYLE, REPAIR_STYLE } from '../chat-context'
import { resetBidDedupe } from '../telegram-bid'

const U = 'operator-1'
const CHAT = '12345'
const NOW = new Date('2026-10-04T08:00:00.000Z')
const ENV = ['KAIROS_READINESS', 'KAIROS_BIDS', 'KAIROS_REPAIR'] as const
const INPUT: SpeakInput = { title: 't', message: 'm', kind: 'notify', urgency: 'normal', force: false, opsAlert: false, digest: false }
const ctx = (body: string, seq = 3) => ({ userId: U, threadId: 't1', dominionId: null, userBody: body, userSeq: seq, surface: 'telegram' as const, history: [] })
const turn = (body: string, seq = 3) => ({ userId: U, threadId: 't1', seq, body, channel: 'telegram' as const, at: NOW })

function setFlags(v: string) {
  for (const k of ENV) process.env[k] = v
}

// speak.ts lazy-imports the moment seam; warm it so the first test does not pay the transform (timeout flake).
beforeAll(async () => {
  await import('@/lib/kairos/moment')
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  store.state = null
  store.objectives = [{ id: 'o1', title: 'Run a marathon' }]
  store.ignored = []
  resetBidDedupe()
  setFlags('1')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(getConversationState).mockResolvedValue({ awaitingReply: false, replyRate7d: 0, lastOutbound: null, replied: false } as never)
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
  vi.mocked(sendKairosSpeak).mockResolvedValue(true)
  vi.mocked(captureMemory).mockImplementation(async (_u, input) => ({ memory: { id: 'm1', ...input } as never, created: true }))
})

afterEach(() => {
  for (const k of ENV) delete process.env[k]
  vi.restoreAllMocks()
})

const backingOff = () => {
  store.state = { ...emptyRapport(NOW), rupture: recordNotNow(emptyRapport(NOW).rupture, 'not now', new Date(NOW.getTime() - 3_600_000)) }
}

describe('owner turn capture', () => {
  it('stores a not-now, a bid and a readiness tip; objectives are read only for change talk', async () => {
    await runOwnerTurnHooks(turn('ugh'))
    expect(listObjectiveRefs).not.toHaveBeenCalled()
    expect(store.state?.bids).toEqual([{ at: NOW.toISOString(), kind: 'sigh', ref: 'chat:t1:3' }])
    await runOwnerTurnHooks(turn("I'll sign up for the marathon", 4))
    expect(listObjectiveRefs).toHaveBeenCalledOnce()
    expect(store.state?.goals.o1).toMatchObject({ band: 'committed', lastTip: { kind: 'commit', ref: 'chat:t1:4' } })
    await runOwnerTurnHooks(turn('not now', 5))
    expect(store.state?.rupture).toMatchObject({ state: 'backing_off', reason: 'not_now' })
  })
})

describe('chat context precedence', () => {
  it('"not now" → one short line, brief, claims the turn (no read needed)', async () => {
    expect(await runChatContext(ctx('not now'))).toEqual({ momentStyleLines: [NOT_NOW_STYLE], briefReply: true })
    expect(mutateKairosRapport).not.toHaveBeenCalled()
  })

  it('backing off → repair wording claims the turn', async () => {
    backingOff()
    const out = await runChatContext(ctx('so what about the plan'))
    expect(out.momentStyleLines).toEqual([REPAIR_STYLE])
    expect(out.momentSections?.[0]).toMatch(/^Rapport: you have been backing off since .* “not now”/)
    expect(out.briefReply).toBeUndefined()
  })

  it('a small bid → brief acknowledgement', async () => {
    expect(await runChatContext(ctx('hahaha'))).toEqual({ momentStyleLines: [BID_STYLE('laugh')], briefReply: true })
  })

  it('a commitment tip → offer one step; a pull-back → reflect', async () => {
    const commit = await runChatContext(ctx("I'll sign up for the marathon"))
    expect(commit.momentSections?.[0]).toContain('moved from wanting to committing')
    expect(commit.momentStyleLines?.[0]).toMatch(/Offer exactly ONE small, optional next step for “Run a marathon”/)
    expect(commit.briefReply).toBeUndefined()
    expect(await runChatContext(ctx('what is the plan for the marathon?'))).toEqual({})
  })

  it('observe mode never touches the prompt', async () => {
    setFlags('observe')
    backingOff()
    for (const body of ['not now', 'hahaha', "I'll sign up for the marathon"]) expect(await runChatContext(ctx(body))).toEqual({})
  })
})

describe('reply + decisions + daily', () => {
  it('a reply while a repair is owed marks it repaired', async () => {
    backingOff()
    store.state = { ...store.state!, rupture: { ...store.state!.rupture, state: 'repair_owed' } }
    await runReplyHooks({ userId: U, threadId: 't1', seq: 4, content: 'sorry', channel: 'telegram', at: NOW })
    expect(store.state?.rupture).toMatchObject({ state: 'repaired', via: 'chat' })
  })

  it('a dismissed Kairos speak is a soft signal; accepts and non-speaks are not', async () => {
    await runOwnerDecisionHooks({ userId: U, memoryId: 'a', verdict: 'accept', kairosSpeak: true, kind: null })
    await runOwnerDecisionHooks({ userId: U, memoryId: 'b', verdict: 'dismiss', kairosSpeak: false, kind: null })
    expect(mutateKairosRapport).not.toHaveBeenCalled()
    await runOwnerDecisionHooks({ userId: U, memoryId: 'c', verdict: 'dismiss', kairosSpeak: true, kind: null })
    await runOwnerDecisionHooks({ userId: U, memoryId: 'd', verdict: 'dismiss', kairosSpeak: true, kind: null })
    expect(store.state?.rupture).toMatchObject({ state: 'backing_off', reason: 'dismissed' })
  })

  it('06:00 leads with the repair line when owed and marks it repaired once delivered', async () => {
    expect(await gatherMomentDaily(U, NOW)).toBeNull()
    backingOff()
    const later = new Date(NOW.getTime() + 30 * 3_600_000)
    const moment = await gatherMomentDaily(U, later)
    expect(moment?.openings).toHaveLength(1)
    expect(moment?.openings?.[0]).toMatch(/“not now”.*on me.*\?$/)
    await runDailyDelivered({ userId: U, date: '2026-10-05', memoryId: 'm9', telegram: true, moment, now: later })
    expect(store.state?.rupture).toMatchObject({ state: 'repaired', via: 'daily' })
  })
})

describe('speak policy', () => {
  it('backing off blocks a normal unprompted speak with 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      backingOff()
      const out = await deliverKairosSpeak(U, INPUT)
      expect(out).toEqual({ status: 429, body: { error: 'moment_blocked', reason: 'rapport_backing_off:not_now' } })
      expect(captureMemory).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('forced and high-urgency sends pass; the forced ceiling still applies', async () => {
    backingOff()
    expect((await deliverKairosSpeak(U, { ...INPUT, force: true })).status).toBe(200)
    expect((await deliverKairosSpeak(U, { ...INPUT, urgency: 'high' })).status).toBe(200)
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, title: 't', createdAt: new Date() })))
    expect(await deliverKairosSpeak(U, { ...INPUT, force: true })).toMatchObject({ status: 429, body: { error: 'throttled' } })
  })

  it('observe never blocks', async () => {
    setFlags('observe')
    backingOff()
    expect((await deliverKairosSpeak(U, INPUT)).status).toBe(200)
  })

  it('two ignored speaks become one soft signal; a second fresh set backs off', async () => {
    store.ignored = ['x1', 'x0']
    expect((await deliverKairosSpeak(U, INPUT)).status).toBe(200)
    expect(store.state?.rupture.soft).toHaveLength(1)
    store.ignored = ['x2', 'x1', 'x0']
    expect(await deliverKairosSpeak(U, INPUT)).toMatchObject({ status: 429 })
  })
})

describe('Telegram media bids', () => {
  const sticker = (updateId: number, messageId = 55, extra: Record<string, unknown> = {}) => ({ message_id: messageId, chat: { id: Number(CHAT) }, sticker: { emoji: '😂' }, ...extra })

  it('reacts exactly once per update and marks pending speaks replied', async () => {
    expect(await routeMomentMessage(sticker(7), CHAT, U, 7)).toBe(true)
    expect(await routeMomentMessage(sticker(7), CHAT, U, 7)).toBe(true)
    expect(setMessageReaction).toHaveBeenCalledOnce()
    expect(setMessageReaction).toHaveBeenCalledWith(Number(CHAT), 55, '🤣')
    expect(markKairosSpeaksReplied).toHaveBeenCalledOnce()
    expect(store.state?.bids).toEqual([{ at: expect.any(String), kind: 'media', ref: `tg:${CHAT}:55` }])
  })

  it('a reaction failure logs only — no text fallback', async () => {
    vi.mocked(setMessageReaction).mockRejectedValueOnce(new Error('REACTION_INVALID'))
    expect(await routeMomentMessage({ message_id: 56, chat: { id: Number(CHAT) }, photo: [{ file_unique_id: 'p' }] }, CHAT, U, 8)).toBe(true)
    expect(setMessageReaction).toHaveBeenCalledWith(Number(CHAT), 56, '👀')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('captioned photos, observe mode and other chats are left alone', async () => {
    expect(await routeMomentMessage({ message_id: 57, chat: { id: Number(CHAT) }, photo: [{}], caption: 'look' }, CHAT, U, 9)).toBe(false)
    expect(await routeMomentMessage(sticker(10, 58, { chat: { id: 999 } }), CHAT, U, 10)).toBe(false)
    setFlags('observe')
    expect(await routeMomentMessage(sticker(11, 59), CHAT, U, 11)).toBe(false)
    expect(setMessageReaction).not.toHaveBeenCalled()
  })
})
