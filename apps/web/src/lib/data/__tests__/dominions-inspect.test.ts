import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Briefer bundle (inspectDominion) — the "recent memories" leg must skip
// machine meta-rows (cron traces, delta folds, board snapshots) so a daily
// trace per cron can't crowd real activity out of the memoryLimit cap.

const selectQueue: unknown[][] = []
const wheres: SQL[] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = (w: SQL) => { wheres.push(w); return chain }
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return { db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) } }
})

import { inspectDominion } from '../dominions'

const dialect = new PgDialect()

beforeEach(() => {
  wheres.length = 0
  selectQueue.length = 0
})

describe('inspectDominion — briefer memory leg', () => {
  it('excludes trace/delta/snapshot alongside archetype/cortex', async () => {
    selectQueue.push([{ id: 'dom-1', name: 'AEON' }]) // findDominionById
    const out = await inspectDominion('dom-1', 'user-1')
    expect(out).not.toBeNull()
    // findDominionById, objectives, projects, repos, memories, boardTasks
    expect(wheres).toHaveLength(6)
    const memoryLeg = dialect.sqlToQuery(wheres[4])
    expect(memoryLeg.sql).toMatch(/"stream_class" not in/)
    expect(memoryLeg.params).toEqual(expect.arrayContaining(['archetype', 'cortex', 'trace', 'delta', 'snapshot']))
  })

  it('leaves archived boards out of both the board list and the card leg', async () => {
    selectQueue.push([{ id: 'dom-1', name: 'AEON' }])
    await inspectDominion('dom-1', 'user-1')
    const notArchived = `("projects"."settings" ->> 'archived') is distinct from 'true'`
    expect(dialect.sqlToQuery(wheres[2]).sql).toContain(notArchived)
    expect(dialect.sqlToQuery(wheres[5]).sql).toContain(notArchived)
  })
})
