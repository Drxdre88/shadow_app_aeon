import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level tests for the KAIROS_RAW_INTROSPECTION retirement gate
// (docs/kairos/35 §Retirement). The flag parsing and the skipped trace are
// covered against the real module in lib/kairos/__tests__/introspection.test.ts.

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
  return { db: { selectDistinct: vi.fn(() => makeDistinctChain(distinctQueue)) } }
})

vi.mock('@/lib/db/schema', () => {
  const tableProxy = (name: string) => new Proxy({}, { get: (_t, prop) => `${name}.${String(prop)}` })
  return { dominions: tableProxy('dominions'), userAiCredentials: tableProxy('userAiCredentials') }
})

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  isNull: (col: unknown) => ({ kind: 'isNull', col }),
  inArray: (col: unknown, vals: unknown) => ({ kind: 'inArray', col, vals }),
}))

vi.mock('@/lib/kairos/introspection', () => ({
  runIntrospectionForUser: vi.fn(),
  isRawIntrospectionEnabled: vi.fn(),
  recordRawIntrospectionSkipped: vi.fn(),
  RAW_INTROSPECTION_OFF_REASON: 'raw_introspection_off',
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { GET } from '../route'
import {
  runIntrospectionForUser,
  isRawIntrospectionEnabled,
  recordRawIntrospectionSkipped,
} from '@/lib/kairos/introspection'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

function request() {
  return { headers: { get: () => null } } as unknown as Parameters<typeof GET>[0]
}

function queueEligible(userIds: string[]) {
  distinctQueue.push(userIds.map((userId) => ({ userId }))) // users with an active Dominion
  distinctQueue.push(userIds.map((userId) => ({ userId }))) // of those, credentialed
}

beforeEach(() => {
  vi.clearAllMocks()
  distinctQueue.length = 0
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  vi.mocked(runIntrospectionForUser).mockResolvedValue([
    { dominionId: 'd1', dominionName: 'AEON', status: 'created', proposalsCreated: 2 },
  ])
})

describe('cron/introspection route — raw introspection gate', () => {
  it('runs the raw generator as today when the flag is on', async () => {
    vi.mocked(isRawIntrospectionEnabled).mockReturnValue(true)
    queueEligible(['u1'])

    const body = await (await GET(request())).json()

    expect(runIntrospectionForUser).toHaveBeenCalledWith('u1')
    expect(recordRawIntrospectionSkipped).not.toHaveBeenCalled()
    expect(body).toMatchObject({ ran: 1, proposalsCreated: 2 })
    expect(body.skipped).toBeUndefined()
  })

  it('skips raw generation, records one skipped trace per eligible user, and says why', async () => {
    vi.mocked(isRawIntrospectionEnabled).mockReturnValue(false)
    queueEligible(['u1', 'u2'])

    const body = await (await GET(request())).json()

    expect(runIntrospectionForUser).not.toHaveBeenCalled()
    expect(recordRawIntrospectionSkipped).toHaveBeenCalledTimes(2)
    expect(recordRawIntrospectionSkipped).toHaveBeenCalledWith('u1')
    expect(recordRawIntrospectionSkipped).toHaveBeenCalledWith('u2')
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
    expect(body).toEqual({ ran: 0, skipped: 'raw_introspection_off', eligible: 2, users: [] })
  })
})
