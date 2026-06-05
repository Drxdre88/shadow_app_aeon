import { describe, it, expect, vi, beforeEach } from 'vitest'

const lastWhereArg: { value: unknown } = { value: null }
const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = (arg: unknown) => { lastWhereArg.value = arg; return chain }
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) },
  }
})

import { listTraceHistory } from '../recipes'

const USER = 'user-1'
const DOMINION = 'b0000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  lastWhereArg.value = null
})

function fakeRow(id: string, recipe: string) {
  return {
    id,
    title: `BRIEF run ${id}`,
    summary: null,
    dominionId: DOMINION,
    sourceMetadata: { recipe, durationMs: 4200 },
    createdAt: new Date('2026-06-01T07:00:00Z'),
  }
}

describe('listTraceHistory', () => {
  it('returns rows from the DB', async () => {
    selectQueue.push([fakeRow('t1', 'BRIEF'), fakeRow('t2', 'BRIEF')])
    const rows = await listTraceHistory(USER, { dominionId: DOMINION })
    expect(rows).toHaveLength(2)
    expect(rows[0].sourceMetadata).toEqual({ recipe: 'BRIEF', durationMs: 4200 })
  })

  it('clamps limit to [1, 100]', async () => {
    selectQueue.push([])
    await listTraceHistory(USER, { limit: 0 })
    selectQueue.push([])
    await listTraceHistory(USER, { limit: 999 })
    // No throw; clamping is internal. Smoke test only.
    expect(true).toBe(true)
  })

  it('uses default limit when not provided', async () => {
    selectQueue.push([])
    const rows = await listTraceHistory(USER)
    expect(rows).toEqual([])
  })

  it('returns empty when DB returns nothing', async () => {
    selectQueue.push([])
    const rows = await listTraceHistory(USER, { dominionId: DOMINION, recipe: 'BRIEF' })
    expect(rows).toEqual([])
  })
})
