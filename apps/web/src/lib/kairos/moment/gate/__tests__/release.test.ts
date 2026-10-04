import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Held-speak release: deadline / break release, single-flight claim, ≤2 per
// call while on, flag off flushes everything; sweep + event hooks.

const h = vi.hoisted(() => ({
  listHeldSpeaks: vi.fn(),
  claimHeldSpeak: vi.fn(),
  appendKairosGateLog: vi.fn(),
  readKairosGate: vi.fn(),
  mutateKairosGate: vi.fn(),
  listSpeaksForFold: vi.fn(),
  findLatestOwnerCardClose: vi.fn(),
  listTodayEntries: vi.fn(),
  fanOutSpeak: vi.fn(),
  after: vi.fn(),
}))
vi.mock('@/lib/data/kairos-gate', () => ({
  listHeldSpeaks: h.listHeldSpeaks,
  claimHeldSpeak: h.claimHeldSpeak,
  appendKairosGateLog: h.appendKairosGateLog,
  readKairosGate: h.readKairosGate,
  mutateKairosGate: h.mutateKairosGate,
  listSpeaksForFold: h.listSpeaksForFold,
  findLatestOwnerCardClose: h.findLatestOwnerCardClose,
}))
vi.mock('@/lib/data/kairos-today', () => ({
  listTodayEntries: h.listTodayEntries,
  toKairosTodayView: (row: { createdAt: Date; payload: Record<string, unknown> }) => ({ at: row.createdAt.toISOString(), relayed: false, ...row.payload }),
}))
vi.mock('@/lib/kairos/speak', () => ({ fanOutSpeak: h.fanOutSpeak }))
vi.mock('@/lib/kairos/engagement', () => ({ repliedWithinCredit: () => false }))
vi.mock('next/server', () => ({ after: h.after }))

import { releaseHeldSpeaks } from '../release'
import { runGateSweep } from '../sweep'
import { noteKairosBreak } from '../note'
import { emptyGateState } from '../receptivity'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const iso = (minFromNow: number) => new Date(NOW.getTime() + minFromNow * 60_000).toISOString()
const heldRow = (id: string, untilMin: number, kind = 'notify') => ({
  id, title: `T ${id}`, bodyMd: `body ${id}`, createdAt: new Date(NOW.getTime() - 30 * 60_000),
  sourceMetadata: { kairosSpeak: true, status: 'held', kind, gate: { heldAt: iso(-30), until: iso(untilMin), reason: 'busy' } },
})
const chatting = [{ createdAt: new Date(NOW.getTime() - 2 * 60_000), payload: { channel: 'web', type: 'said', speaker: 'owner' } }]

beforeEach(() => {
  vi.clearAllMocks()
  h.claimHeldSpeak.mockImplementation(async (_u: string, id: string) => ({ ...heldRow(id, 60), sourceMetadata: { ...heldRow(id, 60).sourceMetadata, status: 'pending' } }))
  h.fanOutSpeak.mockResolvedValue(true)
  h.listTodayEntries.mockResolvedValue([])
  h.findLatestOwnerCardClose.mockResolvedValue(null)
  h.readKairosGate.mockResolvedValue(emptyGateState())
  h.mutateKairosGate.mockResolvedValue(null)
  h.listSpeaksForFold.mockResolvedValue([])
  process.env.KAIROS_OPERATOR_USER_ID = 'op'
})

afterEach(() => {
  delete process.env.KAIROS_GATE
  delete process.env.KAIROS_OPERATOR_USER_ID
})

describe('releaseHeldSpeaks (gate on)', () => {
  beforeEach(() => { process.env.KAIROS_GATE = '1' })

  it('nothing held → null', async () => {
    h.listHeldSpeaks.mockResolvedValue([])
    expect(await releaseHeldSpeaks('op', NOW, 'tick')).toBeNull()
  })

  it('a row past its deadline goes out even mid-chat; others wait', async () => {
    h.listTodayEntries.mockResolvedValue(chatting)
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', -1), heldRow('b', 60)])
    const out = await releaseHeldSpeaks('op', NOW, 'tick')
    expect(out).toEqual({ trigger: 'tick', released: [{ id: 'a', reason: 'deadline', telegram: true }], remaining: 1 })
    expect(h.claimHeldSpeak).toHaveBeenCalledWith('op', 'a', NOW, 'deadline')
    expect(h.fanOutSpeak).toHaveBeenCalledWith({ userId: 'op', memoryId: 'a', title: 'T a', message: 'body a', kind: 'notify', opsAlert: false })
    expect(h.appendKairosGateLog).toHaveBeenCalledWith('op', [{ at: NOW.toISOString(), memoryId: 'a', mode: 'on', decision: 'release', reason: 'deadline' }])
  })

  it('releases at a natural break, oldest first, at most 2 per call, signals read once', async () => {
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', 60), heldRow('b', 60, 'question'), heldRow('c', 60)])
    const out = await releaseHeldSpeaks('op', NOW, 'tick')
    expect(out?.released.map((r) => [r.id, r.reason])).toEqual([['a', 'idle'], ['b', 'idle']])
    expect(out?.remaining).toBe(1)
    expect(h.listTodayEntries).toHaveBeenCalledOnce()
  })

  it('a card-close trigger is itself the break', async () => {
    h.listTodayEntries.mockResolvedValue([{ createdAt: new Date(NOW.getTime() - 3 * 60_000), payload: { channel: 'inbox', type: 'decided', speaker: 'owner' } }])
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', 60)])
    expect((await releaseHeldSpeaks('op', NOW, 'card_closed'))?.released[0]?.reason).toBe('card_closed')
  })

  it('a lost claim never sends', async () => {
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', -1)])
    h.claimHeldSpeak.mockResolvedValue(null)
    expect((await releaseHeldSpeaks('op', NOW, 'tick'))?.released).toEqual([])
    expect(h.fanOutSpeak).not.toHaveBeenCalled()
  })

  it('a Telegram failure leaves the claimed row pending in the inbox', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', -1)])
    h.fanOutSpeak.mockResolvedValue(false)
    expect((await releaseHeldSpeaks('op', NOW, 'tick'))?.released).toEqual([{ id: 'a', reason: 'deadline', telegram: false }])
    expect(h.claimHeldSpeak).toHaveBeenCalledOnce()
  })
})

describe('flag off', () => {
  it('flushes every held row so nothing is stranded', async () => {
    h.listHeldSpeaks.mockResolvedValue(['a', 'b', 'c', 'd'].map((id) => heldRow(id, 60)))
    const out = await releaseHeldSpeaks('op', NOW, 'tick')
    expect(out?.released.map((r) => r.reason)).toEqual(['flush', 'flush', 'flush', 'flush'])
    expect(h.listTodayEntries).not.toHaveBeenCalled()
  })

  it('sweep with nothing held adds no key and never folds', async () => {
    h.listHeldSpeaks.mockResolvedValue([])
    expect(await runGateSweep('op', NOW)).toBeNull()
    expect(h.readKairosGate).not.toHaveBeenCalled()
  })

  it('a failing flush only logs (no key)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.listHeldSpeaks.mockRejectedValue(new Error('db down'))
    expect(await runGateSweep('op', NOW)).toBeNull()
  })

  it('noteKairosBreak does nothing', () => {
    noteKairosBreak('op', 'card_closed')
    expect(h.after).not.toHaveBeenCalled()
    expect(h.listHeldSpeaks).not.toHaveBeenCalled()
  })
})

describe('sweep + event hooks (gate on)', () => {
  beforeEach(() => { process.env.KAIROS_GATE = '1' })

  it('sweep releases then folds', async () => {
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', -1)])
    h.mutateKairosGate.mockImplementation(async (_u: string, fn: (s: unknown) => { result: unknown }) => fn(emptyGateState()).result)
    const out = await runGateSweep('op', NOW)
    expect(out).toEqual({
      gate: {
        release: { trigger: 'tick', released: [{ id: 'a', reason: 'deadline', telegram: true }], remaining: 0 },
        fold: { folded: 0, through: '2026-10-03T12:00:00.000Z' },
      },
    })
  })

  it('noteKairosBreak releases for the operator only, detached via after()', async () => {
    h.listHeldSpeaks.mockResolvedValue([heldRow('a', 60)])
    noteKairosBreak('someone-else', 'session_ended')
    expect(h.after).not.toHaveBeenCalled()
    noteKairosBreak('op', 'session_ended')
    expect(h.after).toHaveBeenCalledOnce()
    await h.after.mock.calls[0][0]()
    expect(h.fanOutSpeak).toHaveBeenCalledOnce()
    expect(h.claimHeldSpeak.mock.calls[0][3]).toBe('session_ended')
  })

  it('a failing break release logs and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.listHeldSpeaks.mockRejectedValue(new Error('db down'))
    expect(() => noteKairosBreak('op', 'card_closed')).not.toThrow()
    await h.after.mock.calls[0][0]()
    expect(warn).toHaveBeenCalledWith('[kairos:gate] break release failed', 'db down')
    warn.mockRestore()
  })
})
