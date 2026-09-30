import { beforeEach, describe, expect, it, vi } from 'vitest'

const sweep = vi.fn()
const budget = vi.hoisted(() => ({ tryStart: () => true }))

vi.mock('@/lib/data/thinking-jobs', () => ({ listUsersNeedingSweep: vi.fn() }))
vi.mock('@/lib/kairos/thinking/queue', () => ({
  SWEEP_FALLBACK_KINDS: ['concept'],
  ThinkingQueue: vi.fn(() => ({ sweep })),
  createSweepBudget: vi.fn(() => budget),
}))
vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

import { listUsersNeedingSweep } from '@/lib/data/thinking-jobs'
import { createSweepBudget } from '@/lib/kairos/thinking/queue'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { GET, maxDuration } from '../route'

function request(authorization?: string) {
  return {
    url: 'https://aeon.test/api/cron/thinking-sweep',
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/thinking-sweep route', () => {
  it('declares the 300s function limit the sweep budget is sized for', () => {
    expect(maxDuration).toBe(300)
  })
  it('rejects without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const res = await GET(request('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(listUsersNeedingSweep).not.toHaveBeenCalled()
  })

  it('sweeps each user needing it with ONE shared budget and writes a success trace per user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listUsersNeedingSweep).mockResolvedValue(['u1', 'u2'])
    sweep
      .mockResolvedValueOnce({ expired: 2, fallbacks: [{ jobId: 'a', kind: 'concept', ok: true }], deferred: 3 })
      .mockResolvedValueOnce({ expired: 0, fallbacks: [], deferred: 1 })

    const res = await GET(request('Bearer cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ran: 2, expired: 2, fallbacksOk: 1, deferred: 4 })
    expect(listUsersNeedingSweep).toHaveBeenCalledWith(['concept'])
    expect(createSweepBudget).toHaveBeenCalledTimes(1)
    expect(sweep).toHaveBeenCalledWith('u1', expect.any(Date), budget)
    expect(sweep).toHaveBeenCalledWith('u2', expect.any(Date), budget)
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u1', expect.objectContaining({ cronName: 'thinking-sweep' }))
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('traces a per-user failure and keeps sweeping the others', async () => {
    vi.mocked(listUsersNeedingSweep).mockResolvedValue(['u1', 'u2'])
    sweep.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ expired: 1, fallbacks: [] })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.users[0]).toEqual({ userId: 'u1', error: 'db down' })
    expect(body.expired).toBe(1)
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
      cronName: 'thinking-sweep',
      reason: 'uncaught_exception',
    }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u2', expect.objectContaining({ cronName: 'thinking-sweep' }))
  })
})
