import { describe, it, expect, beforeEach, vi } from 'vitest'

// Delete-time fact invalidation. memories.taskId is ON DELETE SET NULL, so
// the nightly reconcileDerivedMemories sweep can never see facts anchored to
// an already-deleted task — deleteTask/deleteTasksByColumn must stamp
// invalidAt on anchored facts BEFORE the board_tasks row goes away. These
// tests pin the ordering (update precedes delete, same transaction) and the
// patch shape (invalidAt only — never archivedAt).

const callOrder: string[] = []
const setCalls: Record<string, unknown>[] = []
const deleteReturningQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {}
    chain.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return chain
    }
    chain.where = () => {
      callOrder.push('update')
      return chain
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  function makeSelectChain() {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    return chain
  }
  function makeDeleteChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    chain.where = () => {
      callOrder.push('delete')
      return chain
    }
    chain.returning = () => Promise.resolve(rows)
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  const tx = {
    update: vi.fn(() => makeUpdateChain()),
    select: vi.fn(() => makeSelectChain()),
    delete: vi.fn(() => makeDeleteChain(deleteReturningQueue.shift() ?? [])),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import { deleteTask, deleteTasksByColumn } from '../tasks'
import { touchProject } from '../projects'

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COLUMN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

beforeEach(() => {
  vi.clearAllMocks()
  callOrder.length = 0
  setCalls.length = 0
  deleteReturningQueue.length = 0
})

describe('deleteTask', () => {
  it('stamps invalidAt on anchored facts BEFORE deleting the task row', async () => {
    deleteReturningQueue.push([{ id: TASK_ID }])

    const result = await deleteTask(TASK_ID, PROJECT_ID)

    expect(result).toBe(true)
    expect(callOrder).toEqual(['update', 'delete'])
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({ invalidAt: expect.any(Date) })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:deleted' })
  })

  it('returns false when no task row was deleted', async () => {
    deleteReturningQueue.push([])

    const result = await deleteTask(TASK_ID, PROJECT_ID)

    expect(result).toBe(false)
    expect(callOrder).toEqual(['update', 'delete'])
  })
})

describe('deleteTasksByColumn', () => {
  it('stamps invalidAt on facts anchored to the column tasks before deleting them', async () => {
    await deleteTasksByColumn(COLUMN_ID, PROJECT_ID)

    expect(callOrder).toEqual(['update', 'delete'])
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({ invalidAt: expect.any(Date) })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:deleted' })
  })
})
