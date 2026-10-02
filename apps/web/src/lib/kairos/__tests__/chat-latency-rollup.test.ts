import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/brain-status', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/brain-status')>()
  return { ...actual, listBrainJobsSince: vi.fn() }
})
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: vi.fn() }))

import { listBrainJobsSince, type BrainJobRow } from '@/lib/data/brain-status'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { CHAT_LATENCY_RECIPE, writeChatLatencyRollup } from '../chat-latency-rollup'

const NOW = new Date('2026-10-02T04:25:00.000Z')

function chatTurn(createdIso: string, secs: number): BrainJobRow {
  const at = new Date(createdIso)
  return {
    kind: 'chat', status: 'done', claimedBy: 'routine', createdAt: at,
    claimedAt: new Date(at.getTime() + 2_000), completedAt: new Date(at.getTime() + secs * 1000),
    deadlineAt: new Date(at.getTime() + 90_000), error: null, timing: { fireOk: true },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('writeChatLatencyRollup', () => {
  it('writes a chat-routine ok trace for the previous UTC day tagged CHAT_LATENCY', async () => {
    vi.mocked(listBrainJobsSince).mockResolvedValue([
      chatTurn('2026-10-01T09:00:00Z', 30),
      chatTurn('2026-10-01T18:00:00Z', 50),
      // Today's turn is outside yesterday's window.
      chatTurn('2026-10-02T01:00:00Z', 500),
    ])

    await writeChatLatencyRollup('user-1', NOW)

    expect(listBrainJobsSince).toHaveBeenCalledWith('user-1', new Date('2026-10-01T00:00:00.000Z'))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'chat-routine',
      outcome: 'ok',
      now: NOW,
      details: expect.objectContaining({
        recipe: CHAT_LATENCY_RECIPE, day: '2026-10-01', turns: 2, routine: 2, p50Ms: 30_000, p95Ms: 50_000, maxMs: 50_000, fireFailures: 0,
      }),
    }))
    expect(CHAT_LATENCY_RECIPE).toBe('CHAT_LATENCY')
  })

  it('a day with no turns is a skipped trace (no_turns), still tagged', async () => {
    vi.mocked(listBrainJobsSince).mockResolvedValue([])
    await writeChatLatencyRollup('user-1', NOW)
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'chat-routine', outcome: 'skipped', skipReason: 'no_turns',
      details: expect.objectContaining({ recipe: 'CHAT_LATENCY', day: '2026-10-01', turns: 0 }),
    }))
  })

  it('never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(listBrainJobsSince).mockRejectedValue(new Error('db down'))
    await expect(writeChatLatencyRollup('user-1', NOW)).resolves.toBeNull()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
