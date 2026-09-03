import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// persistPlacements is hand-written SQL: the shape it renders is the contract
// with the database, so this pins it through drizzle's own dialect — every
// value a bind parameter, instants as ISO text with an explicit cast, chunks
// at PERSIST_CHUNK, the advisory lock first, stale cache cleared alongside.

const state = vi.hoisted(() => ({
  executed: [] as unknown[],
  selectQueue: [] as unknown[][],
  transactions: 0,
  forUpdate: 0,
  inserted: [] as unknown[],
}))

vi.mock('@/lib/db', () => {
  function selectChain() {
    const chain: Record<string, unknown> = {}
    for (const step of ['from', 'where', 'orderBy', 'limit']) chain[step] = () => chain
    chain.for = () => {
      state.forUpdate += 1
      return chain
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(state.selectQueue.shift() ?? [])
    return chain
  }
  function insertChain() {
    const chain: Record<string, unknown> = {}
    chain.values = (v: unknown) => {
      state.inserted.push(v)
      return chain
    }
    chain.returning = () => Promise.resolve([{ id: 'cal-new', timezone: 'UTC', hoursPerDay: '8.00', dayStartMinute: 540, workweek: 62 }])
    return chain
  }
  const conn = {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    execute: vi.fn(async (q: unknown) => {
      state.executed.push(q)
    }),
  }
  return {
    db: {
      ...conn,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        state.transactions += 1
        return fn(conn)
      }),
    },
  }
})

vi.mock('../members', () => ({ findAssignableMembers: vi.fn() }))
vi.mock('../virtual-members', () => ({ findVirtualMembersForProject: vi.fn() }))
vi.mock('../projects', () => ({ findProjectSettings: vi.fn(), touchProject: vi.fn() }))

import { ensureDefaultCalendar, persistPlacements, PERSIST_CHUNK } from '../schedule'
import type { Placement } from '@/lib/schedule/types'

const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const dialect = new PgDialect()
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function rendered(index: number) {
  const q = state.executed[index]
  expect(q).toBeInstanceOf(SQL)
  return dialect.sqlToQuery(q as SQL)
}

function placement(n: number): Placement {
  const id = `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
  const start = new Date(Date.UTC(2026, 8, 7, 9, 0, 0) + n * 3_600_000)
  return {
    taskId: id,
    computedStart: start,
    computedEnd: new Date(start.getTime() + 8 * 3_600_000),
    actualStart: null,
    ownerResourceId: 'r-1',
    totalFloatMin: n,
    isCritical: n === 0,
    laneIndex: 0,
  } as Placement
}

beforeEach(() => {
  vi.clearAllMocks()
  state.executed.length = 0
  state.selectQueue.length = 0
  state.inserted.length = 0
  state.transactions = 0
  state.forUpdate = 0
})

describe('persistPlacements', () => {
  it('takes the project advisory lock first, clears stale cache entries, then writes in taskId order', async () => {
    const reversed = [placement(2), placement(0), placement(1)]
    await expect(persistPlacements(PROJECT_ID, reversed)).resolves.toBe(3)
    expect(state.transactions).toBe(1)
    expect(state.executed).toHaveLength(3)

    const lock = rendered(0)
    expect(lock.sql).toBe('select pg_advisory_xact_lock(hashtext($1))')
    expect(lock.params).toEqual([PROJECT_ID])

    const clear = rendered(1)
    expect(clear.sql).toMatch(/set computed_start = null, computed_end = null, total_float_min = null/)
    expect(clear.sql).toMatch(/where project_id = \$1/)
    expect(clear.sql).toMatch(/computed_start is not null/)
    expect(clear.sql).toMatch(/id <> all\(array\[\$2::uuid, \$3::uuid, \$4::uuid\]::uuid\[\]\)/)
    expect(clear.params).toEqual([PROJECT_ID, placement(0).taskId, placement(1).taskId, placement(2).taskId])

    const update = rendered(2)
    expect(update.params.slice(0, 4)).toEqual([
      placement(0).taskId,
      placement(0).computedStart.toISOString(),
      placement(0).computedEnd.toISOString(),
      0,
    ])
    expect(update.params[4]).toBe(placement(1).taskId)
    expect(update.params[8]).toBe(placement(2).taskId)
  })

  it('renders every value as a bind parameter with the instants cast from ISO text, never a Date', async () => {
    await persistPlacements(PROJECT_ID, [placement(0), placement(1)])
    const update = rendered(2)
    expect(update.sql).toMatch(
      /from \(values \(\$1::uuid, \$2::timestamp, \$3::timestamp, \$4::integer\), \(\$5::uuid, \$6::timestamp, \$7::timestamp, \$8::integer\)\) as v\(id, computed_start, computed_end, total_float_min\)/,
    )
    expect(update.sql).toMatch(/where t\.id = v\.id and t\.project_id = \$9/)
    expect(update.sql).not.toMatch(UUID)
    expect(update.sql).not.toMatch(ISO)
    expect(update.params).toHaveLength(9)
    for (const p of update.params) expect(p).not.toBeInstanceOf(Date)
    expect(update.params[1]).toMatch(/Z$/)
  })

  it('splits at PERSIST_CHUNK rows per statement', async () => {
    const many = Array.from({ length: PERSIST_CHUNK + 1 }, (_, i) => placement(i))
    await expect(persistPlacements(PROJECT_ID, many)).resolves.toBe(PERSIST_CHUNK + 1)
    expect(state.executed).toHaveLength(4)
    expect(rendered(2).params).toHaveLength(PERSIST_CHUNK * 4 + 1)
    expect(rendered(3).params).toHaveLength(1 * 4 + 1)
    expect(rendered(3).params[0]).toBe(placement(PERSIST_CHUNK).taskId)
  })

  it('with nothing placed it still locks and clears the whole project cache, emitting no placement update', async () => {
    await expect(persistPlacements(PROJECT_ID, [])).resolves.toBe(0)
    expect(state.transactions).toBe(1)
    expect(state.executed).toHaveLength(2)
    expect(rendered(0).sql).toBe('select pg_advisory_xact_lock(hashtext($1))')
    const clear = rendered(1)
    expect(clear.sql).toMatch(/set computed_start = null, computed_end = null, total_float_min = null/)
    expect(clear.sql).toMatch(/id <> all\(array\[\]::uuid\[\]\)/)
    expect(clear.params).toEqual([PROJECT_ID])
    expect(clear.sql).not.toMatch(/from \(values/)
  })
})

describe('ensureDefaultCalendar', () => {
  const CAL = { id: 'cal-1', timezone: 'UTC', hoursPerDay: '8.00', dayStartMinute: 540, workweek: 62 }

  it('is a plain read when the project already has a calendar: no transaction, no lock', async () => {
    state.selectQueue.push([CAL])
    await expect(ensureDefaultCalendar(PROJECT_ID)).resolves.toEqual(CAL)
    expect(state.transactions).toBe(0)
    expect(state.forUpdate).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('locks the project row and re-checks before creating the default', async () => {
    state.selectQueue.push([], [{ id: PROJECT_ID }], [])
    const created = await ensureDefaultCalendar(PROJECT_ID)
    expect(state.transactions).toBe(1)
    expect(state.forUpdate).toBe(1)
    expect(state.inserted).toEqual([
      { projectId: PROJECT_ID, name: 'Default', timezone: 'UTC', hoursPerDay: '8', dayStartMinute: 540, workweek: 62 },
    ])
    expect(created.id).toBe('cal-new')
  })

  it('yields to a calendar that appeared between the read and the lock', async () => {
    state.selectQueue.push([], [{ id: PROJECT_ID }], [CAL])
    await expect(ensureDefaultCalendar(PROJECT_ID)).resolves.toEqual(CAL)
    expect(state.transactions).toBe(1)
    expect(state.inserted).toHaveLength(0)
  })
})
