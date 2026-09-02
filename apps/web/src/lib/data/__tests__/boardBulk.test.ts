import { describe, it, expect, beforeEach, vi } from 'vitest'

// moveAllTasksToColumn must (1) read the source column and the target's max
// inside ONE transaction, (2) write each card after that max in source order,
// (3) broadcast task:moved once — and do none of the writing when the source
// is empty.

const selectResults: unknown[][] = []
const setCalls: Record<string, unknown>[] = []
let transactionCalls = 0

vi.mock('@/lib/db', () => {
  function makeSelectChain() {
    const rows = selectResults.shift() ?? []
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => { setCalls.push(patch); return chain }
    chain.where = () => Promise.resolve([])
    return chain
  }
  const tx = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => { transactionCalls++; return fn(tx) }),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { moveAllTasksToColumn } from '../boardBulk'
import { touchProject } from '../projects'

beforeEach(() => {
  selectResults.length = 0
  setCalls.length = 0
  transactionCalls = 0
  vi.clearAllMocks()
})

describe('moveAllTasksToColumn', () => {
  it('places every source card after the target max, in source order, and broadcasts once', async () => {
    selectResults.push(
      [
        { id: 't1', name: 'One', orderIndex: 0 },
        { id: 't2', name: 'Two', orderIndex: 1 },
        { id: 't3', name: 'Three', orderIndex: 4 },
      ],
      [{ max: 6 }],
    )

    const moved = await moveAllTasksToColumn('p1', 'from', 'to')

    expect(transactionCalls).toBe(1)
    expect(setCalls.map((c) => [c.columnId, c.orderIndex])).toEqual([
      ['to', 7],
      ['to', 8],
      ['to', 9],
    ])
    expect(setCalls.every((c) => c.updatedAt instanceof Date)).toBe(true)
    expect(moved).toEqual([
      { id: 't1', name: 'One', orderIndex: 7 },
      { id: 't2', name: 'Two', orderIndex: 8 },
      { id: 't3', name: 'Three', orderIndex: 9 },
    ])
    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(touchProject).toHaveBeenCalledWith('p1', { type: 'task:moved' })
  })

  it('starts at 0 when the target column is empty', async () => {
    selectResults.push([{ id: 't1', name: 'One', orderIndex: 3 }], [{ max: -1 }])

    await moveAllTasksToColumn('p1', 'from', 'to')

    expect(setCalls.map((c) => c.orderIndex)).toEqual([0])
  })

  it('writes nothing and stays silent when the source column is empty', async () => {
    selectResults.push([])

    const moved = await moveAllTasksToColumn('p1', 'from', 'to')

    expect(moved).toEqual([])
    expect(setCalls).toEqual([])
    expect(touchProject).not.toHaveBeenCalled()
  })
})
