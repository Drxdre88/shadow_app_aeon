import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

// Board forecasts: access-checked, read-only, only dated or estimated open cards.

const selectRows: unknown[][] = []
const wheres: unknown[] = []

vi.mock('@/lib/db', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = (arg: unknown) => { wheres.push(arg); return c }
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(selectRows.shift() ?? [])
    return c
  }
  return { db: { select: vi.fn(() => chain()), insert: vi.fn(), update: vi.fn(), delete: vi.fn() } }
})
vi.mock('../projects', () => ({ verifyProjectAccess: vi.fn(async () => ({ role: 'viewer' })) }))
vi.mock('../velocity', () => ({
  getColumnDwellTimes: vi.fn(async () => [
    { column: 'Live', avgHours: 24, count: 8 },
    { column: 'Review', avgHours: 12, count: 6 },
  ]),
}))

import { readCardForecasts } from '../card-forecast'
import { verifyProjectAccess } from '../projects'
import { getColumnDwellTimes } from '../velocity'
import { db } from '@/lib/db'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const PROJECT = '11111111-1111-4111-8111-111111111111'
const compile = (value: unknown) => new PgDialect().sqlToQuery(value as SQL)

const COLUMNS = [
  { id: 'c-live', name: 'Live', orderIndex: 0 },
  { id: 'c-review', name: 'Review', orderIndex: 1 },
  { id: 'c-done', name: 'Done', orderIndex: 2 },
]

beforeEach(() => {
  vi.clearAllMocks()
  selectRows.length = 0
  wheres.length = 0
})

describe('readCardForecasts', () => {
  it('returns null and reads nothing else when the user cannot see the project', async () => {
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce(null)
    expect(await readCardForecasts(PROJECT, 'stranger', { now: NOW })).toBeNull()
    expect(verifyProjectAccess).toHaveBeenCalledWith(PROJECT, 'stranger')
    expect(db.select).not.toHaveBeenCalled()
    expect(getColumnDwellTimes).not.toHaveBeenCalled()
  })

  it('forecasts the board from 30-day dwell without writing anything', async () => {
    selectRows.push(COLUMNS, [
      { id: 't-live', columnId: 'c-live', endDate: new Date('2026-10-07T00:00:00Z'), estimateMinutes: null, computedEnd: null },
      { id: 't-done', columnId: 'c-done', endDate: new Date('2026-10-07T00:00:00Z'), estimateMinutes: 60, computedEnd: null },
    ])
    const view = (await readCardForecasts(PROJECT, 'u1', { now: NOW }))!
    expect(getColumnDwellTimes).toHaveBeenCalledWith(PROJECT, '30d')
    expect(view.windowDays).toBe(30)
    expect(view.forecasts.map((f) => f.taskId)).toEqual(['t-live'])
    expect(view.forecasts[0].forecastEnd).toBe(new Date(NOW.getTime() + 36 * 3_600_000).toISOString())
    expect(view.forecasts[0].status).toBe('late')
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('asks the database only for open cards with a due date or an estimate', async () => {
    selectRows.push(COLUMNS, [])
    await readCardForecasts(PROJECT, 'u1', { now: NOW })
    const sql = wheres.map((w) => compile(w).sql).find((s) => s.includes('"board_tasks"'))!
    expect(sql).toMatch(/"board_tasks"\."end_date" is not null or "board_tasks"\."estimate_minutes" is not null/)
    expect(sql).toMatch(/"board_tasks"\."archived_at" is null/)
    expect(sql).toMatch(/"board_tasks"\."status" <> \$\d+/)
    expect(sql).not.toMatch(/"board_tasks"\."id" =/)
  })

  it('narrows to one card when a taskId is given', async () => {
    selectRows.push(COLUMNS, [])
    await readCardForecasts(PROJECT, 'u1', { taskId: '22222222-2222-4222-8222-222222222222', now: NOW })
    const sql = wheres.map((w) => compile(w).sql).find((s) => s.includes('"board_tasks"'))!
    expect(sql).toMatch(/"board_tasks"\."id" = \$\d+/)
  })
})
