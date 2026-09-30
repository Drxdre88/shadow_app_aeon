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

const recordingStep: Step = {
  name: 'weigh',
  run: async (ctx) => {
    ctx.changes.record({ memoryId: 'm1', step: 'weigh', op: 'score', reason: 'r' })
    return { step: 'weigh', examined: 1, changed: 1 }
  },
}

const failingStep: Step = {
  name: 'merge',
  run: async () => { throw new Error('merge broke') },
}

beforeEach(() => {
  vi.clearAllMocks()
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

  it('runs the engine per user, flushes ops and writes a success trace each', async () => {
    const response = await GET(request())
    const body = await response.json()
    expect(body).toMatchObject({ ran: 2, dryRun: false, opsWritten: 2, failed: 0 })
    expect(insertMemoryOps).toHaveBeenCalledTimes(2)
    expect(insertMemoryOps).toHaveBeenCalledWith('u1', expect.any(String), [expect.objectContaining({ memoryId: 'm1' })])
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u1', expect.objectContaining({ cronName: 'memory-engine' }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u2', expect.objectContaining({ cronName: 'memory-engine' }))
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('dryRun=1 writes no ops and no traces', async () => {
    const response = await GET(request('/api/cron/memory-engine?dryRun=1'))
    const body = await response.json()
    expect(body).toMatchObject({ ran: 2, dryRun: true, opsWritten: 0 })
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
})
