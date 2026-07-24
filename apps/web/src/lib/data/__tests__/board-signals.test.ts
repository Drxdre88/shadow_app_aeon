import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

type QueryCapture = {
  selection: Record<string, unknown>
  joins: Array<{ kind: 'inner' | 'left'; table: unknown; on: unknown }>
  where?: unknown
  orderBy?: unknown
  limit?: number
}

const selectQueue: unknown[][] = []
const queryCaptures: QueryCapture[] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[], capture: QueryCapture) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = (table: unknown, on: unknown) => {
      capture.joins.push({ kind: 'inner', table, on })
      return chain
    }
    chain.leftJoin = (table: unknown, on: unknown) => {
      capture.joins.push({ kind: 'left', table, on })
      return chain
    }
    chain.where = (arg: unknown) => {
      capture.where = arg
      return chain
    }
    chain.orderBy = (arg: unknown) => {
      capture.orderBy = arg
      return chain
    }
    chain.limit = (value: number) => {
      capture.limit = value
      return chain
    }
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows)
    return chain
  }

  return {
    db: {
      selectDistinct: vi.fn((selection: Record<string, unknown>) => {
        const capture: QueryCapture = { selection, joins: [] }
        queryCaptures.push(capture)
        return makeChain(selectQueue.shift() ?? [], capture)
      }),
      select: vi.fn((selection: Record<string, unknown>) => {
        const capture: QueryCapture = { selection, joins: [] }
        queryCaptures.push(capture)
        return makeChain(selectQueue.shift() ?? [], capture)
      }),
    },
  }
})

import { boardColumns, projectMembers, projects } from '@/lib/db/schema'
import {
  countTasksCompletedBetween,
  countTasksCreatedBetween,
  listRecentlyCompletedTasks,
  listRecentlyCreatedTasks,
  listStaleTasks,
} from '../board-signals'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-07-19T12:00:00.000Z')
const dialect = new PgDialect()

function compile(value: unknown) {
  return dialect.sqlToQuery(value as SQL)
}

function lastQuery() {
  const query = queryCaptures.at(-1)
  if (!query) throw new Error('Expected a captured query')
  return query
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    taskId: '20000000-0000-4000-8000-000000000001',
    name: 'Harvest the board',
    projectId: '30000000-0000-4000-8000-000000000001',
    projectName: 'Kairos',
    columnName: 'Live',
    priority: 'high',
    ...overrides,
  }
}

function expectSharedScope(query: QueryCapture) {
  const compiled = compile(query.where)
  expect(compiled.sql).toContain('"projects"."user_id" = $1 or "project_members"."user_id" = $2')
  expect(compiled.params.slice(0, 2)).toEqual([USER_ID, USER_ID])
  expect(compiled.sql).toContain('"board_tasks"."archived_at" is null')
  expect(query.joins).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'inner', table: projects }),
    expect.objectContaining({ kind: 'left', table: boardColumns }),
    expect.objectContaining({ kind: 'left', table: projectMembers }),
  ]))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  selectQueue.length = 0
  queryCaptures.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listStaleTasks', () => {
  it('uses the exclusive stale-window edge, excludes archived and done tasks, and orders oldest first', async () => {
    const row = baseRow({ ageDays: 22 })
    selectQueue.push([{ ...row, updatedAt: new Date('2026-06-27T12:00:00.000Z') }])

    await expect(listStaleTasks({ userId: USER_ID })).resolves.toEqual([row])

    const query = lastQuery()
    const where = compile(query.where)
    const orderBy = compile(query.orderBy)
    const ageDays = compile(query.selection.ageDays)
    expectSharedScope(query)
    expect(where.sql).toContain('"board_tasks"."status" <> $3')
    expect(where.sql).toContain('"board_tasks"."updated_at" < $4')
    expect(where.params[2]).toBe('done')
    expect(where.params[3]).toEqual('2026-06-28T12:00:00.000Z')
    expect(orderBy.sql).toBe('"board_tasks"."updated_at" asc')
    expect(ageDays.sql).toContain('floor(extract(epoch from ($1 - "board_tasks"."updated_at")) / 86400)::int')
    expect(ageDays.params).toEqual([NOW])
    expect(query.limit).toBe(12)
  })

  it('caps results at the requested limit', async () => {
    const rows = [baseRow({ ageDays: 4 }), baseRow({ taskId: 'task-2', ageDays: 3 })]
    selectQueue.push(rows.map((row) => ({ ...row, updatedAt: new Date('2026-07-15T12:00:00.000Z') })))

    await expect(listStaleTasks({ userId: USER_ID, days: 3, limit: 2 })).resolves.toEqual(rows)

    const query = lastQuery()
    expect(query.limit).toBe(2)
    expect(compile(query.where).params.at(-1)).toEqual('2026-07-16T12:00:00.000Z')
  })
})

describe('listRecentlyCompletedTasks', () => {
  it('includes the N-day boundary, requires completed tasks, and orders most recent first', async () => {
    const newer = baseRow({ taskId: 'task-newer', completedAt: new Date('2026-07-19T10:00:00.000Z') })
    const edge = baseRow({ taskId: 'task-edge', completedAt: new Date('2026-07-12T12:00:00.000Z') })
    selectQueue.push([newer, edge])

    await expect(listRecentlyCompletedTasks({ userId: USER_ID })).resolves.toEqual([newer, edge])

    const query = lastQuery()
    const where = compile(query.where)
    expectSharedScope(query)
    expect(where.sql).toContain('"board_tasks"."completed_at" is not null')
    expect(where.sql).toContain('"board_tasks"."completed_at" >= $3')
    expect(where.params[2]).toEqual('2026-07-12T12:00:00.000Z')
    expect(compile(query.orderBy).sql).toBe('"board_tasks"."completed_at" desc')
    expect(query.limit).toBe(12)
  })
})

describe('listRecentlyCreatedTasks', () => {
  it('includes the N-day boundary, excludes done tasks, and orders most recent first', async () => {
    const newer = baseRow({ taskId: 'task-newer', createdAt: new Date('2026-07-19T10:00:00.000Z') })
    const edge = baseRow({ taskId: 'task-edge', createdAt: new Date('2026-07-12T12:00:00.000Z') })
    selectQueue.push([newer, edge])

    await expect(listRecentlyCreatedTasks({ userId: USER_ID })).resolves.toEqual([newer, edge])

    const query = lastQuery()
    const where = compile(query.where)
    expectSharedScope(query)
    expect(where.sql).toContain('"board_tasks"."status" <> $3')
    expect(where.sql).toContain('"board_tasks"."created_at" >= $4')
    expect(where.params[2]).toBe('done')
    expect(where.params[3]).toEqual('2026-07-12T12:00:00.000Z')
    expect(compile(query.orderBy).sql).toBe('"board_tasks"."created_at" desc')
    expect(query.limit).toBe(12)
  })

  it('scopes results to owned or member projects, excluding inaccessible projects', async () => {
    const accessible = baseRow({ projectId: 'owned-project' })
    selectQueue.push([accessible])

    const rows = await listRecentlyCreatedTasks({ userId: USER_ID, limit: 1 })

    expectSharedScope(lastQuery())
    expect(rows).toEqual([accessible])
    expect(rows).not.toContainEqual(expect.objectContaining({ projectId: 'inaccessible-project' }))
  })
})

function expectCountScope(query: QueryCapture) {
  const compiled = compile(query.where)
  expect(compiled.sql).toContain('"projects"."user_id" = $1 or "project_members"."user_id" = $2')
  expect(compiled.params.slice(0, 2)).toEqual([USER_ID, USER_ID])
  expect(compiled.sql).toContain('"board_tasks"."archived_at" is null')
  expect(query.joins).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'inner', table: projects }),
    expect.objectContaining({ kind: 'left', table: projectMembers }),
  ]))
}

describe('countTasksCompletedBetween', () => {
  const start = new Date('2026-07-24T00:00:00.000Z')
  const end = new Date('2026-07-25T00:00:00.000Z')

  it('scopes to the exact [start, end) window, requires completed tasks, and uses COUNT(DISTINCT id)', async () => {
    selectQueue.push([{ n: 3 }])

    await expect(countTasksCompletedBetween(USER_ID, start, end)).resolves.toBe(3)

    const query = lastQuery()
    const where = compile(query.where)
    const n = compile(query.selection.n)
    expectCountScope(query)
    expect(n.sql).toContain('COUNT(DISTINCT "board_tasks"."id")::int')
    expect(where.sql).toContain('"board_tasks"."completed_at" is not null')
    expect(where.sql).toContain('"board_tasks"."completed_at" >= $3')
    expect(where.sql).toContain('"board_tasks"."completed_at" < $4')
    expect(where.params[2]).toEqual(start.toISOString())
    expect(where.params[3]).toEqual(end.toISOString())
  })

  it('returns 0 when no row comes back', async () => {
    selectQueue.push([])

    await expect(countTasksCompletedBetween(USER_ID, start, end)).resolves.toBe(0)
  })
})

describe('countTasksCreatedBetween', () => {
  const start = new Date('2026-07-24T00:00:00.000Z')
  const end = new Date('2026-07-25T00:00:00.000Z')

  it('scopes to the exact [start, end) window and does NOT exclude done tasks', async () => {
    selectQueue.push([{ n: 4 }])

    await expect(countTasksCreatedBetween(USER_ID, start, end)).resolves.toBe(4)

    const query = lastQuery()
    const where = compile(query.where)
    const n = compile(query.selection.n)
    expectCountScope(query)
    expect(n.sql).toContain('COUNT(DISTINCT "board_tasks"."id")::int')
    expect(where.sql).not.toContain('"board_tasks"."status"')
    expect(where.sql).toContain('"board_tasks"."created_at" >= $3')
    expect(where.sql).toContain('"board_tasks"."created_at" < $4')
    expect(where.params[2]).toEqual(start.toISOString())
    expect(where.params[3]).toEqual(end.toISOString())
  })

  it('returns 0 when no row comes back', async () => {
    selectQueue.push([])

    await expect(countTasksCreatedBetween(USER_ID, start, end)).resolves.toBe(0)
  })
})
