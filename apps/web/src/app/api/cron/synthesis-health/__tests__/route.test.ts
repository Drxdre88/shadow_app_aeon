import { beforeEach, describe, expect, it, vi } from 'vitest'

const distinctQueue: Array<Array<{ userId: string }>> = []

vi.mock('@/lib/db', () => {
  function makeDistinctChain(queue: Array<Array<{ userId: string }>>) {
    const rows = queue.shift() ?? []
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      selectDistinct: vi.fn(() => makeDistinctChain(distinctQueue)),
    },
  }
})

vi.mock('@/lib/db/schema', () => {
  const tableProxy = (name: string) => new Proxy({}, { get: (_t, prop) => `${name}.${String(prop)}` })
  return { dominions: tableProxy('dominions') }
})

vi.mock('drizzle-orm', () => ({
  isNull: (col: unknown) => ({ kind: 'isNull', col }),
}))

vi.mock('@/lib/kairos/synthesis-health', () => ({
  computeSynthesisHealth: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { GET } from '../route'
import { computeSynthesisHealth } from '@/lib/kairos/synthesis-health'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

function request(authHeader?: string) {
  const headers = new Map<string, string>()
  if (authHeader) headers.set('authorization', authHeader)
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  distinctQueue.length = 0
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/synthesis-health route', () => {
  it('rejects with 401 when the bearer secret is configured and missing', async () => {
    process.env.CRON_SECRET = 'secret'
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(computeSynthesisHealth).not.toHaveBeenCalled()
  })

  it('returns { ran: 0, users: [] } when no user has an active Dominion', async () => {
    distinctQueue.push([])
    const res = await GET(request())
    const body = await res.json()
    expect(body).toEqual({ ran: 0, alertsSent: 0, users: [] })
  })

  it('runs the rollup once per user and totals newly-alerted stages', async () => {
    distinctQueue.push([{ userId: 'user-1' }, { userId: 'user-2' }])
    vi.mocked(computeSynthesisHealth)
      .mockResolvedValueOnce({
        date: '2026-07-22', byStage: {}, alertedStages: ['cortex-regen'],
        newlyAlertedStages: ['cortex-regen'], memoryId: 'm1', created: true,
      })
      .mockResolvedValueOnce({
        date: '2026-07-22', byStage: {}, alertedStages: [],
        newlyAlertedStages: [], memoryId: 'm2', created: true,
      })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ran).toBe(2)
    expect(body.alertsSent).toBe(1)
    expect(body.users).toHaveLength(2)
    expect(body.users[0]).toMatchObject({ userId: 'user-1' })
  })

  it('isolates a per-user failure, traces it, and continues to the next user', async () => {
    distinctQueue.push([{ userId: 'user-1' }, { userId: 'user-2' }])
    vi.mocked(computeSynthesisHealth)
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce({
        date: '2026-07-22', byStage: {}, alertedStages: [],
        newlyAlertedStages: [], memoryId: 'm2', created: true,
      })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ran).toBe(2)
    expect(body.users[0].error).toBe('db unavailable')
    expect(writeCronFailureTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'synthesis-health',
      reason: 'uncaught_exception',
    }))
  })

  it('is idempotent across repeated calls the same day (delegated to computeSynthesisHealth)', async () => {
    distinctQueue.push([{ userId: 'user-1' }])
    vi.mocked(computeSynthesisHealth).mockResolvedValue({
      date: '2026-07-22', byStage: {}, alertedStages: [],
      newlyAlertedStages: [], memoryId: 'm1', created: false,
    })

    const res = await GET(request())
    const body = await res.json()

    expect(body.users[0].result.created).toBe(false)
  })
})
