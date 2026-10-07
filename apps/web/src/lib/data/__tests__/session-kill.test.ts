import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Owner kill: one helper for the app, MCP and REST paths. It stamps
// metadata.kill {by:'owner', via, at} beside status='killed', and the worker
// call stays best-effort.

const h = vi.hoisted(() => ({ sets: [] as Record<string, unknown>[], wheres: [] as unknown[], returned: [] as unknown[] }))

vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        h.sets.push(values)
        return {
          where: (where: unknown) => {
            h.wheres.push(where)
            return { returning: async () => h.returned }
          },
        }
      },
    }),
  },
}))

import { killSessionByOwner, markSessionKilledByOwner, ownerKillStamp } from '../session-kill'

const NOW = new Date('2026-10-07T06:00:00.000Z')
const compile = (value: unknown) => new PgDialect().sqlToQuery(value as SQL)
const fetchMock = vi.fn()

beforeEach(() => {
  h.sets.length = 0
  h.wheres.length = 0
  h.returned = [{ id: 's-1', status: 'killed' }]
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.KAIROS_WORKER_URL = 'http://worker.local/'
  process.env.KAIROS_WORKER_SECRET = 'secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.KAIROS_WORKER_URL
  delete process.env.KAIROS_WORKER_SECRET
})

describe('ownerKillStamp', () => {
  it('records owner, surface and time, and the reason only when given', () => {
    expect(ownerKillStamp('mcp', NOW)).toEqual({ by: 'owner', via: 'mcp', at: NOW.toISOString() })
    expect(ownerKillStamp('app', NOW, 'wrong repo')).toMatchObject({ reason: 'wrong repo' })
  })
})

describe('markSessionKilledByOwner', () => {
  it('sets killed + endedAt and merges metadata.kill, scoped to the caller', async () => {
    const row = await markSessionKilledByOwner('s-1', 'user-1', 'rest', { now: NOW })
    expect(row).toEqual({ id: 's-1', status: 'killed' })
    const [set] = h.sets
    expect(set).toMatchObject({ status: 'killed', endedAt: NOW })
    const meta = compile(set.metadata)
    expect(meta.sql).toContain("jsonb_set(coalesce(\"agent_sessions\".\"metadata\", '{}'::jsonb), '{kill}'")
    expect(JSON.parse(meta.params[0] as string)).toEqual({ by: 'owner', via: 'rest', at: NOW.toISOString() })
    expect(compile(h.wheres[0]).params).toEqual(['s-1', 'user-1'])
  })

  it('returns null when the row is not the caller’s', async () => {
    h.returned = []
    expect(await markSessionKilledByOwner('s-1', 'other', 'app')).toBeNull()
  })
})

describe('killSessionByOwner', () => {
  it('asks the worker with the shared secret and reports its ack', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const res = await killSessionByOwner({ id: 's-1', workerPid: null }, 'user-1', 'rest', { now: NOW })
    expect(res.workerAck).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://worker.local/kill/s-1', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer secret' } }))
    expect(h.sets).toHaveLength(1)
  })

  it('still marks the row killed when the worker is unreachable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await killSessionByOwner({ id: 's-1', workerPid: 42 }, 'user-1', 'mcp', { now: NOW })
    expect(res).toEqual({ row: { id: 's-1', status: 'killed' }, workerAck: false })
    expect(h.sets[0]).toMatchObject({ status: 'killed' })
    error.mockRestore()
  })

  it('skips the worker for a pid-less session when the path requires a pid', async () => {
    await killSessionByOwner({ id: 's-1', workerPid: null }, 'user-1', 'app', { workerPidRequired: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.sets).toHaveLength(1)
  })

  it('skips the worker when no worker host is configured', async () => {
    delete process.env.KAIROS_WORKER_URL
    const res = await killSessionByOwner({ id: 's-1', workerPid: 7 }, 'user-1', 'rest')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.workerAck).toBe(false)
  })
})
