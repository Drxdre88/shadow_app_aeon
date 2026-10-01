import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memory-engine', () => ({ listMemoryEngineUserIds: vi.fn() }))
vi.mock('@/lib/data/memory-ops', () => ({ insertMemoryOps: vi.fn() }))
vi.mock('@/lib/kairos/engine/registry', () => ({ buildNightSteps: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

import { listMemoryEngineUserIds } from '@/lib/data/memory-engine'
import { insertMemoryOps } from '@/lib/data/memory-ops'
import { buildNightSteps } from '@/lib/kairos/engine/registry'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import type { Step } from '@/lib/kairos/engine/types'
import { GET } from '../route'

function request(path = '/api/cron/memory-engine', authorization?: string) {
  return {
    url: `https://aeon.test${path}`,
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

// Live: a step writes its ops inside each mutation's transaction and reports
// the count; dry run: it only records into the change log.
const recordingStep: Step = {
  name: 'weigh',
  run: async (ctx) => {
    if (ctx.dryRun) ctx.changes.record({ memoryId: 'm1', step: 'weigh', op: 'score', reason: 'r' })
    return { step: 'weigh', examined: 1, changed: 1, ...(ctx.dryRun ? {} : { opsWritten: 1 }) }
  },
}

const failingStep: Step = {
  name: 'merge',
  run: async () => { throw new Error('merge broke') },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  vi.mocked(listMemoryEngineUserIds).mockResolvedValue(['u1', 'u2'])
  vi.mocked(buildNightSteps).mockImplementation(() => [recordingStep])
  vi.mocked(insertMemoryOps).mockImplementation(async (_u, _r, ops) => ops.length)
})

describe('cron/memory-engine route', () => {
  it('rejects without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(listMemoryEngineUserIds).not.toHaveBeenCalled()
  })

  it('accepts the bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const response = await GET(request(undefined, 'Bearer cron-secret'))
    expect(response.status).toBe(200)
  })

  it('runs the engine per user, counts transactional ops and writes a success trace each', async () => {
    const response = await GET(request())
    const body = await response.json()
    expect(body).toMatchObject({ ran: 2, dryRun: false, opsWritten: 2, failed: 0 })
    // Nothing is left buffered for an after-the-fact flush.
    expect(insertMemoryOps).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u1', expect.objectContaining({ cronName: 'memory-engine' }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u2', expect.objectContaining({ cronName: 'memory-engine' }))
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('dryRun=1 writes no ops and no traces', async () => {
    const response = await GET(request('/api/cron/memory-engine?dryRun=1'))
    const body = await response.json()
    expect(body).toMatchObject({ ran: 2, dryRun: true, opsWritten: 0 })
    expect(body.users[0].result).toMatchObject({ opsPlanned: 1 })
    expect(body.users[0].result.steps[0]).toMatchObject({ step: 'weigh', changed: 1 })
    expect(insertMemoryOps).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('traces a failed step but keeps going for the remaining steps and users', async () => {
    vi.mocked(buildNightSteps).mockImplementation(() => [failingStep, recordingStep])
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 2, failed: 2, opsWritten: 2 })
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
      cronName: 'memory-engine',
      reason: 'step_failed',
      error: 'merge: merge broke',
    }))
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('traces an uncaught per-user exception and continues with the next user', async () => {
    vi.mocked(buildNightSteps)
      .mockImplementationOnce(() => { throw new Error('registry broke') })
      .mockImplementation(() => [recordingStep])
    const response = await GET(request())
    const body = await response.json()
    expect(body.users[0]).toEqual({ userId: 'u1', error: 'registry broke' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({ reason: 'uncaught_exception' }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u2', expect.objectContaining({ cronName: 'memory-engine' }))
  })

  it('writes a failure trace when a change was rolled back because its op insert failed', async () => {
    vi.mocked(buildNightSteps).mockImplementation(() => [{
      name: 'backup',
      run: async () => ({ step: 'backup', examined: 2, changed: 1, opsWritten: 1, errors: ['p1: memory_ops insert failed'] }),
    }])
    const body = await (await GET(request())).json()
    expect(body).toMatchObject({ failed: 2, opsWritten: 2 })
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
      cronName: 'memory-engine',
      reason: 'step_failed',
      error: 'backup: 1 change(s) rolled back: p1: memory_ops insert failed',
    }))
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('writes a failure trace when a whole step transaction (e.g. standings + ops) failed', async () => {
    vi.mocked(buildNightSteps).mockImplementation(() => [{
      name: 'weigh',
      run: async () => { throw new Error('memory_ops insert failed') },
    }])
    await GET(request())
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
      reason: 'step_failed',
      error: 'weigh: memory_ops insert failed',
    }))
  })

  it('stops at its own time budget and still traces every user (2026-10-01 regression)', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    vi.mocked(buildNightSteps).mockImplementation(() => [{
      name: 'backup',
      run: async (ctx) => {
        // The step sees a deadline well inside maxDuration (300s)…
        expect(ctx.deadline).toBeGreaterThan(0)
        expect(ctx.deadline).toBeLessThanOrEqual(250_000)
        // …and it is spent by the time this step yields.
        clock.mockReturnValue(ctx.deadline ?? 0)
        return { step: 'backup', examined: 349, changed: 349, opsWritten: 349, outOfTime: true, notes: ['out of time after 349/400'] }
      },
    }])
    try {
      const body = await (await GET(request())).json()
      expect(body).toMatchObject({ ran: 2, opsWritten: 349, failed: 2 })
      expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
        cronName: 'memory-engine',
        reason: 'time_budget',
        error: expect.stringContaining('backup: out of time after 349/400'),
      }))
      // The second user never started, but still gets a trace.
      expect(writeCronFailureTrace).toHaveBeenCalledWith('u2', expect.objectContaining({ reason: 'time_budget' }))
      expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it('logs and returns 500 when the user list cannot be loaded', async () => {
    vi.mocked(listMemoryEngineUserIds).mockRejectedValue(new Error('db down'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(console.error).toHaveBeenCalled()
  })
})
