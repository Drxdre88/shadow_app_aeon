import { describe, it, expect, vi, beforeEach } from 'vitest'

// Kairos Phase 3C — cron route response-shape parity test.
// The dashboard polling UI depends on the envelope shape exactly:
//   { ran, advisoriesCreated, users: [{ userId, results, error? }] }
// Each `results` row mirrors the legacy BrieferResult contract:
//   { dominionId, dominionName, status, memoryId?, reason? }
// This pins both the shape and the per-error reason strings.

vi.mock('next-auth', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }))

const distinctQueueUsersWithDominions: Array<Array<{ userId: string }>> = []
const distinctQueueCredentialed: Array<Array<{ userId: string }>> = []

vi.mock('@/lib/db', () => {
  function makeDistinctChain(queue: Array<Array<{ userId: string }>>) {
    const rows = queue.shift() ?? []
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(rows)
    return chain
  }
  let callIndex = 0
  return {
    db: {
      selectDistinct: vi.fn(() => {
        // First call = users with dominions; second = credentialed users.
        const queue = callIndex++ % 2 === 0
          ? distinctQueueUsersWithDominions
          : distinctQueueCredentialed
        return makeDistinctChain(queue)
      }),
    },
  }
})

vi.mock('@/lib/db/schema', () => {
  const tableProxy = (name: string) =>
    new Proxy({}, { get: (_t, prop) => `${name}.${String(prop)}` })
  return {
    userAiCredentials: tableProxy('userAiCredentials'),
    dominions: tableProxy('dominions'),
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  isNull: (col: unknown) => ({ kind: 'isNull', col }),
  inArray: (col: unknown, vs: unknown[]) => ({ kind: 'inArray', col, vs }),
  eq: (a: unknown, b: unknown) => ({ kind: 'eq', a, b }),
}))

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
}))

vi.mock('@/lib/kairos/dispatch', () => ({
  runRecipe: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {
    constructor(public providerId?: string) {
      super('missing')
      this.name = 'AiCredentialMissingError'
    }
  },
}))

import { GET } from '../route'
import { findDominionsByUser } from '@/lib/data/dominions'
import { runRecipe } from '@/lib/kairos/dispatch'
import { AiCredentialMissingError } from '@/lib/ai/router'

const USER = 'user-1'
const DOM_A = { id: 'dom-a', name: 'Alpha', archivedAt: null }
const DOM_B = { id: 'dom-b', name: 'Beta', archivedAt: null }

function makeReq(authHeader?: string) {
  const headers = new Map<string, string>()
  if (authHeader) headers.set('authorization', authHeader)
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  distinctQueueUsersWithDominions.length = 0
  distinctQueueCredentialed.length = 0
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/briefer route', () => {
  it('returns { ran:0, users:[] } when no users have active Dominions', async () => {
    distinctQueueUsersWithDominions.push([])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body).toEqual({ ran: 0, users: [] })
  })

  it('dispatches BRIEF per active Dominion per credentialed user, preserves envelope shape', async () => {
    distinctQueueUsersWithDominions.push([{ userId: USER }])
    distinctQueueCredentialed.push([{ userId: USER }])
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A, DOM_B])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 'created', memoryId: 'm1', traceId: 't1' })
      .mockResolvedValueOnce({ status: 'existing', memoryId: 'm2', traceId: null })

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.ran).toBe(1)
    expect(body.advisoriesCreated).toBe(1)
    expect(body.users).toHaveLength(1)
    expect(body.users[0].userId).toBe(USER)
    expect(body.users[0].results).toEqual([
      { dominionId: 'dom-a', dominionName: 'Alpha', status: 'created', memoryId: 'm1' },
      { dominionId: 'dom-b', dominionName: 'Beta', status: 'existing', memoryId: 'm2' },
    ])
    expect(body.users[0].error).toBeUndefined()
  })

  it('maps AiCredentialMissingError per Dominion to skipped + reason "no BYOK credential"', async () => {
    distinctQueueUsersWithDominions.push([{ userId: USER }])
    distinctQueueCredentialed.push([{ userId: USER }])
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AiCredentialMissingError('openai'))

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.users[0].results).toEqual([
      { dominionId: 'dom-a', dominionName: 'Alpha', status: 'skipped', reason: 'no BYOK credential' },
    ])
    expect(body.advisoriesCreated).toBe(0)
  })

  it('maps "BRIEF: no Dominion bundle" → skipped reason "not found"', async () => {
    distinctQueueUsersWithDominions.push([{ userId: USER }])
    distinctQueueCredentialed.push([{ userId: USER }])
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('BRIEF: no Dominion bundle for dom-a'))

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.users[0].results[0]).toMatchObject({ status: 'skipped', reason: 'not found' })
  })

  it('maps "BRIEF: empty response" → skipped reason "empty response"', async () => {
    distinctQueueUsersWithDominions.push([{ userId: USER }])
    distinctQueueCredentialed.push([{ userId: USER }])
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('BRIEF: empty response from provider'))

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.users[0].results[0]).toMatchObject({ status: 'skipped', reason: 'empty response' })
  })

  it('unknown error per user aborts that user\'s batch into { results:[], error }', async () => {
    distinctQueueUsersWithDominions.push([{ userId: USER }])
    distinctQueueCredentialed.push([{ userId: USER }])
    ;(findDominionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue([DOM_A])
    ;(runRecipe as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('db connection lost'))

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.users).toHaveLength(1)
    expect(body.users[0].results).toEqual([])
    expect(body.users[0].error).toContain('db connection lost')
  })

  it('rejects with 401 when CRON_SECRET is set and header missing', async () => {
    process.env.CRON_SECRET = 'secret-token'
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('accepts when CRON_SECRET matches Bearer header', async () => {
    process.env.CRON_SECRET = 'secret-token'
    distinctQueueUsersWithDominions.push([])
    const res = await GET(makeReq('Bearer secret-token'))
    const body = await res.json()
    expect(body).toEqual({ ran: 0, users: [] })
  })

  it('rejects 401 in production when CRON_SECRET is unset (no dev bypass)', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    delete process.env.CRON_SECRET
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })
})
