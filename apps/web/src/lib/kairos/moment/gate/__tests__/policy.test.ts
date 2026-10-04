import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// gateLane.speakPolicy / speakDelivered: flag off loads nothing; observe logs
// and sends; on holds until a natural break; cold_hour only with receptivity live.

const h = vi.hoisted(() => ({
  listTodayEntries: vi.fn(),
  findLatestOwnerCardClose: vi.fn(),
  readKairosGate: vi.fn(),
  appendKairosGateLog: vi.fn(),
  mutateKairosGate: vi.fn(),
}))
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

import { gateLane } from '../../lanes/gate'
import { emptyGateState, emptyReceptivity } from '../receptivity'
import type { SpeakPolicyContext } from '../../types'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const ctx = (over: Partial<SpeakPolicyContext['input']> = {}, gate = false): SpeakPolicyContext => ({
  userId: 'op',
  input: { title: 't', message: 'm', kind: 'notify', urgency: 'normal', force: false, opsAlert: false, digest: false, ...over },
  gate,
  awaitingReply: false,
  replyRate7d: 0,
  now: NOW,
})
const said = (minAgo: number) => ({ createdAt: new Date(NOW.getTime() - minAgo * 60_000), payload: { channel: 'telegram', type: 'said', speaker: 'owner' } })

beforeEach(() => {
  vi.clearAllMocks()
  h.listTodayEntries.mockResolvedValue([])
  h.findLatestOwnerCardClose.mockResolvedValue(null)
  h.readKairosGate.mockResolvedValue(emptyGateState())
  h.appendKairosGateLog.mockResolvedValue(undefined)
  h.mutateKairosGate.mockResolvedValue(null)
})

afterEach(() => {
  delete process.env.KAIROS_GATE
  delete process.env.KAIROS_GATE_RECEPTIVITY
  delete process.env.KAIROS_GATE_MAX_HOLD_MIN
})

describe('gate flag off', () => {
  it('speakPolicy and speakDelivered return without touching data', async () => {
    expect(await gateLane.speakPolicy!(ctx())).toBeNull()
    await gateLane.speakDelivered!({ userId: 'op', memoryId: 'm', input: ctx().input, telegram: true, now: NOW })
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('gate observe', () => {
  it('logs the would-be hold and sends', async () => {
    process.env.KAIROS_GATE = 'observe'
    h.listTodayEntries.mockResolvedValue([said(2)])
    expect(await gateLane.speakPolicy!(ctx())).toBeNull()
    expect(h.appendKairosGateLog).toHaveBeenCalledWith('op', [{ at: NOW.toISOString(), memoryId: null, mode: 'observe', decision: 'hold', reason: 'chat_live' }])
  })

  it('speakDelivered attaches the memory id to that decision', async () => {
    process.env.KAIROS_GATE = 'observe'
    await gateLane.speakDelivered!({ userId: 'op', memoryId: 'm-9', input: ctx().input, telegram: true, now: NOW })
    const mutate = h.mutateKairosGate.mock.calls[0][1]
    const state = { ...emptyGateState(), log: [{ at: NOW.toISOString(), memoryId: null, mode: 'observe' as const, decision: 'send' as const, reason: 'idle' }] }
    expect(mutate(state).state.log[0].memoryId).toBe('m-9')
  })
})

describe('gate on', () => {
  beforeEach(() => { process.env.KAIROS_GATE = '1' })

  it('holds during a live chat until now + max hold', async () => {
    process.env.KAIROS_GATE_MAX_HOLD_MIN = '60'
    h.listTodayEntries.mockResolvedValue([said(2)])
    expect(await gateLane.speakPolicy!(ctx())).toEqual({ hold: { until: '2026-10-04T13:00:00.000Z', reason: 'chat_live' } })
  })

  it('sends at a natural break', async () => {
    h.listTodayEntries.mockResolvedValue([said(200)])
    expect(await gateLane.speakPolicy!(ctx())).toBeNull()
    expect(h.appendKairosGateLog.mock.calls[0][1][0]).toMatchObject({ mode: 'on', decision: 'send', reason: 'idle' })
  })

  it.each([
    ['opsAlert', { opsAlert: true }, false],
    ['digest (06:00 / weekly)', { digest: true }, false],
    ['urgency high', { urgency: 'high' as const }, false],
    ['force without opts.gate', { force: true }, false],
  ])('%s is never gateable', async (_l, over, gate) => {
    h.listTodayEntries.mockResolvedValue([said(2)])
    expect(await gateLane.speakPolicy!(ctx(over, gate))).toBeNull()
    expect(h.listTodayEntries).not.toHaveBeenCalled()
  })

  it('a forced promise nudge with opts.gate is gateable', async () => {
    h.listTodayEntries.mockResolvedValue([said(2)])
    expect(await gateLane.speakPolicy!(ctx({ force: true }, true))).toMatchObject({ hold: { reason: 'chat_live' } })
  })

  it('a cold hour holds only with KAIROS_GATE_RECEPTIVITY=1', async () => {
    const receptivity = emptyReceptivity()
    receptivity.global = { n: 40, replied: 24, latSum: 0, latN: 0, warmSum: 0, warmN: 0 }
    receptivity.hour['13'] = { n: 10, replied: 0, latSum: 0, latN: 0, warmSum: 0, warmN: 0 } // 12:00Z = 13:00 BST
    h.readKairosGate.mockResolvedValue({ ...emptyGateState(), receptivity })

    expect(await gateLane.speakPolicy!(ctx())).toBeNull()
    expect(h.readKairosGate).not.toHaveBeenCalled()

    process.env.KAIROS_GATE_RECEPTIVITY = 'observe'
    expect(await gateLane.speakPolicy!(ctx())).toBeNull()
    expect(h.appendKairosGateLog.mock.calls.at(-1)![1][0]).toMatchObject({ decision: 'send', reason: 'idle', cold: true })

    process.env.KAIROS_GATE_RECEPTIVITY = '1'
    expect(await gateLane.speakPolicy!(ctx())).toMatchObject({ hold: { reason: 'cold_hour' } })
  })

  it('a failing read fails open (the seam logs and sends)', async () => {
    h.listTodayEntries.mockRejectedValue(new Error('db down'))
    await expect(gateLane.speakPolicy!(ctx())).rejects.toThrow('db down')
  })
})
