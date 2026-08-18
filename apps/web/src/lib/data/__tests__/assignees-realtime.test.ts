import { describe, it, expect, beforeEach, vi } from 'vitest'

// Assignee writes are board mutations: without a touchProject call the
// boardVersion never bumps and no Pusher event fires, so other viewers keep
// showing stale pills until an unrelated mutation happens to land. These tests
// pin that assign/unassign touch the owning project — and only when a row
// actually changed.

const insertReturning: unknown[][] = []
const deleteReturning: unknown[][] = []
const selectRows: unknown[][] = []

vi.mock('@/lib/db', () => {
  function thenable(rows: () => unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.innerJoin = pass
    chain.values = pass
    chain.onConflictDoNothing = pass
    chain.returning = () => Promise.resolve(rows())
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return chain
  }
  return {
    db: {
      select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
      insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
      delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
    },
  }
})

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import { assignUserToTask, unassignUserFromTask } from '../assignees'
import { touchProject } from '../projects'

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROJECT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

beforeEach(() => {
  vi.clearAllMocks()
  insertReturning.length = 0
  deleteReturning.length = 0
  selectRows.length = 0
})

describe('assignUserToTask', () => {
  it('touches the owning project with task:assigned after the insert', async () => {
    insertReturning.push([{ taskId: TASK_ID, userId: USER_ID }])
    selectRows.push([{ projectId: PROJECT_ID }])

    const row = await assignUserToTask(TASK_ID, USER_ID, ACTOR_ID)

    expect(row).toEqual({ taskId: TASK_ID, userId: USER_ID })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:assigned' })
  })

  it('skips the touch when the assignment already existed', async () => {
    insertReturning.push([])

    const row = await assignUserToTask(TASK_ID, USER_ID, ACTOR_ID)

    expect(row).toBeNull()
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('skips the touch when the task row is gone', async () => {
    insertReturning.push([{ taskId: TASK_ID, userId: USER_ID }])
    selectRows.push([])

    await assignUserToTask(TASK_ID, USER_ID, ACTOR_ID)

    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('unassignUserFromTask', () => {
  it('touches the owning project with task:unassigned after the delete', async () => {
    deleteReturning.push([{ taskId: TASK_ID }])
    selectRows.push([{ projectId: PROJECT_ID }])

    const ok = await unassignUserFromTask(TASK_ID, USER_ID)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:unassigned' })
  })

  it('skips the touch when nothing was assigned', async () => {
    deleteReturning.push([])

    const ok = await unassignUserFromTask(TASK_ID, USER_ID)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})
