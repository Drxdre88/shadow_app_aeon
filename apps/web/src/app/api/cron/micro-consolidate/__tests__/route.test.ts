import { beforeEach, describe, expect, it, vi } from 'vitest'

// db.selectDistinct is called twice per GET, in this order: usersWithDominions
// (dominions table), then credentialed (userAiCredentials table) — only when
// usersWithDominions is non-empty. Queue feeds both in call order.
const selectDistinctQueue: Array<{ userId: string }[]> = []

vi.mock('@/lib/db', () => ({
  db: {
    selectDistinct: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(selectDistinctQueue.shift() ?? []),
      }),
    })),
  },
}))

vi.mock('@/lib/kairos/micro-consolidate', () => ({
  runMicroConsolidateForUser: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { runMicroConsolidateForUser } from '@/lib/kairos/micro-consolidate'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { GET } from '../route'

function request(authorization?: string) {
  return {
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  selectDistinctQueue.length = 0
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/micro-consolidate route', () => {
  it('requires the configured bearer secret before querying eligible users', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const res = await GET(request())

    expect(res.status).toBe(401)
    expect(runMicroConsolidateForUser).not.toHaveBeenCalled()
  })

  it('short-circuits with ran:0 when no user has a live Dominion', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    selectDistinctQueue.push([]) // usersWithDominions — none

    const res = await GET(request('Bearer cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ran: 0, deltaCreated: 0, byStatus: {}, users: [] })
    expect(runMicroConsolidateForUser).not.toHaveBeenCalled()
  })

  it('only iterates users that also carry an active BYOK credential', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    selectDistinctQueue.push([{ userId: 'user-1' }, { userId: 'user-2' }]) // usersWithDominions
    selectDistinctQueue.push([{ userId: 'user-1' }]) // credentialed — user-2 excluded
    vi.mocked(runMicroConsolidateForUser).mockResolvedValue([
      { dominionId: 'd1', dominionName: 'D1', status: 'created', newMemoryCount: 5, deltaMemoryId: 'm1' },
    ])

    const res = await GET(request('Bearer cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runMicroConsolidateForUser).toHaveBeenCalledTimes(1)
    expect(runMicroConsolidateForUser).toHaveBeenCalledWith('user-1')
    expect(body).toMatchObject({ ran: 1, deltaCreated: 1, byStatus: { created: 1 } })
  })

  it('catches a thrown runMicroConsolidateForUser, traces it, and continues to the next user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    selectDistinctQueue.push([{ userId: 'user-1' }, { userId: 'user-2' }]) // usersWithDominions
    selectDistinctQueue.push([{ userId: 'user-1' }, { userId: 'user-2' }]) // credentialed
    vi.mocked(runMicroConsolidateForUser)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce([
        { dominionId: 'd2', dominionName: 'D2', status: 'skipped', reason: 'below threshold', newMemoryCount: 1 },
      ])

    const res = await GET(request('Bearer cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runMicroConsolidateForUser).toHaveBeenCalledTimes(2)
    expect(writeCronFailureTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'micro-consolidate',
      reason: 'uncaught_exception',
    }))
    expect(body).toMatchObject({ ran: 2, deltaCreated: 0, byStatus: { skipped: 1 } })
    const userResults = body.users as Array<{ userId: string; error?: string }>
    expect(userResults.find((u) => u.userId === 'user-1')?.error).toBe('provider unavailable')
  })

  it('sums totals across every Dominion result for every eligible user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    selectDistinctQueue.push([{ userId: 'user-1' }]) // usersWithDominions
    selectDistinctQueue.push([{ userId: 'user-1' }]) // credentialed
    vi.mocked(runMicroConsolidateForUser).mockResolvedValue([
      { dominionId: 'd1', dominionName: 'D1', status: 'created', newMemoryCount: 5, deltaMemoryId: 'm1' },
      { dominionId: 'd2', dominionName: 'D2', status: 'existing', newMemoryCount: 3, deltaMemoryId: 'm2' },
      { dominionId: 'd3', dominionName: 'D3', status: 'skipped', reason: 'below threshold', newMemoryCount: 1 },
    ])

    const res = await GET(request('Bearer cron-secret'))
    const body = await res.json()

    expect(body).toMatchObject({
      ran: 1,
      deltaCreated: 1,
      byStatus: { created: 1, existing: 1, skipped: 1 },
    })
  })
})
