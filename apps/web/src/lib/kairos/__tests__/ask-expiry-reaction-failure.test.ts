import { beforeEach, describe, expect, it, vi } from 'vitest'

// Expired-ask sweep × real best-effort reactions (docs/kairos/34 §6): the
// status write (markKairosAskExpired) and the Outcome negative are two
// transactions by design. A reaction that fails AFTER the ask was marked
// expired must be logged and swallowed — never fail the sweep or skip the
// remaining asks.

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  listKairosReflectionStaleness: vi.fn(),
  listRecentKairosAsks: vi.fn(),
  listExpiredPendingKairosAskIds: vi.fn(),
  markKairosAskExpired: vi.fn(),
}))

vi.mock('@/lib/data/memory-reactions', () => ({
  writeOutcomeReaction: vi.fn(),
  writeUseReaction: vi.fn(),
}))

vi.mock('@/lib/kairos/rescore', () => ({
  rescoreMemories: vi.fn(async () => ({ scored: 1, opsWritten: 0 })),
}))

import { listExpiredPendingKairosAskIds, markKairosAskExpired } from '@/lib/data/ask'
import { writeOutcomeReaction } from '@/lib/data/memory-reactions'
import { rescoreMemories } from '@/lib/kairos/rescore'
import { sweepExpiredKairosAsks } from '../ask-mine'

const USER = 'user-1'
const NOW = new Date('2026-09-30T04:30:00.000Z')
const ASK_A = 'a1111111-1111-4111-8111-111111111111'
const ASK_B = 'a2222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sweepExpiredKairosAsks — reaction failure after the expiry write', () => {
  it('logs the failed reaction, keeps the ask expired, and still reacts on the next ask', async () => {
    vi.mocked(listExpiredPendingKairosAskIds).mockResolvedValue([ASK_A, ASK_B])
    vi.mocked(markKairosAskExpired).mockResolvedValue(true)
    vi.mocked(writeOutcomeReaction)
      .mockRejectedValueOnce(new Error('memory_ops insert failed'))
      .mockResolvedValueOnce(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(sweepExpiredKairosAsks(USER, NOW)).resolves.toEqual({ examined: 2, expired: 2 })

    expect(markKairosAskExpired).toHaveBeenCalledTimes(2)
    expect(writeOutcomeReaction).toHaveBeenCalledWith(USER, ASK_A, 'negative', expect.any(String))
    expect(writeOutcomeReaction).toHaveBeenCalledWith(USER, ASK_B, 'negative', expect.any(String))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![1]).toMatchObject({ memoryId: ASK_A, kind: 'negative' })
    // Only the reaction that committed is rescored.
    expect(rescoreMemories).toHaveBeenCalledTimes(1)
    expect(rescoreMemories).toHaveBeenCalledWith(USER, [ASK_B], expect.any(String))
    warn.mockRestore()
  })
})
