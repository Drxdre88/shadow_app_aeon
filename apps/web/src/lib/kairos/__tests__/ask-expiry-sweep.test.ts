import { beforeEach, describe, expect, it, vi } from 'vitest'

// Expired asks (docs/kairos/34 §6): the ask-mine cron persists 'expired' on
// pending asks past expiresAt and logs an Outcome negative — once per ask.

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  listKairosReflectionStaleness: vi.fn(),
  listRecentKairosAsks: vi.fn(),
  listExpiredPendingKairosAskIds: vi.fn(),
  markKairosAskExpired: vi.fn(),
}))

vi.mock('@/lib/kairos/reactions', () => ({
  reactOutcome: vi.fn(async () => undefined),
}))

import { listExpiredPendingKairosAskIds, markKairosAskExpired } from '@/lib/data/ask'
import { reactOutcome } from '@/lib/kairos/reactions'
import { sweepExpiredKairosAsks } from '../ask-mine'

const USER = 'user-1'
const NOW = new Date('2026-09-30T04:30:00.000Z')
const ASK_A = 'a1111111-1111-4111-8111-111111111111'
const ASK_B = 'a2222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sweepExpiredKairosAsks', () => {
  it('marks each expired pending ask expired and logs one negative outcome on it', async () => {
    vi.mocked(listExpiredPendingKairosAskIds).mockResolvedValue([ASK_A, ASK_B])
    vi.mocked(markKairosAskExpired).mockResolvedValue(true)

    await expect(sweepExpiredKairosAsks(USER, NOW)).resolves.toEqual({ examined: 2, expired: 2 })

    expect(listExpiredPendingKairosAskIds).toHaveBeenCalledWith(USER, NOW)
    expect(markKairosAskExpired).toHaveBeenCalledWith(USER, ASK_A, NOW)
    expect(markKairosAskExpired).toHaveBeenCalledWith(USER, ASK_B, NOW)
    expect(reactOutcome).toHaveBeenCalledTimes(2)
    expect(reactOutcome).toHaveBeenCalledWith(USER, ASK_A, 'negative', expect.any(String))
    expect(reactOutcome).toHaveBeenCalledWith(USER, ASK_B, 'negative', expect.any(String))
  })

  it('is idempotent: an ask that lost the guarded claim (already expired or answered) is not re-scored', async () => {
    vi.mocked(listExpiredPendingKairosAskIds).mockResolvedValue([ASK_A, ASK_B])
    vi.mocked(markKairosAskExpired).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(sweepExpiredKairosAsks(USER, NOW)).resolves.toEqual({ examined: 2, expired: 1 })
    expect(reactOutcome).toHaveBeenCalledTimes(1)
    expect(reactOutcome).toHaveBeenCalledWith(USER, ASK_B, 'negative', expect.any(String))

    // Second run: the persisted status means nothing is listed any more.
    vi.mocked(reactOutcome).mockClear()
    vi.mocked(listExpiredPendingKairosAskIds).mockResolvedValue([])
    await expect(sweepExpiredKairosAsks(USER, NOW)).resolves.toEqual({ examined: 0, expired: 0 })
    expect(reactOutcome).not.toHaveBeenCalled()
  })
})
