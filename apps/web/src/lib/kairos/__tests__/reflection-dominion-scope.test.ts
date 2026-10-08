import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const DOMINION_ID = '11111111-1111-4111-8111-111111111111'
const TAG_ONLY_REFLECTION = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Cross-front dialogue reflection',
  type: 'reflection',
  streamClass: 'reflection',
  summary: 'Committed from a dialogue spanning two Dominions',
  pinned: false,
  createdAt: new Date('2026-10-01'),
  dominionId: null as string | null,
  tags: ['reflection', `dominion:${DOMINION_ID}`],
}

const dialect = new PgDialect()
const whereClauses: SQL[] = []

function admits(where: SQL | undefined, row: typeof TAG_ONLY_REFLECTION): boolean {
  if (!where) return false
  const { sql: text, params } = dialect.sqlToQuery(where)
  if (!params.includes(row.streamClass)) return false
  if (row.dominionId) return params.includes(row.dominionId)
  const tagParam = JSON.stringify(row.tags.filter((t) => t.startsWith('dominion:')))
  return /"tags" @>/.test(text) && params.includes(tagParam)
}

vi.mock('@/lib/db', () => {
  function makeChain() {
    let where: SQL | undefined
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = (w: SQL) => { where = w; whereClauses.push(w); return chain }
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(admits(where, TAG_ONLY_REFLECTION) ? [TAG_ONLY_REFLECTION] : [])
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

vi.mock('@/lib/data/memories', async () => {
  const { sql } = await import('drizzle-orm')
  return { captureMemory: vi.fn(), validAsOfNow: sql`TRUE` }
})

vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ isJobDone: vi.fn(async () => false) }))
vi.mock('@/lib/kairos/surprise/replay-reader', () => ({ cortexDueSoonContext: vi.fn(async () => ({})) }))

import { gatherArchetypeContext } from '../archetypes'
import { gatherCortexContext } from '../cortex'

beforeEach(() => {
  whereClauses.length = 0
  TAG_ONLY_REFLECTION.streamClass = 'reflection'
})

describe('reflections soft-tagged with dominion:<id> (FK null)', () => {
  it('reach the archetype reflection input, and only that input', async () => {
    const ctx = await gatherArchetypeContext('u1', DOMINION_ID)
    expect(ctx?.reflections.map((r) => r.id)).toEqual([TAG_ONLY_REFLECTION.id])
    expect(ctx?.recent).toEqual([])
    expect(ctx?.pinned).toEqual([])
    expect(ctx?.existing).toEqual([])
  })

  it('reach the cortex reflection input', async () => {
    const ctx = await gatherCortexContext('u1', DOMINION_ID)
    expect(ctx?.reflections.map((r) => r.id)).toEqual([TAG_ONLY_REFLECTION.id])
    expect(ctx?.archetypes).toEqual([])
  })

  it('keep non-reflection queries FK-only', async () => {
    TAG_ONLY_REFLECTION.streamClass = 'archetype'
    const ctx = await gatherCortexContext('u1', DOMINION_ID)
    expect(ctx?.archetypes).toEqual([])
    const tagged = whereClauses.filter((w) => /"tags" @>/.test(dialect.sqlToQuery(w).sql))
    expect(tagged).toHaveLength(1)
  })
})
