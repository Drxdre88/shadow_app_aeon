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
// runProjectSnapshotsForUser reads: projects list, then per project counts + recent events.
const selectQueue: Array<unknown[] | Error> = []

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
  function makeSelectChain(rows: unknown[] | Error) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      rows instanceof Error ? reject(rows) : resolve(rows)
    return chain
  }
  return {
    db: {
      update: vi.fn(() => makeUpdateChain()),
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
    },
  }
})

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('../cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

vi.mock('../board-feed', () => ({
  runBoardFeedForProject: vi.fn(),
}))

import { reconcileDerivedMemories, runProjectSnapshotsForUser } from '../project-snapshot'
import { writeCronFailureTrace, writeCronSuccessTrace } from '../cron-trace'
import { runBoardFeedForProject } from '../board-feed'

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
  selectQueue.length = 0
})

describe('runProjectSnapshotsForUser — liveness trace', () => {
  const USER = 'user-1'
  const project = (id: string) => ({ id, name: `Project ${id}`, dominionId: 'dom-1' })

  it('writes one ok success trace after a clean run (dormant projects still count as a run)', async () => {
    selectQueue.push([project('p1')], [{ open: 0, doneToday: 0, blocked: 0 }], [])

    const results = await runProjectSnapshotsForUser(USER)

    expect(results).toEqual([expect.objectContaining({ projectId: 'p1', status: 'skipped', reason: 'dormant' })])
    expect(writeCronSuccessTrace).toHaveBeenCalledOnce()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'project-snapshot' })
  })

  it('writes a skipped success trace when the user has no projects', async () => {
    selectQueue.push([])

    await runProjectSnapshotsForUser(USER)

    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, {
      cronName: 'project-snapshot',
      outcome: 'skipped',
      skipReason: 'no projects',
    })
  })

  it('writes the failure trace and no success trace when a project throws', async () => {
    selectQueue.push([project('p1')], new Error('db exploded'))

    await runProjectSnapshotsForUser(USER)

    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'project-snapshot',
      reason: 'uncaught_exception',
    }))
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('runs the board feed only for projects with settings.kairosFeed, even when the snapshot is dormant', async () => {
    vi.mocked(runBoardFeedForProject).mockResolvedValue({ mode: 'daily', status: 'created', externalId: 'board-day:p1:x' })
    selectQueue.push(
      [{ ...project('p1'), settings: { kairosFeed: 'daily' } }, { ...project('p2'), settings: {} }],
      [{ open: 0, doneToday: 0, blocked: 0 }], [],
      [{ open: 0, doneToday: 0, blocked: 0 }], [],
    )

    const results = await runProjectSnapshotsForUser(USER)

    expect(runBoardFeedForProject).toHaveBeenCalledOnce()
    expect(runBoardFeedForProject).toHaveBeenCalledWith(USER, expect.objectContaining({ id: 'p1' }), 'daily', expect.any(Date))
    expect(results[0]).toMatchObject({ status: 'skipped', reason: 'dormant', feed: { status: 'created' } })
    expect(results[1]!.feed).toBeUndefined()
    expect(writeCronSuccessTrace).toHaveBeenCalledOnce()
  })

  it('traces a board-feed failure without losing the snapshot result', async () => {
    vi.mocked(runBoardFeedForProject).mockRejectedValue(new Error('feed exploded'))
    selectQueue.push([{ ...project('p1'), settings: { kairosFeed: 'weekly' } }], [{ open: 0, doneToday: 0, blocked: 0 }], [])

    const results = await runProjectSnapshotsForUser(USER)

    expect(results[0]).toMatchObject({ reason: 'dormant', feed: { mode: 'weekly', status: 'skipped', reason: 'feed exploded' } })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'board_feed_failed' }))
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })
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
