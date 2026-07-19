import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { execute: vi.fn() },
}))

vi.mock('@/lib/kairos/engagement', () => ({
  getConversationState: vi.fn(),
}))

import { db } from '@/lib/db'
import { getConversationState } from '@/lib/kairos/engagement'
import { getAskLoopStats } from '../initiative-metrics'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-07-20T00:00:00.000Z')

const execute = db.execute as ReturnType<typeof vi.fn>

function row(overrides: Partial<{
  id: string
  status: string
  asked_at: Date
  answered_at: Date | null
  expires_at: Date | null
  applied: boolean
}> = {}) {
  return {
    id: 'ask-1',
    status: 'pending',
    asked_at: new Date('2026-07-19T00:00:00.000Z'),
    answered_at: null,
    expires_at: null,
    applied: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  execute.mockResolvedValue({ rows: [] })
  vi.mocked(getConversationState).mockResolvedValue({
    lastOutbound: null,
    replied: false,
    awaitingReply: false,
    replyRate7d: 0.6,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getAskLoopStats', () => {
  it('counts answered, applied, uncited, and expired ask fixtures', async () => {
    execute.mockResolvedValue({
      rows: [
        row({
          id: 'answered-cited',
          status: 'answered',
          asked_at: new Date('2026-07-19T00:00:00.000Z'),
          answered_at: new Date('2026-07-19T02:00:00.000Z'),
          applied: true,
        }),
        row({
          id: 'answered-never-cited',
          status: 'answered',
          asked_at: new Date('2026-07-18T00:00:00.000Z'),
          answered_at: new Date('2026-07-18T04:00:00.000Z'),
          applied: false,
        }),
        row({
          id: 'expired',
          status: 'expired',
          asked_at: new Date('2026-07-17T00:00:00.000Z'),
        }),
      ],
    })

    await expect(getAskLoopStats(USER_ID)).resolves.toEqual({
      dispatched: 3,
      answered: 2,
      expired: 1,
      medianHoursToAnswer: 3,
      appliedRate: 0.5,
      replyRate7d: 0.6,
    })
  })

  it('includes both window edges and defensively excludes rows outside them', async () => {
    execute.mockResolvedValue({
      rows: [
        row({ id: 'at-cutoff', asked_at: new Date('2026-06-20T00:00:00.000Z') }),
        row({ id: 'before-cutoff', asked_at: new Date('2026-06-19T23:59:59.999Z') }),
        row({ id: 'at-now', asked_at: NOW }),
        row({ id: 'after-now', asked_at: new Date('2026-07-20T00:00:00.001Z') }),
      ],
    })

    const stats = await getAskLoopStats(USER_ID, { days: 30 })

    expect(stats.dispatched).toBe(2)
  })

  it('derives pending expiry, empty medians, and the exact containment query shape', async () => {
    execute.mockResolvedValue({
      rows: [row({
        id: 'pending-expired',
        expires_at: new Date('2026-07-19T23:59:59.000Z'),
      })],
    })

    const stats = await getAskLoopStats(USER_ID)
    const query = execute.mock.calls[0][0] as { queryChunks: Array<{ value?: unknown }> }
    const queryText = query.queryChunks.flatMap((chunk) => (
      Array.isArray(chunk.value)
        ? chunk.value.filter((value): value is string => typeof value === 'string')
        : []
    )).join(' ')

    expect(stats).toMatchObject({ expired: 1, answered: 0, medianHoursToAnswer: null, appliedRate: 0 })
    expect(queryText).toContain('synthesis.created_at > answer.created_at')
    expect(queryText).toContain('synthesis.source_metadata @> jsonb_build_object')
    expect(queryText).toContain("'cortex'")
    expect(queryText).toContain("'aether'")
    expect(queryText).toContain("'sourceMemoryIds'")
    expect(getConversationState).toHaveBeenCalledWith(USER_ID)
  })
})
