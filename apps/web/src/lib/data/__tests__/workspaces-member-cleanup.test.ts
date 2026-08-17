import { describe, it, expect, beforeEach, vi } from 'vitest'

// Removing a realm member can strip the last access path to a project, which
// used to leave task_assignees rows behind as ghost pills. These tests pin the
// access check (owner / direct member / other realm all keep the assignment)
// and that the cleanup delete is scoped to the removed user and the projects
// they genuinely lost.

const selectRows: unknown[][] = []
const deleteCalls: { table: unknown; where: unknown }[] = []
const selectWheres: unknown[] = []

vi.mock('@/lib/db', () => {
  function makeSelectChain() {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = pass
    chain.limit = pass
    chain.values = pass
    chain.set = pass
    chain.onConflictDoNothing = pass
    chain.returning = () => Promise.resolve(selectRows.shift() ?? [])
    chain.where = (w: unknown) => {
      selectWheres.push(w)
      return chain
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(selectRows.shift() ?? [])
    return chain
  }
  function makeDeleteChain(table: unknown) {
    const chain: Record<string, unknown> = {}
    chain.where = (w: unknown) => {
      deleteCalls.push({ table, where: w })
      return chain
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve([])
    return chain
  }
  const tx = {
    select: vi.fn(() => makeSelectChain()),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
    insert: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeSelectChain()),
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

vi.mock('@/lib/email', () => ({
  sendRealmInviteEmail: vi.fn(),
  getBaseUrl: () => '',
}))

import { removeGroupMember, inviteOrAddRealmMember } from '../workspaces'
import { touchProject } from '../projects'
import { groupMembers, taskAssignees } from '@/lib/db/schema'

const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const P_ORPHAN = '33333333-3333-4333-8333-333333333333'
const P_KEEP = '44444444-4444-4444-8444-444444444444'
const TASK_ORPHAN = '55555555-5555-4555-8555-555555555555'
const TASK_KEEP = '66666666-6666-4666-8666-666666666666'

// Drizzle where clauses are opaque SQL trees — flatten every string/param a
// clause carries so tests can assert on what it was scoped to.
function flatten(node: unknown, out: string[] = [], seen = new WeakSet<object>()): string[] {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (seen.has(node as object)) return out
  seen.add(node as object)
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out, seen)
    return out
  }
  for (const v of Object.values(node as Record<string, unknown>)) flatten(v, out, seen)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  selectRows.length = 0
  deleteCalls.length = 0
  selectWheres.length = 0
})

describe('removeGroupMember', () => {
  it('drops assignments only on projects the user lost access to', async () => {
    selectRows.push([{ projectId: P_ORPHAN }, { projectId: P_KEEP }]) // group projects
    selectRows.push([]) // owned
    selectRows.push([{ projectId: P_KEEP }]) // direct project_members
    selectRows.push([]) // other realms
    selectRows.push([{ taskId: TASK_ORPHAN, projectId: P_ORPHAN }]) // stale assignments

    await removeGroupMember(GROUP_ID, USER_ID)

    expect(deleteCalls).toHaveLength(2)
    expect(deleteCalls[0].table).toBe(groupMembers)
    expect(deleteCalls[1].table).toBe(taskAssignees)

    const staleWhere = flatten(selectWheres[selectWheres.length - 1])
    expect(staleWhere).toContain(P_ORPHAN)
    expect(staleWhere).not.toContain(P_KEEP)

    const cleanupWhere = flatten(deleteCalls[1].where)
    expect(cleanupWhere).toContain(USER_ID)
    expect(cleanupWhere).toContain(TASK_ORPHAN)
    expect(cleanupWhere).not.toContain(TASK_KEEP)

    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(touchProject).toHaveBeenCalledWith(P_ORPHAN, { type: 'task:unassigned' })
  })

  it('keeps assignments when another realm still grants the project', async () => {
    selectRows.push([{ projectId: P_KEEP }]) // group projects
    selectRows.push([]) // owned
    selectRows.push([]) // direct project_members
    selectRows.push([{ projectId: P_KEEP }]) // other realms

    await removeGroupMember(GROUP_ID, USER_ID)

    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].table).toBe(groupMembers)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('keeps assignments on projects the user owns', async () => {
    selectRows.push([{ projectId: P_KEEP }]) // group projects
    selectRows.push([{ id: P_KEEP }]) // owned
    selectRows.push([]) // direct project_members
    selectRows.push([]) // other realms

    await removeGroupMember(GROUP_ID, USER_ID)

    expect(deleteCalls).toHaveLength(1)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('does nothing extra when the realm holds no projects', async () => {
    selectRows.push([]) // group projects

    await removeGroupMember(GROUP_ID, USER_ID)

    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].table).toBe(groupMembers)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('skips the cleanup delete when the user had no assignments', async () => {
    selectRows.push([{ projectId: P_ORPHAN }]) // group projects
    selectRows.push([]) // owned
    selectRows.push([]) // direct project_members
    selectRows.push([]) // other realms
    selectRows.push([]) // stale assignments

    await removeGroupMember(GROUP_ID, USER_ID)

    expect(deleteCalls).toHaveLength(1)
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('inviteOrAddRealmMember', () => {
  it('matches existing users case-insensitively', async () => {
    selectRows.push([{ id: USER_ID }])

    const result = await inviteOrAddRealmMember(GROUP_ID, 'Mixed.Case@Example.com', 'editor', USER_ID)

    expect(result.type).toBe('added')
    expect(result.email).toBe('mixed.case@example.com')

    const lookupWhere = flatten(selectWheres[0])
    expect(lookupWhere).toContain('lower(')
    expect(lookupWhere).toContain('mixed.case@example.com')
  })
})
