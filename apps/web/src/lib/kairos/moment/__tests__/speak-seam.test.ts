import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// deliverKairosSpeak × the wave 4 moment seam: empty lanes keep every output
// identical; a lane policy can only block or hold.

const lanes = vi.hoisted(() => ({
  rapport: {} as Record<string, unknown>,
  gate: {} as Record<string, unknown>,
}))
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: lanes.gate }))
vi.mock('@/lib/kairos/engagement', () => ({ AWAIT_WINDOW_HOURS: 48, getConversationState: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), listRecentKairosSpeaks: vi.fn() }))
vi.mock('@/lib/kairos/telegram', () => ({ sendKairosSpeak: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { getConversationState } from '@/lib/kairos/engagement'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { sendKairosSpeak } from '@/lib/kairos/telegram'
import { recordToday } from '@/lib/kairos/today'
import { deliverKairosSpeak, fanOutSpeak, type SpeakInput } from '../../speak'

const OPERATOR = 'operator-1'
const INPUT: SpeakInput = { title: 't', message: 'm', kind: 'notify', urgency: 'normal', force: false, opsAlert: false, digest: false }

// speak.ts lazy-imports the moment seam; warm it so the first test does not pay the transform (timeout flake).
beforeAll(async () => {
  await import('@/lib/kairos/moment')
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConversationState).mockResolvedValue({ awaitingReply: false, replyRate7d: 0, lastOutbound: null, replied: false } as never)
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
  vi.mocked(sendKairosSpeak).mockResolvedValue(true)
  vi.mocked(captureMemory).mockImplementation(async (_userId, input) => ({ memory: { id: 'memory-1', ...input } as never, created: true }))
})

afterEach(() => {
  for (const lane of Object.values(lanes)) for (const key of Object.keys(lane)) delete lane[key]
})

describe('deliverKairosSpeak with empty moment lanes', () => {
  it('captures, logs and sends exactly as before', async () => {
    const outcome = await deliverKairosSpeak(OPERATOR, { ...INPUT, externalId: 'x-1' })
    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toEqual({
      kairosSpeak: true, status: 'pending', kind: 'notify', urgency: 'normal', externalId: 'x-1',
    })
    expect(recordToday).toHaveBeenCalledOnce()
    expect(sendKairosSpeak).toHaveBeenCalledOnce()
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0]).toEqual({ memoryId: 'memory-1', title: 't', message: 'm', kind: 'notify' })
    expect(Object.keys(vi.mocked(sendKairosSpeak).mock.calls[0][0])).toEqual(['memoryId', 'title', 'message', 'kind'])
    expect(getConversationState).toHaveBeenCalledOnce()
    expect(listRecentKairosSpeaks).toHaveBeenCalledTimes(2)
  })

  it('opts.gate alone changes nothing', async () => {
    const outcome = await deliverKairosSpeak(OPERATOR, { ...INPUT, force: true }, { gate: true })
    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toMatchObject({ status: 'pending' })
  })

  it('opts.telegramKeyboard reaches Telegram only', async () => {
    const keyboard = [[{ text: 'C1 still', callback_data: 'om1:k:1' }]]
    await deliverKairosSpeak(OPERATOR, INPUT, { telegramKeyboard: keyboard })
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0]).toEqual({ memoryId: 'memory-1', title: 't', message: 'm', kind: 'notify', keyboard })
    expect(JSON.stringify(vi.mocked(captureMemory).mock.calls[0][1])).not.toContain('om1')
  })
})

describe('deliverKairosSpeak with a lane policy', () => {
  it('a hold stores status held + gate, skips today and Telegram, and returns 200 held', async () => {
    lanes.gate.speakPolicy = () => ({ hold: { until: '2026-10-04T12:00:00Z', reason: 'chat_live' } })
    const outcome = await deliverKairosSpeak(OPERATOR, INPUT)
    expect(outcome).toEqual({
      status: 200,
      body: { id: 'memory-1', delivered: { inbox: false, telegram: false }, held: { until: '2026-10-04T12:00:00.000Z' } },
    })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toMatchObject({
      status: 'held', gate: { until: '2026-10-04T12:00:00.000Z', reason: 'chat_live', heldAt: expect.any(String) },
    })
    expect(recordToday).not.toHaveBeenCalled()
    expect(sendKairosSpeak).not.toHaveBeenCalled()
  })

  it('a hold never swallows Telegram-only extras: the send goes out now with them', async () => {
    lanes.gate.speakPolicy = () => ({ hold: { until: '2026-10-04T12:00:00Z', reason: 'chat_live' } })
    const keyboard = [[{ text: 'C1 still', callback_data: 'om1:k:1' }]]
    const withKeyboard = await deliverKairosSpeak(OPERATOR, INPUT, { telegramKeyboard: keyboard })
    expect(withKeyboard).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toMatchObject({ status: 'pending' })
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0]).toMatchObject({ keyboard })

    const withTail = await deliverKairosSpeak(OPERATOR, INPUT, { telegramTail: 'dream line' })
    expect(withTail.body).not.toHaveProperty('held')
    expect(vi.mocked(sendKairosSpeak).mock.calls[1][0].message).toBe('m\n\ndream line')

    const blank = await deliverKairosSpeak(OPERATOR, INPUT, { telegramTail: '  ', telegramKeyboard: [] })
    expect(blank.body).toHaveProperty('held')
  })

  it('a block returns 429 before anything is stored', async () => {
    lanes.rapport.speakPolicy = () => ({ block: { status: 429, reason: 'backing_off' } })
    const outcome = await deliverKairosSpeak(OPERATOR, INPUT)
    expect(outcome).toEqual({ status: 429, body: { error: 'moment_blocked', reason: 'backing_off' } })
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('policies never see opsAlert sends and never relax the cadence caps', async () => {
    const policy = vi.fn(() => null)
    lanes.gate.speakPolicy = policy
    await deliverKairosSpeak(OPERATOR, { ...INPUT, opsAlert: true, force: true })
    expect(policy).not.toHaveBeenCalled()

    vi.mocked(listRecentKairosSpeaks).mockResolvedValue([{ createdAt: new Date() }] as never)
    const throttled = await deliverKairosSpeak(OPERATOR, INPUT)
    expect(throttled.status).toBe(429)
    expect(throttled.body).toMatchObject({ error: 'throttled' })
    expect(policy).not.toHaveBeenCalled()
  })

  it('speakDelivered runs after a fan-out with the Telegram result', async () => {
    const delivered = vi.fn()
    lanes.gate.speakDelivered = delivered
    await deliverKairosSpeak(OPERATOR, INPUT)
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ userId: OPERATOR, memoryId: 'memory-1', telegram: true }))
  })
})

describe('fanOutSpeak (release path)', () => {
  it('writes the speak:<id> today entry and sends to Telegram', async () => {
    const telegram = await fanOutSpeak({ userId: OPERATOR, memoryId: 'held-1', title: 't', message: 'm', kind: 'notify', opsAlert: false })
    expect(telegram).toBe(true)
    expect(vi.mocked(recordToday).mock.calls[0][1]).toMatchObject({ key: 'speak:held-1', type: 'spoke' })
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0]).toEqual({ memoryId: 'held-1', title: 't', message: 'm', kind: 'notify' })
  })
})
