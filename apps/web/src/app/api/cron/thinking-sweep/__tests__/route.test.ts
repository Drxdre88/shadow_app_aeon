import { beforeEach, describe, expect, it, vi } from 'vitest'

const sweep = vi.fn()
const planDue = vi.fn()
const budget = vi.hoisted(() => ({ tryStart: () => true }))

vi.mock('@/lib/data/thinking-jobs', () => ({ listUsersNeedingSweep: vi.fn() }))
vi.mock('@/lib/data/memory-engine', () => ({ listMemoryEngineUserIds: vi.fn() }))
vi.mock('@/lib/kairos/thinking/queue', () => ({
  SWEEP_FALLBACK_KINDS: ['concept'],
  SWEEP_PLAN_SKIP_KINDS: ['concept', 'chat'],
  ThinkingQueue: vi.fn(() => ({ sweep, planDue })),
  createSweepBudget: vi.fn(() => budget),
}))
vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

import { listUsersNeedingSweep } from '@/lib/data/thinking-jobs'
import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
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
  vi.mocked(listMemoryEngineUserIds).mockResolvedValue([])
  planDue.mockResolvedValue({ planned: [], errors: [] })
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

  it('plans due jobs for every active-Dominion user (skipping concept/chat) BEFORE sweeping', async () => {
    const order: string[] = []
    vi.mocked(listMemoryEngineUserIds).mockResolvedValue(['u1', 'u2'])
    planDue.mockImplementation(async (userId: string) => {
      order.push(`plan:${userId}`)
      return userId === 'u1'
        ? { planned: [{ kind: 'weekly_review' }, { kind: 'mind_compare' }], errors: [] }
        : { planned: [], errors: [{ kind: 'daily_message', error: 'briefs read failed' }] }
    })
    vi.mocked(listUsersNeedingSweep).mockImplementation(async () => { order.push('list-sweep'); return ['u1'] })
    sweep.mockImplementation(async (userId: string) => { order.push(`sweep:${userId}`); return { expired: 0, fallbacks: [], deferred: 0 } })

    const res = await GET(request())
    const body = await res.json()

    expect(order).toEqual(['plan:u1', 'plan:u2', 'list-sweep', 'sweep:u1'])
    expect(planDue).toHaveBeenCalledWith('u1', expect.any(Date), { skipKinds: ['concept', 'chat'] })
    expect(body.planned).toBe(2)
    expect(body.plans).toEqual([
      { userId: 'u1', planned: 2 },
      { userId: 'u2', planned: 0, errors: ['daily_message: briefs read failed'] },
    ])
  })

  it('a planning failure (user listing or one user) never blocks the sweep', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listMemoryEngineUserIds).mockRejectedValueOnce(new Error('db blip'))
    vi.mocked(listUsersNeedingSweep).mockResolvedValue(['u1'])
    sweep.mockResolvedValue({ expired: 1, fallbacks: [], deferred: 0 })
    let body = await (await GET(request())).json()
    expect(body).toMatchObject({ planned: 0, ran: 1, expired: 1 })

    vi.mocked(listMemoryEngineUserIds).mockResolvedValue(['u1'])
    planDue.mockRejectedValueOnce(new Error('boom'))
    body = await (await GET(request())).json()
    expect(body.plans).toEqual([{ userId: 'u1', planned: 0, errors: ['boom'] }])
    expect(body.ran).toBe(1)
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
