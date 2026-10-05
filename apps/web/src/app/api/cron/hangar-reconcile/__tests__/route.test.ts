import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/hangar-reconcile', () => ({ reconcileHangarSessions: vi.fn() }))

import { reconcileHangarSessions } from '@/lib/data/hangar-reconcile'
import { GET } from '../route'

function request(authorization?: string) {
  return {
    url: 'https://aeon.test/api/cron/hangar-reconcile',
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

const REPORT = { thresholdMinutes: 30, timedOut: ['s-1'], flaggedOffline: ['s-2'], failed: [] }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  vi.mocked(reconcileHangarSessions).mockResolvedValue(REPORT)
})

describe('cron/hangar-reconcile route', () => {
  it('rejects a request without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(reconcileHangarSessions).not.toHaveBeenCalled()
  })

  it('runs the reconciler with the bearer secret and returns its report', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const response = await GET(request(`Bearer ${'cron-secret'}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(REPORT)
  })

  it('refuses in production when no secret is configured', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    expect((await GET(request())).status).toBe(401)
    expect(reconcileHangarSessions).not.toHaveBeenCalled()
  })
})
