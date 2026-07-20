import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// reconcileDerivedMemories mutates data across ALL users from a cron, so its
// where-clauses are the contract: these tests render the captured predicates
// to SQL and pin the guards (fact-only, unpinned, not-yet-invalid) and the
// inactive-card definition (done OR archived).

const setCalls: Record<string, unknown>[] = []
const whereArgs: SQL[] = []
const returningQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return chain
    }
    chain.where = (arg: SQL) => {
      whereArgs.push(arg)
      return chain
    }
    chain.returning = () => Promise.resolve(returningQueue.shift() ?? [])
    return chain
  }
  return { db: { update: vi.fn(() => makeUpdateChain()) } }
})

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('../cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { reconcileDerivedMemories } from '../project-snapshot'

const dialect = new PgDialect()
function renderedWhere(index: number): { sql: string; params: unknown[] } {
  const arg = whereArgs[index]
  if (!arg) throw new Error(`no where clause captured at index ${index}`)
  const query = dialect.sqlToQuery(arg)
  return { sql: query.sql.toLowerCase(), params: query.params }
}

beforeEach(() => {
  vi.clearAllMocks()
  setCalls.length = 0
  whereArgs.length = 0
  returningQueue.length = 0
})

describe('reconcileDerivedMemories', () => {
  const NOW = new Date('2026-07-20T23:00:00.000Z')

  it('stamps invalidAt on unpinned facts anchored to done or archived cards', async () => {
    returningQueue.push([{ id: 'm1' }, { id: 'm2' }], [])

    const result = await reconcileDerivedMemories(NOW)

    expect(result.invalidatedTaskFacts).toBe(2)
    expect(setCalls[0]).toEqual({ invalidAt: NOW })

    const { sql, params } = renderedWhere(0)
    expect(params).toContain('fact')
    expect(params).toContain(false) // pinned = false
    expect(sql).toContain('"task_id" is not null')
    expect(sql).toContain('"invalid_at" is null')
    expect(sql).toContain('"archived_at" is null')
    expect(sql).toContain("\"status\" = 'done'")
    expect(sql).toContain('"archived_at" is not null') // archived cards count as inactive
  })

  it('archives board-backfill imports past their 30-day TTL', async () => {
    returningQueue.push([], [{ id: 'm3' }])

    const result = await reconcileDerivedMemories(NOW)

    expect(result.backfillArchived).toBe(1)
    expect(setCalls[1]).toEqual({ archivedAt: NOW })

    const { sql, params } = renderedWhere(1)
    expect(sql).toContain('@>')
    expect(params).toContain(JSON.stringify(['board-backfill']))
  })

  it('reports zero counts when nothing matches', async () => {
    returningQueue.push([], [])

    const result = await reconcileDerivedMemories(NOW)

    expect(result).toEqual({ invalidatedTaskFacts: 0, backfillArchived: 0 })
  })
})
