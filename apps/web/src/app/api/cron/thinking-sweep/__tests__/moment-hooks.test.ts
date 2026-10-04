import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// thinking-sweep × moment seam: empty lanes add no keys; a lane's sweep result
// is spread in, operator only, before the promise nudge, never over core keys.

const lanes = vi.hoisted(() => ({ gate: {} as Record<string, unknown> }))
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: lanes.gate }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listUsersNeedingSweep: vi.fn() }))
vi.mock('@/lib/data/memory-engine', () => ({ listMemoryEngineUserIds: vi.fn() }))
vi.mock('@/lib/kairos/thinking/queue', () => ({
  SWEEP_FALLBACK_KINDS: ['concept'],
  SWEEP_PLAN_SKIP_KINDS: ['concept', 'chat'],
  ThinkingQueue: vi.fn(() => ({ sweep: vi.fn(), planDue: vi.fn(async () => ({ planned: [], errors: [] })) })),
  createSweepBudget: vi.fn(() => ({ tryStart: () => true })),
}))
vi.mock('@/lib/kairos/promises/nudge', () => ({ PROMISE_NUDGE_CRON: 'promise-nudge', runPromiseNudges: vi.fn() }))
vi.mock('@/lib/kairos/proposal-decision', () => ({ sweepExpiredProposals: vi.fn() }))
vi.mock('@/lib/kairos/predictions/check', () => ({ PREDICTION_CHECK_CRON: 'prediction-check', runPredictionSettlement: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))

import { listUsersNeedingSweep } from '@/lib/data/thinking-jobs'
import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
import { runPromiseNudges } from '@/lib/kairos/promises/nudge'
import { sweepExpiredProposals } from '@/lib/kairos/proposal-decision'
import { GET } from '../route'

const request = () => ({ url: 'https://aeon.test/api/cron/thinking-sweep', headers: { get: () => null } }) as unknown as Parameters<typeof GET>[0]
const CORE_KEYS = ['planned', 'plans', 'ran', 'expired', 'fallbacksOk', 'deferred', 'users', 'promiseNudge', 'proposalExpiry']

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  process.env.KAIROS_OPERATOR_USER_ID = 'op'
  vi.mocked(listMemoryEngineUserIds).mockResolvedValue([])
  vi.mocked(listUsersNeedingSweep).mockResolvedValue([])
  vi.mocked(runPromiseNudges).mockResolvedValue({ status: 'skipped' } as never)
  vi.mocked(sweepExpiredProposals).mockResolvedValue({ expired: 0 } as never)
})

afterEach(() => {
  delete process.env.KAIROS_OPERATOR_USER_ID
  for (const key of Object.keys(lanes.gate)) delete lanes.gate[key]
})

describe('thinking-sweep moment hooks', () => {
  it('empty lanes: the JSON has exactly the core keys', async () => {
    const body = await (await GET(request())).json()
    expect(Object.keys(body)).toEqual(CORE_KEYS)
  })

  it('a lane result is added before the promise nudge; core keys win', async () => {
    const order: string[] = []
    lanes.gate.sweep = vi.fn(async (userId: string) => { order.push(`gate:${userId}`); return { gate: { released: 1 }, planned: 99 } })
    vi.mocked(runPromiseNudges).mockImplementation(async () => { order.push('nudge'); return { status: 'skipped' } as never })
    const body = await (await GET(request())).json()
    expect(order).toEqual(['gate:op', 'nudge'])
    expect(body.gate).toEqual({ released: 1 })
    expect(body.planned).toBe(0)
  })

  it('a throwing lane never fails the sweep and adds no key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lanes.gate.sweep = () => { throw new Error('boom') }
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json())).toEqual(CORE_KEYS)
  })

  it('without an operator the hooks never run', async () => {
    delete process.env.KAIROS_OPERATOR_USER_ID
    const hook = vi.fn()
    lanes.gate.sweep = hook
    await GET(request())
    expect(hook).not.toHaveBeenCalled()
  })
})
