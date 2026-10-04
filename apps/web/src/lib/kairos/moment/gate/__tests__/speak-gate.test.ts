import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// deliverKairosSpeak × the real gate lane. Flag unset: outcome, stored
// metadata and Telegram call byte-identical, no gate data touched. Flag on:
// a live chat holds the speak end to end.

const h = vi.hoisted(() => ({
  listTodayEntries: vi.fn(),
  findLatestOwnerCardClose: vi.fn(),
  readKairosGate: vi.fn(),
  appendKairosGateLog: vi.fn(),
  mutateKairosGate: vi.fn(),
}))
vi.mock('@/lib/kairos/engagement', () => ({ AWAIT_WINDOW_HOURS: 48, getConversationState: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), listRecentKairosSpeaks: vi.fn() }))
vi.mock('@/lib/kairos/telegram', () => ({ sendKairosSpeak: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/kairos-today', () => ({
  listTodayEntries: h.listTodayEntries,
  toKairosTodayView: (row: { createdAt: Date; payload: Record<string, unknown> }) => ({ at: row.createdAt.toISOString(), relayed: false, ...row.payload }),
}))
vi.mock('@/lib/data/kairos-gate', () => ({
  findLatestOwnerCardClose: h.findLatestOwnerCardClose,
  readKairosGate: h.readKairosGate,
  appendKairosGateLog: h.appendKairosGateLog,
  mutateKairosGate: h.mutateKairosGate,
}))

import { getConversationState } from '@/lib/kairos/engagement'
import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { sendKairosSpeak } from '@/lib/kairos/telegram'
import { recordToday } from '@/lib/kairos/today'
import { deliverKairosSpeak, type SpeakInput } from '@/lib/kairos/speak'

const INPUT: SpeakInput = { title: 't', message: 'm', kind: 'question', urgency: 'normal', force: false, opsAlert: false, digest: false }

// speak.ts lazy-imports the moment seam; warm it so the first test does not pay the transform (timeout flake).
beforeAll(async () => {
  await import('@/lib/kairos/moment')
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConversationState).mockResolvedValue({ awaitingReply: false, replyRate7d: 0, lastOutbound: null, replied: false } as never)
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
  vi.mocked(sendKairosSpeak).mockResolvedValue(true)
  vi.mocked(captureMemory).mockImplementation(async (_u, input) => ({ memory: { id: 'memory-1', ...input } as never, created: true }))
  h.listTodayEntries.mockResolvedValue([{ createdAt: new Date(Date.now() - 60_000), payload: { channel: 'telegram', type: 'said', speaker: 'owner' } }])
  h.findLatestOwnerCardClose.mockResolvedValue(null)
  h.appendKairosGateLog.mockResolvedValue(undefined)
  h.mutateKairosGate.mockResolvedValue(null)
})

afterEach(() => { delete process.env.KAIROS_GATE })

// The first deliverKairosSpeak lazily loads every moment lane; allow for a cold import under load.
vi.setConfig({ testTimeout: 20_000 })

describe('KAIROS_GATE unset', () => {
  it.each([
    ['plain notify', INPUT, {}, 2],
    ['forced promise nudge with opts.gate', { ...INPUT, kind: 'notify' as const, force: true, externalId: 'kairos-promise-nudge:p' },     { gate: true }, 1],
      ])('%s: identical outcome, metadata and Telegram call', async (_l, input, opts, cadenceReads) => {
    const outcome = await deliverKairosSpeak('op', input, opts)
    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toEqual({
      kairosSpeak: true, status: 'pending', kind: input.kind, urgency: 'normal', ...(input.externalId ? { externalId: input.externalId } : {}),
    })
    expect(vi.mocked(sendKairosSpeak).mock.calls[0][0]).toEqual({ memoryId: 'memory-1', title: 't', message: 'm', kind: input.kind })
    expect(recordToday).toHaveBeenCalledOnce()
    expect(getConversationState).toHaveBeenCalledOnce()
    expect(listRecentKairosSpeaks).toHaveBeenCalledTimes(cadenceReads)
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('KAIROS_GATE=1', () => {
  it('a live chat holds the speak: held row, no today entry, no Telegram', async () => {
    process.env.KAIROS_GATE = '1'
    const outcome = await deliverKairosSpeak('op', INPUT)
    expect(outcome).toMatchObject({ status: 200, body: { delivered: { inbox: false, telegram: false }, held: { until: expect.any(String) } } })
    expect(vi.mocked(captureMemory).mock.calls[0][1].sourceMetadata).toMatchObject({ status: 'held', gate: { reason: 'chat_live' } })
    expect(sendKairosSpeak).not.toHaveBeenCalled()
    expect(recordToday).not.toHaveBeenCalled()
  })

  it('the 06:00 digest is never held', async () => {
    process.env.KAIROS_GATE = '1'
    const outcome = await deliverKairosSpeak('op', { ...INPUT, kind: 'notify', force: true, digest: true })
    expect(outcome).toEqual({ status: 200, body: { id: 'memory-1', delivered: { inbox: true, telegram: true } } })
  })
})
