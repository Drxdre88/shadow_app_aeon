import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Archetype substrate pool — machine meta-rows (cron traces, delta folds,
// board snapshots) must not fill the newest-80 recent pool or the pinned pool.

const wheres: SQL[] = []

vi.mock('@/lib/db', () => {
  function makeChain() {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: SQL) => { wheres.push(w); return chain }
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  return { db: { select: vi.fn(() => makeChain()) } }
})

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
  inspectDominion: vi.fn(async () => ({
    name: 'AEON', vision: null, missionLong: null, objectives: [], boardTasks: [],
  })),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  validAsOfNow: undefined,
}))

vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

import { gatherArchetypeContext } from '../archetypes'

const dialect = new PgDialect()

beforeEach(() => {
  wheres.length = 0
})

describe('archetype substrate pool — meta-row exclusion', () => {
  it('excludes trace/delta/snapshot from the recent and pinned pools', async () => {
    await gatherArchetypeContext('user-1', 'dom-1')
    expect(wheres).toHaveLength(4) // recent, pinned, reflections, existing
    const [recent, pinned, reflections] = wheres.map((w) => dialect.sqlToQuery(w))
    for (const q of [recent, pinned]) {
      expect(q.sql).toMatch(/"stream_class" not in/)
      expect(q.params).toEqual(expect.arrayContaining(['trace', 'delta', 'snapshot']))
    }
    // Reflections pool is already pinned to streamClass='reflection'.
    expect(reflections.sql).not.toMatch(/not in/)
  })
})
