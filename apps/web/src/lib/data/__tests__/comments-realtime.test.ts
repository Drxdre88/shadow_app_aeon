import { describe, it, expect, beforeEach, vi } from 'vitest'

// Comment writes are board mutations: without a touchProject call the
// boardVersion never bumps and no Pusher event fires, so other viewers keep
// showing stale comment threads until a manual reload. These tests pin that
// create/update/delete touch the caller's project with comment:changed — and
// only when a row actually changed. The touch is fire-and-forget: a Pusher or
// DB hiccup must never fail a comment that is already committed.

const insertReturning: unknown[][] = []
const updateReturning: unknown[][] = []
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
    chain.set = pass
    chain.limit = pass
    chain.orderBy = pass
    chain.returning = () => Promise.resolve(rows())
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
    return chain
  }
  return {
    db: {
      select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
      insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
      update: vi.fn(() => thenable(() => updateReturning.shift() ?? [])),
      delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
    },
  }
})

vi.mock('../projects', () => ({
  touchProject: vi.fn(() => Promise.resolve()),
}))

import { createComment, updateComment, deleteComment } from '../comments'
import { touchProject } from '../projects'

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const COMMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROJECT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

beforeEach(() => {
  vi.clearAllMocks()
  insertReturning.length = 0
  updateReturning.length = 0
  deleteReturning.length = 0
  selectRows.length = 0
})

describe('createComment', () => {
  it('touches the caller-verified project with comment:changed after the insert', async () => {
    insertReturning.push([{ id: COMMENT_ID, taskId: TASK_ID }])

    const comment = await createComment(TASK_ID, PROJECT_ID, USER_ID, 'hello')

    expect(comment).toEqual({ id: COMMENT_ID, taskId: TASK_ID })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'comment:changed' })
  })

  it('does not re-resolve the project from the task', async () => {
    insertReturning.push([{ id: COMMENT_ID, taskId: TASK_ID }])

    const { db } = await import('@/lib/db')
    await createComment(TASK_ID, PROJECT_ID, USER_ID, 'hello')

    expect(db.select).not.toHaveBeenCalled()
  })

  it('returns the comment even when the touch rejects', async () => {
    insertReturning.push([{ id: COMMENT_ID, taskId: TASK_ID }])
    vi.mocked(touchProject).mockRejectedValueOnce(new Error('pusher down'))

    await expect(createComment(TASK_ID, PROJECT_ID, USER_ID, 'hello'))
      .resolves.toEqual({ id: COMMENT_ID, taskId: TASK_ID })
  })
})

describe('updateComment', () => {
  it('touches the caller-verified project with comment:changed after the update', async () => {
    updateReturning.push([{ id: COMMENT_ID, content: 'edited' }])

    const comment = await updateComment(COMMENT_ID, TASK_ID, PROJECT_ID, USER_ID, 'edited')

    expect(comment).toEqual({ id: COMMENT_ID, content: 'edited' })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'comment:changed' })
  })

  it('skips the touch when no comment matched (wrong author or id)', async () => {
    updateReturning.push([])

    const comment = await updateComment(COMMENT_ID, TASK_ID, PROJECT_ID, USER_ID, 'edited')

    expect(comment).toBeNull()
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('deleteComment', () => {
  it('touches the caller-verified project with comment:changed after the delete', async () => {
    deleteReturning.push([{ id: COMMENT_ID }])

    const ok = await deleteComment(COMMENT_ID, TASK_ID, PROJECT_ID, USER_ID)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'comment:changed' })
  })

  it('skips the touch when nothing was deleted', async () => {
    deleteReturning.push([])

    const ok = await deleteComment(COMMENT_ID, TASK_ID, PROJECT_ID, USER_ID)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})
