import { describe, it, expect, beforeEach, vi } from 'vitest'

// Virtual members are board data: assignment writes must bump boardVersion
// (touchProject) exactly like real-member assignment, creation must derive
// initials, and deletion must clean assignments atomically and touch every
// project that lost pills.

const insertReturning: unknown[][] = []
const deleteReturning: unknown[][] = []
const selectRows: unknown[][] = []
const updateReturning: unknown[][] = []
const capturedInsertValues: unknown[] = []

function thenable(rows: () => unknown[]) {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.where = pass
  chain.innerJoin = pass
  chain.orderBy = pass
  chain.set = pass
  chain.values = (v: unknown) => { capturedInsertValues.push(v); return chain }
  chain.onConflictDoNothing = pass
  chain.returning = () => Promise.resolve(rows())
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
  return chain
}

class MockRollbackError extends Error {
  constructor() { super('Rollback') }
}

function makeDb() {
  return {
    select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
    insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
    delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
    update: vi.fn(() => thenable(() => updateReturning.shift() ?? [])),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
        insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
        delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
        update: vi.fn(() => thenable(() => updateReturning.shift() ?? [])),
        rollback: () => { throw new MockRollbackError() },
      }
      return fn(tx)
    }),
  }
}

vi.mock('@/lib/db', () => ({ db: makeDb() }))

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import {
  deriveInitials,
  createVirtualMember,
  deleteVirtualMember,
  assignVirtualMemberToTask,
  unassignVirtualMemberFromTask,
} from '../virtual-members'
import { touchProject } from '../projects'

const VM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REALM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PROJECT_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PROJECT_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

beforeEach(() => {
  vi.clearAllMocks()
  insertReturning.length = 0
  deleteReturning.length = 0
  selectRows.length = 0
  updateReturning.length = 0
  capturedInsertValues.length = 0
})

describe('deriveInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(deriveInitials('Jane Doe')).toBe('JD')
    expect(deriveInitials('ada lovelace jr')).toBe('AL')
  })

  it('falls back to a single letter for one-word names', () => {
    expect(deriveInitials('Cher')).toBe('C')
  })

  it('never returns an empty string', () => {
    expect(deriveInitials('   ')).toBe('?')
  })
})

describe('createVirtualMember', () => {
  it('derives initials from the name when not provided', async () => {
    insertReturning.push([{ id: VM_ID, name: 'Jane Doe', initials: 'JD', color: 'blue' }])

    await createVirtualMember(REALM_ID, { name: 'Jane Doe', color: 'blue' }, ACTOR_ID)

    expect(capturedInsertValues[0]).toMatchObject({
      realmId: REALM_ID,
      name: 'Jane Doe',
      initials: 'JD',
      color: 'blue',
      createdById: ACTOR_ID,
    })
  })

  it('keeps explicitly provided initials', async () => {
    insertReturning.push([{ id: VM_ID }])

    await createVirtualMember(REALM_ID, { name: 'Jane Doe', color: 'blue', initials: 'JX' }, ACTOR_ID)

    expect(capturedInsertValues[0]).toMatchObject({ initials: 'JX' })
  })
})

describe('assignVirtualMemberToTask', () => {
  it('touches the owning project after the insert', async () => {
    insertReturning.push([{ taskId: TASK_ID, virtualMemberId: VM_ID }])
    selectRows.push([{ projectId: PROJECT_A }])

    const row = await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID)

    expect(row).toEqual({ taskId: TASK_ID, virtualMemberId: VM_ID })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:assigned' })
  })

  it('skips the project lookup when the caller already knows the project', async () => {
    insertReturning.push([{ taskId: TASK_ID, virtualMemberId: VM_ID }])
    // NO selectRows queued — a lookup would resolve [] and skip the touch.

    await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID, PROJECT_A)

    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:assigned' })
  })

  it('skips the touch when the assignment already existed', async () => {
    insertReturning.push([])

    const row = await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID)

    expect(row).toBeNull()
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('unassignVirtualMemberFromTask', () => {
  it('touches the owning project after the delete', async () => {
    deleteReturning.push([{ taskId: TASK_ID }])

    const ok = await unassignVirtualMemberFromTask(TASK_ID, VM_ID, PROJECT_A)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:unassigned' })
  })

  it('skips the touch when nothing was assigned', async () => {
    deleteReturning.push([])

    const ok = await unassignVirtualMemberFromTask(TASK_ID, VM_ID, PROJECT_A)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('deleteVirtualMember', () => {
  it('deletes assignments + member atomically and touches each affected project once', async () => {
    // Assignments span two projects (one twice — must dedupe).
    selectRows.push([
      { projectId: PROJECT_A },
      { projectId: PROJECT_A },
      { projectId: PROJECT_B },
    ])
    deleteReturning.push([]) // assignments delete (result unused)
    deleteReturning.push([{ id: VM_ID }]) // member delete

    const ok = await deleteVirtualMember(VM_ID, REALM_ID)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledTimes(2)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:unassigned' })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_B, { type: 'task:unassigned' })
  })

  it('returns false (and touches nothing) when the member does not exist in the realm', async () => {
    selectRows.push([])
    deleteReturning.push([]) // assignments delete
    deleteReturning.push([]) // member delete misses -> rollback

    const ok = await deleteVirtualMember(VM_ID, REALM_ID)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})
