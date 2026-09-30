import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Galaxy loader — the unfiltered load of every memory (~7.9k rows incl. cron
// traces, delta folds, snapshots) crashed the view. Pin the signal filter, the
// importance ordering and the cap on the main memory query.

const selectQueue: unknown[][] = []
const calls: Array<{ where?: SQL; orderBy?: unknown[]; limit?: number }> = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const rec: { where?: SQL; orderBy?: unknown[]; limit?: number } = {}
    calls.push(rec)
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = (w: SQL) => { rec.where = w; return chain }
    chain.orderBy = (...o: unknown[]) => { rec.orderBy = o; return chain }
    chain.limit = (n: number) => { rec.limit = n; return chain }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return { db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) } }
})

import { getGraphForUser, GALAXY_DEFAULT_LIMIT } from '../memories'

const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)

function queueEmptyGraph() {
  selectQueue.length = 0
  selectQueue.push([], [], [])
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  queueEmptyGraph()
})

describe('getGraphForUser — galaxy signal filter and cap', () => {
  it('excludes meta streams, session_event rows, archived and expired (non-superseded) rows', async () => {
    await getGraphForUser('user-1')
    const { sql, params } = render(calls[0].where)
    expect(sql).toMatch(/"stream_class" not in/)
    expect(params).toEqual(expect.arrayContaining(['trace', 'delta', 'snapshot', 'session_event']))
    expect(sql).toMatch(/"type" <>/)
    expect(sql).toContain('"archived_at" IS NULL')
    // Expired rows drop, but superseded ghosts survive for lineage threads.
    expect(sql).toContain('"invalid_at" IS NULL OR "memories"."invalid_at" > NOW() OR "memories"."superseded_by_id" IS NOT NULL')
  })

  it('caps at the default limit, ordered pinned → reflection → confidence → recency', async () => {
    await getGraphForUser('user-1')
    expect(calls[0].limit).toBe(GALAXY_DEFAULT_LIMIT)
    expect(GALAXY_DEFAULT_LIMIT).toBe(1500)
    const order = (calls[0].orderBy ?? []).map((o) => render(o).sql)
    expect(order[0]).toContain('"pinned" desc')
    expect(order[1]).toContain(`= 'reflection') DESC`)
    expect(order[2]).toContain('"confidence" DESC NULLS LAST')
    expect(order[3]).toContain('"created_at" desc')
  })

  it('honours and clamps a caller-supplied limit', async () => {
    await getGraphForUser('user-1', { limit: 200 })
    expect(calls[0].limit).toBe(200)

    calls.length = 0
    queueEmptyGraph()
    await getGraphForUser('user-1', { limit: 0 })
    expect(calls[0].limit).toBe(1)

    calls.length = 0
    queueEmptyGraph()
    await getGraphForUser('user-1', { limit: 1_000_000 })
    expect(calls[0].limit).toBe(5000)
  })

  it('keeps the archived filter off when includeArchived is set', async () => {
    await getGraphForUser('user-1', { includeArchived: true })
    expect(render(calls[0].where).sql).not.toContain('"archived_at" IS NULL')
  })
})
